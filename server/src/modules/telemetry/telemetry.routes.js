import { Router } from 'express'
import prisma from "../../database.js"
import { authenticate, requireAdmin, requireReadAccess, requireWriteAccess } from "../../middleware/auth.js"
import telemetryProcessor from '../../../../module-3/telemetryProcessor.js'
import { buildIngredientSummary, buildUnloadProgress, recalculateBatchViolations } from '../batches/batch-violations.js'
import { getZoneByCoordinates, resolveEffectiveCoordinates } from './telemetry-helpers.js'

const router = Router()

function parseBoolean(value) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1') return true
    if (normalized === 'false' || normalized === '0') return false
  }
  return Boolean(value)
}

function normalizeTelemetryPacket(packet) {
  return {
    deviceId: packet.deviceId || packet.device_id || 'host_01',
    timestamp: packet.timestamp ? new Date(packet.timestamp) : new Date(),
    lat: Number(packet.lat || 0),
    lon: Number(packet.lon || 0),
    gpsValid: parseBoolean(packet.gpsValid ?? packet.gps_valid),
    gpsSatellites: Number(packet.gpsSatellites ?? packet.gps_satellites ?? 0),
    weight: Number(packet.weight || 0),
    weightValid: parseBoolean(packet.weightValid ?? packet.weight_valid),
    gpsQuality: Number(packet.gpsQuality ?? packet.gps_quality ?? 0),
    wifiClients: packet.wifiClients ?? packet.wifi_clients ?? [],
    cpuTempC: packet.cpuTempC ?? packet.cpu_temp_c ?? null,
    lteRssiDbm: packet.lteRssiDbm ?? packet.lte_rssi_dbm ?? null,
    lteAccessTech: packet.lteAccessTech ?? packet.lte_access_tech ?? null,
    eventsReaderOk: parseBoolean(packet.eventsReaderOk ?? packet.events_reader_ok)
  }
}

// Хелпер для пустых ответов
function buildEmptyLatestResponse(deviceId = null) {
  return {
    id: null, deviceId, timestamp: null, lat: null, lon: null,
    weight: null, weightValid: false, gpsValid: false, gpsSatellites: 0,
    gpsQuality: 0, wifiClients: null, cpuTempC: null, lteRssiDbm: null,
    lteAccessTech: null, eventsReaderOk: false, banner: null,
    mode: 'Ожидание',
    isMixing: false,
    isUnloading: false,
    unload_progress: null,
    active_batch: null
  }
}

function getRequestedDeviceId(req) {
  const value = req.query.deviceId || req.query.device_id
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

async function inferMachineStateFromDatabase(deviceId, latestTelemetry, activeBatch, memoryState = {}, options = {}) {
  const currentZone = memoryState?.currentZone || options.currentZone || null

  if (!latestTelemetry) {
    return {
      mode: 'Ожидание',
      isMixing: false,
      isUnloading: false,
      peakWeight: 0,
      currentZone
    }
  }

  if (!activeBatch) {
    return {
      mode: 'Ожидание',
      isMixing: false,
      isUnloading: false,
      peakWeight: Number(latestTelemetry.weight || 0),
      currentZone
    }
  }

  const telemetryWhere = {
    deviceId,
    timestamp: { gte: activeBatch.startTime }
  }

  const [recentPoints, peakTelemetry] = await Promise.all([
    prisma.telemetry.findMany({
      where: telemetryWhere,
      orderBy: { timestamp: 'desc' },
      take: 8,
      select: { weight: true, timestamp: true }
    }),
    prisma.telemetry.aggregate({
      where: telemetryWhere,
      _max: { weight: true }
    })
  ])

  const currentWeight = Number(latestTelemetry.weight || 0)
  const previousWeight = Number(recentPoints[1]?.weight ?? currentWeight)
  const peakWeight = Math.max(
    Number(peakTelemetry._max.weight || 0),
    Number(activeBatch.startWeight || 0),
    currentWeight
  )
  const dropFromPeak = peakWeight - currentWeight
  const recentDelta = currentWeight - previousWeight

  let mode = 'Ожидание'
  if (memoryState?.isUnloading) {
    mode = 'Выгрузка'
  } else if (memoryState?.isMixing) {
    mode = 'Загрузка'
  } else if (dropFromPeak > 30) {
    mode = 'Выгрузка'
  } else if (recentDelta > 5 || (activeBatch.actualIngredients || []).length > 0) {
    mode = 'Загрузка'
  }

  return {
    ...memoryState,
    mode,
    isMixing: mode === 'Загрузка',
    isUnloading: mode === 'Выгрузка',
    peakWeight,
    currentZone
  }
}

// ============================================================================
// POST / - ПРИЕМ ТЕЛЕМЕТРИИ
// ============================================================================
router.post('/', async (req, res) => {
  try {
    const packet = normalizeTelemetryPacket(req.body);
    const deviceId = packet.deviceId;

    // 1. Достаем геозоны из базы
    const activeZones = await prisma.storageZone.findMany({ where: { active: true } });
    const effectivePosition = await resolveEffectiveCoordinates(prisma, packet, {
      deviceId,
      referenceTime: packet.timestamp
    });
    const processorPacket = {
      ...packet,
      lat: effectivePosition.lat,
      lon: effectivePosition.lon
    };

    // Вся валидация координат, смена зон и расчет дельт
    const result = telemetryProcessor.processPacket(processorPacket, activeZones);

    if (!result.isValid) {
      console.warn(`[Фильтр] Отброшен невалидный пакет от ${deviceId}:`, result.error);
      return res.status(400).json({ error: result.error || 'Invalid coordinates' });
    }

    // 3. Сохраняем сырую телеметрию в БД
    const telemetry = await prisma.telemetry.create({
      data: {
        deviceId: deviceId,
        timestamp: packet.timestamp,
        lat: packet.lat,
        lon: packet.lon,
        gpsValid: packet.gpsValid,
        gpsSatellites: packet.gpsSatellites,
        weight: packet.weight,
        weightValid: packet.weightValid,
        gpsQuality: packet.gpsQuality,
        wifiClients: Array.isArray(packet.wifiClients) ? JSON.stringify(packet.wifiClients) : String(packet.wifiClients || '[]'),
        cpuTempC: packet.cpuTempC,
        lteRssiDbm: packet.lteRssiDbm,
        lteAccessTech: packet.lteAccessTech,
        eventsReaderOk: packet.eventsReaderOk
      }
    });

    // 4. ИСПОЛНЯЕМ КОМАНДЫ (dbActions)
    if (result.dbActions && result.dbActions.length > 0) {
      // Ищем текущий открытый замес
      let activeBatch = await prisma.batch.findFirst({
        where: { deviceId, endTime: null },
        orderBy: { startTime: 'desc' }
      });
      const batchIdsToRecalculate = new Set();
      const stickyViolationBatchIds = new Set();

      for (const action of result.dbActions) {
        switch (action.type) {
          case 'START_BATCH':
            if (!activeBatch) {
              activeBatch = await prisma.batch.create({
                data: {
                  deviceId,
                  startTime: telemetry.timestamp,
                  startWeight: Number(action.startWeight ?? telemetry.weight),
                  hasViolations: false
                }
              });
              console.log(`Открыт новый замес ${activeBatch.id} (${activeBatch.startWeight} кг)`);
            }
            break;
          
          case 'ADD_INGREDIENT':
            // Если добавить ингредиент, а замеса нет — создаем его
            if (!activeBatch) {
              activeBatch = await prisma.batch.create({
                data: {
                  deviceId,
                  startTime: telemetry.timestamp,
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
                actualWeight: action.actualWeight
              }
            });
            batchIdsToRecalculate.add(activeBatch.id);
            console.log(`Добавлен ингредиент: ${action.ingredientName} (${action.actualWeight} кг)`);
            break;

          case 'START_UNLOAD':
            if (activeBatch) {
              await prisma.batch.update({
                where: { id: activeBatch.id },
                data: { endWeight: Number(action.startUnloadWeight ?? telemetry.weight) }
              });
              console.log(`Замес ${activeBatch.id}: началась выгрузка`);
            }
            break;

          case 'UPDATE_UNLOAD':
            if (activeBatch) {
              await prisma.batch.update({
                where: { id: activeBatch.id },
                data: { endWeight: action.endWeight } // Просто обновляем остаток
              });
            }
            break;

          case 'LEFTOVER_VIOLATION':
            if (activeBatch) {
              stickyViolationBatchIds.add(activeBatch.id);
              await prisma.batch.update({
                where: { id: activeBatch.id },
                data: {
                  hasViolations: true,
                  endWeight: Number(action.leftoverWeight ?? activeBatch.endWeight ?? telemetry.weight)
                }
              });
              console.log(`Замес ${activeBatch.id}: зафиксирован остаток ${action.leftoverWeight} кг`);
            }
            break;

          case 'COMPLETE_BATCH':
            if (activeBatch) {
              const completedBatchId = activeBatch.id;
              await prisma.batch.update({
                where: { id: activeBatch.id },
                data: { endTime: telemetry.timestamp, endWeight: Number(action.endWeight ?? telemetry.weight) } // Закрываем замес
              });
              batchIdsToRecalculate.add(completedBatchId);
              console.log(`Замес ${activeBatch.id} закрыт!`);
              activeBatch = null;
            }
            break;

          case 'FORCE_CLOSE_BATCH':
            if (activeBatch) {
              const closedBatchId = activeBatch.id;
              stickyViolationBatchIds.add(closedBatchId);
              await prisma.batch.update({
                where: { id: activeBatch.id },
                data: {
                  endTime: telemetry.timestamp,
                  endWeight: Number(action.closeWeight ?? telemetry.weight),
                  hasViolations: true
                }
              });
              batchIdsToRecalculate.add(closedBatchId);
              console.log(`Замес ${activeBatch.id} принудительно закрыт (недовыгрузка)!`);
            }
            // Сразу открываем новый с текущим остатком в кузове
            activeBatch = await prisma.batch.create({
              data: {
                deviceId,
                startTime: telemetry.timestamp,
                startWeight: Number(action.nextStartWeight ?? telemetry.weight),
                hasViolations: false
              }
            });
            break;
        }
      }

      for (const batchId of batchIdsToRecalculate) {
        await recalculateBatchViolations(prisma, batchId);
        if (stickyViolationBatchIds.has(batchId)) {
          await prisma.batch.update({
            where: { id: batchId },
            data: { hasViolations: true }
          });
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
    const requestedDeviceId = getRequestedDeviceId(req)
    const data = await prisma.telemetry.findFirst({
      where: requestedDeviceId ? { deviceId: requestedDeviceId } : undefined,
      orderBy: { timestamp: 'desc' } 
    });
    
    if (!data) return res.json(buildEmptyLatestResponse(requestedDeviceId));

    const memoryState = telemetryProcessor.getState(data.deviceId);
    const [activeBatch, activeZones, effectivePosition] = await Promise.all([
      prisma.batch.findFirst({
      where: { deviceId: data.deviceId, endTime: null },
      include: {
        group: true,
        ration: { include: { ingredients: true } },
        actualIngredients: true
      },
      orderBy: { startTime: 'desc' }
      }),
      prisma.storageZone.findMany({ where: { active: true } }),
      resolveEffectiveCoordinates(prisma, data, {
        deviceId: data.deviceId,
        referenceTime: data.timestamp
      })
    ]);
    const detectedZone = getZoneByCoordinates(effectivePosition.lat, effectivePosition.lon, activeZones);

    const machineState = await inferMachineStateFromDatabase(data.deviceId, data, activeBatch, memoryState, {
      currentZone: detectedZone?.name || null
    });

    let mode = 'Ожидание';
    let unload_progress = null;
    let active_banner = null;

    if (machineState) {
      mode = machineState.mode || mode;

      // БАННЕР ЗОНЫ (И для загрузки, и для выгрузки)
      if (machineState.currentZone) {
        active_banner = { 
          type: 'zone_info', 
          message: `Зона: ${machineState.currentZone}` 
        };
      }

      if (machineState.isUnloading) {
        mode = 'Выгрузка';
        unload_progress = buildUnloadProgress(activeBatch, data.weight, machineState);
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

    let active_batch_data = null;
    if (activeBatch) {
      active_batch_data = {
        id: activeBatch.id,
        rationId: activeBatch.rationId,
        groupId: activeBatch.groupId,
        ingredients: buildIngredientSummary(activeBatch)
      };
    }

    res.json({
      ...data,
      selectedDeviceId: data.deviceId,
      banner: active_banner, // Вот тут будет висеть зона, пока трактор там
      mode,
      isMixing: machineState.isMixing,
      isUnloading: machineState.isUnloading,
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
    const deleted = await prisma.telemetry.deleteMany({});
    res.json({ status: 'ok', message: 'Таблица чиста', count: deleted.count });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
