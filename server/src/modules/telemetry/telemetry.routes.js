import { Router } from 'express'
import prisma from "../../database.js"
import { authenticate, requireAdmin, requireReadAccess, requireWriteAccess } from "../../middleware/auth.js"
import { telemetryProcessor } from '../../core/TelemetryProcessor.js'

// ВРЕМЕННАЯ ЗАГЛУШКА
const telemetryProcessor = {
  processPacket: (packet, zones) => ({ isValid: true, error: null, banner: null, dbActions: [] }),
  getState: (deviceId) => ({ isMixing: false, isUnloading: false, peakWeight: 0 })
};

const router = Router()

// Хелпер для пустых ответов
function buildEmptyLatestResponse() {
  return {
    id: null, deviceId: null, timestamp: null, lat: null, lon: null,
    weight: null, weightValid: false, gpsValid: false, gpsSatellites: 0,
    gpsQuality: 0, wifiClients: null, cpuTempC: null, lteRssiDbm: null,
    lteAccessTech: null, eventsReaderOk: false, banner: null
  }
}

// ============================================================================
// POST / - ПРИЕМ ТЕЛЕМЕТРИИ
// ============================================================================
router.post('/', async (req, res) => {
  try {
    const packet = req.body;
    const deviceId = packet.device_id || 'host_01';

    // 1. Достаем геозоны из базы
    const activeZones = await prisma.storageZone.findMany({ where: { active: true } });

    // Вся валидация координат, смена зон и расчет дельт
    const result = telemetryProcessor.processPacket(packet, activeZones);

    if (!result.isValid) {
      console.warn(`[Фильтр] Отброшен невалидный пакет от ${deviceId}:`, result.error);
      return res.status(400).json({ error: result.error || 'Invalid coordinates' });
    }

    // 3. Сохраняем сырую телеметрию в БД
    const telemetry = await prisma.telemetry.create({
      data: {
        deviceId: deviceId,
        timestamp: packet.timestamp ? new Date(packet.timestamp) : new Date(),
        lat: packet.lat || 0,
        lon: packet.lon || 0,
        gpsValid: Boolean(packet.gps_valid),
        gpsSatellites: packet.gps_satellites || 0,
        weight: packet.weight || 0,
        weightValid: Boolean(packet.weight_valid),
        gpsQuality: packet.gps_quality || 0,
        wifiClients: packet.wifi_clients ? JSON.stringify(packet.wifi_clients) : '[]',
        cpuTempC: packet.cpu_temp_c || null,
        lteRssiDbm: packet.lte_rssi_dbm || null,
        lteAccessTech: packet.lte_access_tech || null,
        eventsReaderOk: Boolean(packet.events_reader_ok)
      }
    });

    // 4. ИСПОЛНЯЕМ КОМАНДЫ (dbActions)
    if (result.dbActions && result.dbActions.length > 0) {
      // Ищем текущий открытый замес
      let activeBatch = await prisma.batch.findFirst({
        where: { deviceId, endTime: null },
        orderBy: { startTime: 'desc' }
      });

      for (const action of result.dbActions) {
        switch (action.type) {
          
          case 'ADD_INGREDIENT':
            // Если добавить ингредиент, а замеса нет — создаем его
            if (!activeBatch) {
              activeBatch = await prisma.batch.create({
                data: {
                  deviceId,
                  startTime: new Date(),
                  startWeight: telemetry.weight, // Или можно брать action.startWeight
                  hasViolations: false
                }
              });
            }
            // Пишем ингредиент
            await prisma.batchIngredient.create({
              data: {
                batchId: activeBatch.id,
                ingredientName: action.ingredientName,
                actualWeight: action.weight
              }
            });
            console.log(`Добавлен ингредиент: ${action.ingredientName} (${action.weight} кг)`);
            break;

          case 'UPDATE_UNLOAD':
            if (activeBatch) {
              await prisma.batch.update({
                where: { id: activeBatch.id },
                data: { endWeight: action.endWeight } // Просто обновляем остаток
              });
            }
            break;

          case 'COMPLETE_BATCH':
            if (activeBatch) {
              await prisma.batch.update({
                where: { id: activeBatch.id },
                data: { endTime: new Date() } // Закрываем замес
              });
              console.log(`Замес ${activeBatch.id} закрыт!`);
              activeBatch = null;
            }
            break;

          case 'FORCE_CLOSE_BATCH':
            if (activeBatch) {
              await prisma.batch.update({
                where: { id: activeBatch.id },
                data: { endTime: new Date() }
              });
              console.log(`Замес ${activeBatch.id} принудительно закрыт (недовыгрузка)!`);
            }
            // Сразу открываем новый с текущим остатком в кузове
            activeBatch = await prisma.batch.create({
              data: {
                deviceId,
                startTime: new Date(),
                startWeight: telemetry.weight,
                hasViolations: false
              }
            });
            break;
        }
      }
    }

    // Возвращаем ответ контроллеру трактора
    res.status(201).json({ status: 'ok', id: telemetry.id, banner: result.banner });

  } catch (error) {
    console.error('[Ошибка POST /]:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ============================================================================
// GET /current - ДАННЫЕ ДЛЯ ГЛАВНОЙ СТРАНИЦЫ
// ============================================================================
router.get('/current', authenticate, requireReadAccess, async (req, res) => {
  try {
    const data = await prisma.telemetry.findFirst({ 
      orderBy: { timestamp: 'desc' } 
    });
    
    if (!data) return res.json(buildEmptyLatestResponse());

    // 1. Получаем состояние из ядра Ильи
    // 1. Получаем состояние из ядра Ильи
    const machineState = telemetryProcessor.getState(data.deviceId);
    
    let mode = 'Ожидание';
    let unload_progress = null;
    let active_banner = null;

    if (machineState) {
      // БАННЕР ЗОНЫ (И для загрузки, и для выгрузки)
      if (machineState.currentZone) {
        active_banner = { 
          type: 'zone_info', 
          message: `Зона: ${machineState.currentZone}` 
        };
      }

      if (machineState.isUnloading) {
        mode = 'Выгрузка';
        // Идеальная шкала: Илья отдает план на текущий коровник и сколько уже высыпали
        unload_progress = { 
          target_weight: machineState.barnTargetWeight || 0, // План для этого коровника
          unloaded_fact: machineState.unloadedInBarn || 0    // Факт выгрузки
        };
      } else if (machineState.isMixing) {
        mode = 'Загрузка';
      }
    }

    // 2. СИСТЕМНЫЕ БАННЕРЫ (Приоритет: если есть ошибка GPS, она важнее зоны)
    if (data.lat === 0 && data.lon === 0) {
      if (data.gpsQuality === 0) {
        active_banner = { type: 'gps_warning', message: 'Ожидание GPS fix' };
      } else if (data.gpsQuality === 1) {
        active_banner = { type: 'gps_error', message: 'Координаты не распознаны' };
      }
    }

    // 3. Данные по замесу для таблицы (План/Факт)
    const activeBatch = await prisma.batch.findFirst({
      where: { deviceId: data.deviceId, endTime: null },
      include: { ingredients: true }, // Сразу берем ингредиенты
      orderBy: { startTime: 'desc' }
    });

    let active_batch_data = null;
    if (activeBatch) {
      active_batch_data = {
        id: activeBatch.id,
        ingredients: activeBatch.ingredients.map(ing => ({
          name: ing.ingredientName,
          plan: 0, 
          fact: ing.actualWeight,
          deviation_percent: 0,
          is_violation: false
        }))
      };
    }

    res.json({
      ...data,
      banner: active_banner, // Вот тут будет висеть зона, пока трактор там
      mode,
      unload_progress,
      active_batch: active_batch_data
    });

  } catch (error) {
    console.error('[Ошибка /current]:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ============================================================================
// GET /recent - НЕДАВНИЕ ТОЧКИ
// ============================================================================
router.get('/recent', authenticate, requireReadAccess, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    const data = await prisma.telemetry.findMany({ 
      orderBy: { timestamp: 'desc' }, take: limit,
      select: { id: true, timestamp: true, lat: true, lon: true, weight: true, weightValid: true, gpsValid: true, deviceId: true }
    });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ============================================================================
// АДМИНСКИЕ ЭНДПОИНТЫ (История, сидирование, удаление)
// ============================================================================
router.get('/admin/latest', authenticate, requireAdmin, async (req, res) => {
  try {
    const data = await prisma.telemetry.findFirst({ orderBy: { timestamp: 'desc' } });
    if (!data) return res.json(buildEmptyLatestResponse());
    res.json({ ...data, banner: null });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/admin/history', authenticate, requireAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const data = await prisma.telemetry.findMany({ orderBy: { timestamp: 'desc' }, take: limit });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/admin/seed', authenticate, requireAdmin, async (req, res) => {
  try {
    if (req.headers['x-test-secret'] !== 'kill_all_telemetry_123') return res.status(403).json({ error: 'Доступ запрещен' });
    
    const points = [];
    let startLat = 52.52, startLon = 85.12;
    for (let i = 0; i < 20; i++) {
      points.push({
        deviceId: 'test_seeder_01', timestamp: new Date(Date.now() - (20 - i) * 10000), 
        lat: startLat + (i * 0.0005), lon: startLon + (i * 0.0005), gpsValid: true, gpsSatellites: 15,
        weight: 2450.5 + (i * 10), weightValid: true, gpsQuality: 4, wifiClients: '[]', eventsReaderOk: true
      });
    }
    const created = await prisma.telemetry.createMany({ data: points });
    res.json({ status: 'ok', message: `Добавлено ${created.count} точек` });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/admin/truncate', authenticate, requireWriteAccess, async (req, res) => {
  try {
    if (req.headers['x-test-secret'] !== 'kill_all_telemetry_123') return res.status(403).json({ error: 'Доступ запрещен' });
    const deleted = await prisma.telemetry.deleteMany({});
    res.json({ status: 'ok', message: 'Таблица чиста', count: deleted.count });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;