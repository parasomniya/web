import { Router } from 'express'
import prisma from "../../database.js"

const router = Router()

// Хранилище последних зон в памяти сервера (deviceId -> lastZoneName)
const deviceState = new Map();

function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  return R * c
}

async function checkZones(lat, lon, deviceId) {
  const zones = await prisma.storageZone.findMany({ where: { active: true } })
  let currentZoneName = null;
  let banner = null;

  for (const zone of zones) {
    const distance = getDistanceFromLatLonInMeters(lat, lon, zone.lat, zone.lon)
    if (distance <= (zone.radius || 50)) {
      currentZoneName = zone.name;
      break;
    }
  }

  const lastZone = deviceState.get(deviceId);

  // Логика "Только один раз":
  // Если вошли в новую зону (которой не было в прошлый раз)
  if (currentZoneName) {
    banner = {
      type: 'zone_enter',
      zoneName: currentZoneName,
      message: `Въезд в зону: ${currentZoneName}`
    };
  } 
  
  // Обновляем состояние (даже если вышли из зоны - запишется null)
  deviceState.set(deviceId, currentZoneName);
  
  return banner;
}

router.post('/', async (req, res) => {
  try {
    // 1. Достаем все поля из прилетающего JSON (
    const {
      device_id, timestamp, lat, lon, gps_valid, gps_satellites,
      weight, weight_valid, gps_quality, wifi_clients,
      cpu_temp_c, lte_rssi_dbm, lte_access_tech, events_reader_ok
    } = req.body

    const deviceId = device_id || 'host_01'

    // 2. Применяем фильтр координат
    if (!isValidLocation(lat, lon)) {
      console.warn(`[Фильтр] Отброшен невалидный пакет от ${deviceId}: lat=${lat}, lon=${lon}`)
      return res.status(400).json({ error: 'Invalid coordinates' })
    }

    // 3. Сохраняем расширенные данные в БД
    const telemetry = await prisma.telemetry.create({
      data: {
        deviceId: deviceId,
        // Если устройство прислало свой timestamp, берем его. Если нет - ставим время сервера
        timestamp: timestamp ? new Date(timestamp) : new Date(),
        lat: lat,
        lon: lon,
        gpsValid: Boolean(gps_valid),
        gpsSatellites: gps_satellites || 0,
        weight: weight || 0,
        weightValid: Boolean(weight_valid),
        gpsQuality: gps_quality || 0,
        // Массив перегоняем в строку для SQLite
        wifiClients: wifi_clients ? JSON.stringify(wifi_clients) : '[]',
        cpuTempC: cpu_temp_c || null,
        lteRssiDbm: lte_rssi_dbm || null,
        lteAccessTech: lte_access_tech || null,
        eventsReaderOk: Boolean(events_reader_ok)
      }
    })

    // 4. Проверяем геозоны
    const banner = await checkZones(lat, lon, deviceId)
    
    res.status(201).json({ status: 'ok', id: telemetry.id, banner })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Internal server error', details: error.message })
  }
})

router.get('/latest', async (req, res) => {
  try {
    const data = await prisma.telemetry.findFirst({ 
      orderBy: { timestamp: 'desc' } 
    })
    if (!data) return res.status(404).json({ error: 'No data found' })
    
    // В GET мы просто проверяем текущую зону, но баннер для фронтенда 
    // здесь обычно не нужен (чтобы не спамить при обновлении страницы), 
    // либо оставляем как есть, если фронтенд сам умеет скрывать.
    const banner = await checkZones(data.lat, data.lon, data.deviceId)
    res.json({ ...data, banner })
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10
    const data = await prisma.telemetry.findMany({ 
      orderBy: { timestamp: 'desc' },
      take: limit
    })
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
