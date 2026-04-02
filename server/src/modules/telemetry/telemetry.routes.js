import { Router } from 'express'
import prisma from "../../database.js"
import { authenticate, requireAdmin, requireReadAccess, requireWriteAccess } from "../../middleware/auth.js"

const router = Router()
// Временное хранилище для полевых тестов (Замесы)
const testBatches = new Map();

function buildEmptyLatestResponse() {
  return {
    id: null,
    deviceId: null,
    timestamp: null,
    lat: null,
    lon: null,
    weight: null,
    weightValid: false,
    gpsValid: false,
    gpsSatellites: 0,
    gpsQuality: 0,
    wifiClients: null,
    cpuTempC: null,
    lteRssiDbm: null,
    lteAccessTech: null,
    eventsReaderOk: false,
    banner: null
  }
}

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

// POST прием телеметрии - открыт для всех (без авторизации)
router.post('/', async (req, res) => {
  try {
    const {
      device_id, timestamp, lat, lon, gps_valid, gps_satellites,
      weight, weight_valid, gps_quality, wifi_clients,
      cpu_temp_c, lte_rssi_dbm, lte_access_tech, events_reader_ok
    } = req.body

    const deviceId = device_id || 'host_01'

    if (!isValidLocation(lat, lon)) {
      console.warn(`[Фильтр] Отброшен невалидный пакет от ${deviceId}: lat=${lat}, lon=${lon}`)
      return res.status(400).json({ error: 'Invalid coordinates' })
    }

    // СНАЧАЛА определяем баннер
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

    // ПОТОМ сохраняем в БД
    const telemetry = await prisma.telemetry.create({
      data: {
        deviceId: deviceId,
        timestamp: timestamp ? new Date(timestamp) : new Date(),
        lat: lat,
        lon: lon,
        gpsValid: Boolean(gps_valid),
        gpsSatellites: gps_satellites || 0,
        weight: weight || 0,
        weightValid: Boolean(weight_valid),
        gpsQuality: gps_quality || 0,
        wifiClients: wifi_clients ? JSON.stringify(wifi_clients) : '[]',
        cpuTempC: cpu_temp_c || null,
        lteRssiDbm: lte_rssi_dbm || null,
        lteAccessTech: lte_access_tech || null,
        eventsReaderOk: Boolean(events_reader_ok)
      }
    })

    const currentZoneName = deviceState.get(deviceId) || null;

    // =======================================================
  // 🚜 ПОШАГОВЫЙ АЛГОРИТМ ЗАМЕСА (ONLINE СОХРАНЕНИЕ)
  // =======================================================
  
  // 🛠 ПРАВКА: Если геозона не определена, называем её "Вне зоны"
  let activeZone = currentZoneName;
  if (!activeZone) {
      if (lat && lon) {
          activeZone = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
      } else {
          activeZone = 'Координаты неизвестны';
      }
  }

  let batch = testBatches.get(deviceId) || {
      dbId: null,
      isMixing: false,
      currentZone: activeZone, // Инициализируем сразу с активной зоной
      zoneStartWeight: weight || 0,
      peakWeight: weight || 0
  };

  const currentWeight = weight || 0;

  // Пункты 2 и 3: Смена зоны -> фиксируем дельту
  if (batch.currentZone !== activeZone) {
      if (batch.currentZone) {
          let delta = currentWeight - batch.zoneStartWeight;
          // Сохраняем, только если вес реально вырос больше чем на 30 кг
          // Это защитит от ложных записей, если вес просто "прыгнул" на кочке
          if (delta > 30) {
              batch.isMixing = true;
              console.log(`\n📦 [СБОР] Трактор набрал +${delta.toFixed(0)} кг в зоне '${batch.currentZone}'`);

              try {
                  if (!batch.dbId) {
                      const newBatch = await prisma.batch.create({
                          data: {
                              deviceId: deviceId,
                              startTime: new Date(),
                              hasViolations: false,
                              startWeight: batch.zoneStartWeight
                          }
                      });
                      batch.dbId = newBatch.id;
                  }

                  await prisma.batchIngredient.create({
                      data: {
                          batchId: batch.dbId,
                          ingredientName: batch.currentZone,
                          actualWeight: delta
                      }
                  });
                  console.log(`💾 Действие "Загрузка: ${batch.currentZone}" записано в БД!`);
              } catch (dbErr) {
                  console.error("Ошибка сохранения шага:", dbErr.message);
              }
          }
      }
      batch.currentZone = activeZone; // Обновляем текущую зону на новую
      batch.zoneStartWeight = currentWeight;
  }

  // Обновляем пиковый вес
  if (currentWeight > batch.peakWeight) {
    batch.peakWeight = currentWeight;
}

// 🛡 ЗАЩИТА ОТ "НЕДОВЫГРУЗКИ": 
if (batch.isUnloading && currentWeight > batch.lastUnloadWeight + 50) {
  console.log(`⚠️ Трактор начал новый замес с остатком ${batch.lastUnloadWeight} кг! Старый цикл закрыт.`);
  
  // Плавно перерождаем замес, не пропуская текущий шаг
  batch = {
      dbId: null, 
      isMixing: false,
      currentZone: activeZone,
      zoneStartWeight: batch.lastUnloadWeight, // ⚓ ВАЖНО: Стартуем строго с того веса, на котором закончилась выгрузка!
      peakWeight: currentWeight,
      isUnloading: false,
      lastUnloadWeight: null
  };
  // Мы НЕ пишем здесь return! Код идет дальше и сразу обрабатывает рост веса.
}

// Пункты 4 и 5: Детектим выгрузку
if (batch.isMixing && batch.peakWeight > 400 && currentWeight < batch.peakWeight - 200) {
    batch.isUnloading = true; // Ставим флаг, что мы в процессе разгрузки
    batch.lastUnloadWeight = currentWeight; // Запоминаем текущую точку веса

    if (batch.dbId) {
        try {
            // 💾 ДИНАМИЧЕСКОЕ ОБНОВЛЕНИЕ: перезаписываем остаток при каждом падении веса.
            // Если разгрузка остановится на 150 кг, в базе останется именно 150.
            await prisma.batch.update({
                where: { id: batch.dbId },
                data: {
                    endTime: new Date(),
                    endWeight: currentWeight
                }
            });
            console.log(`📉 Разгрузка: записан текущий остаток ${currentWeight} кг.`);
        } catch (dbErr) {
            console.error("Ошибка обновления остатка:", dbErr.message);
        }
    }

    // Очищаем память полностью, только если кузов пуст (< 50 кг)
    if (currentWeight < 50) {
        console.log(`🚀 ЗАМЕС ОКОНЧАТЕЛЬНО ЗАВЕРШЕН (Кузов пуст)!\n`);
        testBatches.delete(deviceId);
    } else {
        // Если еще не пуст, оставляем в памяти. 
        // Ждем: либо он доразгрузит остатки, либо начнет новую загрузку (сработает защита выше)
        testBatches.set(deviceId, batch); 
    }
} else {
    testBatches.set(deviceId, batch);
}
// =======================================================

    res.status(201).json({ status: 'ok', id: telemetry.id, banner })

  } catch (error) {
    console.error('[Ошибка при сохранении телеметрии]:', error)
    res.status(500).json({ error: 'Internal server error', details: error.message })
  }
})

// ==================== ЭНДПОИНТЫ ДЛЯ ГЛАВНОЙ СТРАНИЦЫ ====================
// Доступны всем авторизованным пользователям (ADMIN, DIRECTOR, GUEST)

// GET /current - текущие данные для главной страницы
router.get('/current', authenticate, requireReadAccess, async (req, res) => {
  try {
    const data = await prisma.telemetry.findFirst({ 
      orderBy: { timestamp: 'desc' } 
    })
    if (!data) return res.json(buildEmptyLatestResponse())
    
    let banner = null;

    if (data.lat === 0 && data.lon === 0) {
      if (data.gpsQuality === 0) {
        banner = { type: 'gps_warning', message: 'Ожидание GPS fix' };
      } else if (data.gpsQuality === 1) {
        banner = { type: 'gps_error', message: 'Координаты не распознаны' };
      }
    } else {
      banner = await checkZones(data.lat, data.lon, data.deviceId)
    }

    // Возвращаем только необходимые данные для главной страницы
    res.json({
      id: data.id,
      deviceId: data.deviceId,
      timestamp: data.timestamp,
      lat: data.lat,
      lon: data.lon,
      weight: data.weight,
      weightValid: data.weightValid,
      gpsValid: data.gpsValid,
      gpsSatellites: data.gpsSatellites,
      banner: banner
    })
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /recent - недавние данные для главной (ограниченный набор)
router.get('/recent', authenticate, requireReadAccess, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5
    const data = await prisma.telemetry.findMany({ 
      orderBy: { timestamp: 'desc' },
      take: limit,
      select: {
        id: true,
        timestamp: true,
        lat: true,
        lon: true,
        weight: true,
        weightValid: true,
        gpsValid: true,
        deviceId: true
      }
    })
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' })
  }
});

// ==================== ЭНДПОИНТЫ ДЛЯ АДМИН-ПАНЕЛИ ====================
// Доступны только администраторам

// GET /admin/latest - полные данные телеметрии
router.get('/admin/latest', authenticate, requireAdmin, async (req, res) => {
  try {
    const data = await prisma.telemetry.findFirst({ 
      orderBy: { timestamp: 'desc' } 
    })
    if (!data) return res.json(buildEmptyLatestResponse())
    
    let banner = null;

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

// GET /admin/history - полная история телеметрии
router.get('/admin/history', authenticate, requireAdmin, async (req, res) => {
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

// POST /admin/seed - Генерация тестовых данных
router.post('/admin/seed', authenticate, requireAdmin, async (req, res) => {
  try {
    if (req.headers['x-test-secret'] !== 'kill_all_telemetry_123') {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }

    const points = [];
    let startLat = 52.52;
    let startLon = 85.12;

    for (let i = 0; i < 20; i++) {
      points.push({
        deviceId: 'test_seeder_01',
        timestamp: new Date(Date.now() - (20 - i) * 10000), 
        lat: startLat + (i * 0.0005),
        lon: startLon + (i * 0.0005),
        gpsValid: true,
        gpsSatellites: 15,
        weight: 2450.5 + (i * 10),
        weightValid: true,
        gpsQuality: 4,
        wifiClients: '[]',
        eventsReaderOk: true
      });
    }

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

// DELETE /admin/truncate - Очистка телеметрии
router.delete('/admin/truncate', authenticate, requireWriteAccess, async (req, res) => {
  try {
    const testSecret = req.headers['x-test-secret'];
    if (testSecret !== 'kill_all_telemetry_123') {
      return res.status(403).json({ error: 'Доступ запрещен.' });
    }

    const deleted = await prisma.telemetry.deleteMany({});

    console.warn(`[TEST TOOLS] Таблица телеметрии очищена! Удалено записей: ${deleted.count}`);
    res.json({ status: 'ok', message: 'Таблица телеметрии чиста', count: deleted.count });
  } catch (error) {
    console.error('[Ошибка при очистке телеметрии]:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router
