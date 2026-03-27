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

function isValidLocation(lat, lon){
  if (lat == null || lon == null) return false;
  if (typeof lat !== 'number' || typeof lon !== 'number') return false;
  if (isNaN(lat) || isNaN(lon)) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;

  return true;
}

router.post('/', async (req, res) => {
  try {
    // 1. Достаем все поля из прилетающего JSON
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

    // 4. Проверяем геозоны или отдаем баннеры при нулевых координатах
    let banner = null;
    
    if (lat === 0 && lon === 0) {
      if (gps_quality === 0) {
        banner = { type: 'gps_warning', message: 'Ожидание GPS fix' };
      } 
      else if (gps_quality === 1) {
        banner = { type: 'gps_error', message: 'Координаты не распознаны' };
      }
    } 
    else {
      banner = await checkZones(lat, lon, deviceId);
    }
    
    res.status(201).json({ status: 'ok', id: telemetry.id, banner })

  } catch (error) {
    // ВЕРНУЛИ CATCH НА МЕСТО
    console.error('[Ошибка при сохранении телеметрии]:', error)
    res.status(500).json({ error: 'Internal server error', details: error.message })
  }
})

router.get('/latest', async (req, res) => {
  try {
    const data = await prisma.telemetry.findFirst({ 
      orderBy: { timestamp: 'desc' } 
    })
    if (!data) return res.status(404).json({ error: 'No data found' })
    
    let banner = null;

    // В базе поле называется в camelCase: data.gpsQuality
    if (data.lat === 0 && data.lon === 0) {
      if (data.gpsQuality === 0) {
        banner = { type: 'gps_warning', message: 'Ожидание GPS fix' };
      } else if (data.gpsQuality === 1) {
        banner = { type: 'gps_error', message: 'Координаты не распознаны' };
      }
    } else {
      banner = await checkZones(data.lat, data.lon, data.deviceId)
    }

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
});


// POST /seed - Генерация тестовых данных (Инструмент тестировки)
router.post('/seed', async (req, res) => {
  try {
    if (req.headers['x-test-secret'] !== 'kill_all_telemetry_123') {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }

    const points = [];
    let startLat = 52.52; // Стартовая точка из твоего JSON
    let startLon = 85.12;

    // Генерируем 20 точек с шагом 0.0005 градуса (имитация движения по прямой)
    for (let i = 0; i < 20; i++) {
      points.push({
        deviceId: 'test_seeder_01',
        // Делаем точки в прошлом, с разницей в 10 секунд
        timestamp: new Date(Date.now() - (20 - i) * 10000), 
        lat: startLat + (i * 0.0005),
        lon: startLon + (i * 0.0005),
        gpsValid: true,
        gpsSatellites: 15,
        weight: 2450.5 + (i * 10), // Вес понемногу растет
        weightValid: true,
        gpsQuality: 4,
        wifiClients: '[]',
        eventsReaderOk: true
      });
    }

    // Сохраняем весь массив разом
    const created = await prisma.telemetry.createMany({
      data: points
    });

    console.log(`[TEST TOOLS] Сгенерировано ${created.count} тестовых точек!`);
    res.json({ status: 'ok', message: `Успешно добавлено ${created.count} точек маршрута` });

  } catch (error) {
    console.error('[Ошибка генерации данных]:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /truncate - Очистка таблицы событий (Инструмент тестировки)
router.delete('/truncate', async (req, res) => {
  try {
    if (req.headers['x-test-secret'] !== 'kill_all_telemetry_123') {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }

    const deleted = await prisma.deviceEvent.deleteMany({});
    
    console.warn(`[TEST TOOLS] Таблица событий очищена! Удалено: ${deleted.count}`);
    res.json({ status: 'ok', message: 'События удалены', count: deleted.count });
  } catch (error) {
    console.error('[Ошибка очистки событий]:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Скрытый эндпоинт для очистки телеметрии (Инструмент тестировки)
router.delete('/truncate', async (req, res) => {
  try {
    // Двойная защита: проверяем специальный заголовок-пароль
    const testSecret = req.headers['x-test-secret'];
    if (testSecret !== 'kill_all_telemetry_123') {
      return res.status(403).json({ error: 'Ага, попался! Доступ запрещен.' });
    }

    // В Prisma нет прямого TRUNCATE, поэтому используем deleteMany (удаляет все записи)
    const deleted = await prisma.telemetry.deleteMany({});

    console.warn(`[TEST TOOLS] Таблица телеметрии очищена! Удалено записей: ${deleted.count}`);
    res.json({ status: 'ok', message: 'Таблица телеметрии девственно чиста', count: deleted.count });
  } catch (error) {
    console.error('[Ошибка при очистке телеметрии]:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router
