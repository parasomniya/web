import { Router } from 'express';
import prisma from "../../database.js";
import { authenticate, requireReadAccess, requireWriteAccess } from "../../middleware/auth.js";
import { buildIngredientSummary, buildUnloadProgress, recalculateBatchViolations } from './batch-violations.js';
import { normalizeIngredientName } from '../../../../module-2/rationManager.js';

const router = Router();

function round1(value) {
    return Math.round(Number(value || 0) * 10) / 10;
}

async function getBatchWeightContext(batch) {
    const telemetryWhere = {
        deviceId: batch.deviceId,
        timestamp: {
            gte: batch.startTime,
            ...(batch.endTime ? { lte: batch.endTime } : {})
        }
    };

    const [latestTelemetry, peakTelemetry] = await Promise.all([
        prisma.telemetry.findFirst({
            where: telemetryWhere,
            orderBy: { timestamp: 'desc' },
            select: { weight: true, timestamp: true }
        }),
        prisma.telemetry.aggregate({
            where: telemetryWhere,
            _max: { weight: true }
        })
    ]);

    const currentWeight = batch.endTime
        ? Number(batch.endWeight ?? latestTelemetry?.weight ?? 0)
        : Number(latestTelemetry?.weight ?? batch.endWeight ?? batch.startWeight ?? 0);
    const peakWeight = Math.max(
        Number(peakTelemetry._max.weight || 0),
        Number(batch.startWeight || 0),
        currentWeight
    );

    return {
        currentWeight,
        peakWeight,
        remainingWeight: round1(Math.max(0, currentWeight)),
        latestTelemetryAt: latestTelemetry?.timestamp || null
    };
}

// ============================================================================
// 1. GET / - Получить список замесов (с фильтром по дате, нарушениями и планом)
// ============================================================================
router.get('/', authenticate, requireReadAccess, async (req, res) => {
    try {
        // Логика фильтрации по датам (По умолчанию - сегодня)
        let startDate = new Date();
        startDate.setHours(0, 0, 0, 0);
        let endDate = new Date();
        endDate.setHours(23, 59, 59, 999);

        if (req.query.date) {
            if (Number.isNaN(Date.parse(req.query.date))) {
                return res.status(400).json({ error: 'Некорректная дата фильтра' });
            }
            startDate = new Date(req.query.date);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(req.query.date);
            endDate.setHours(23, 59, 59, 999);
        }

        const batches = await prisma.batch.findMany({
            where: {
                startTime: {
                    gte: startDate,
                    lte: endDate
                }
            },
            include: {
                group: true,
                ration: { include: { ingredients: true } }, // Связка с "Планом"
                actualIngredients: true, // Тут лежат компоненты и их нарушения
                violations: {
                    select: {
                        id: true
                    }
                }
            },
            orderBy: { startTime: 'desc' }
        });

        // Форматируем ответ для удобной таблицы фронтенда
        const formattedBatches = batches.map(b => {
            const ingredients = buildIngredientSummary(b);
            const hasLoggedViolations = (b.violations?.length || 0) > 0;

            return {
                id: b.id,
                deviceId: b.deviceId,
                startTime: b.startTime,
                endTime: b.endTime,
                rationName: b.ration?.name || 'Неизвестный рацион',
                groupName: b.group?.name || 'Без группы',
                hasViolations: hasLoggedViolations, // Единый источник статуса: журнал нарушений (все зафиксированные кейсы)
                startWeight: b.startWeight,
                endWeight: b.endWeight,
                ingredients
            };
        });

        res.json(formattedBatches);
    } catch (error) {
        console.error('[Ошибка GET /batches]:', error);
        res.status(500).json({ error: 'Не удалось получить список замесов' });
    }
});

// ============================================================================
// 4. GET /:id - Получить детальную информацию по одному замесу
// ============================================================================
router.get('/:id', authenticate, requireReadAccess, async (req, res) => {
    try {
        const batchId = parseInt(req.params.id, 10);
        if (!Number.isInteger(batchId)) {
            return res.status(400).json({ error: 'Некорректный ID замеса' });
        }

        const batch = await prisma.batch.findUnique({
            where: { id: batchId },
            include: {
                group: true,
                ration: {
                    include: { ingredients: true }
                },
                actualIngredients: {
                    orderBy: { addedAt: 'asc' } // Сортируем по времени добавления
                }
            }
        });

        if (!batch) {
            return res.status(404).json({ error: 'Замес не найден' });
        }

        const weightContext = await getBatchWeightContext(batch);

        // Форматируем ответ строго под нужды интерфейса Сони
        const detailedBatch = {
            id: batch.id,
            deviceId: batch.deviceId,
            startTime: batch.startTime,
            endTime: batch.endTime,
            rationId: batch.rationId,
            groupId: batch.groupId,
            rationName: batch.ration?.name || 'Без рациона',
            groupName: batch.group?.name || 'Без группы',
            ration: batch.ration ? {
                id: batch.ration.id,
                name: batch.ration.name,
                isActive: batch.ration.isActive,
                ingredients: batch.ration.ingredients.map(ing => ({
                    id: ing.id,
                    name: ing.name,
                    plannedWeight: ing.plannedWeight,
                    dryMatterWeight: ing.dryMatterWeight
                }))
            } : null,
            group: batch.group ? {
                id: batch.group.id,
                name: batch.group.name,
                headcount: batch.group.headcount,
                rationId: batch.group.rationId,
                lat: batch.group.lat,
                lon: batch.group.lon,
                radius: batch.group.radius
            } : null,
            
            // Данные для ПЛАШКИ ВЫГРУЗКИ (пункт 4)
            unloadingInfo: {
                barnName: batch.group?.name || 'Коровник не выбран',
                remainingWeight: weightContext.remainingWeight,
                latestTelemetryAt: weightContext.latestTelemetryAt,
                progress: buildUnloadProgress(batch, weightContext.currentWeight, { peakWeight: weightContext.peakWeight })
            },

            // СПИСОК ИНГРЕДИЕНТОВ И ПЛАН/ФАКТ (пункты 2 и 3)
            actualIngredients: batch.actualIngredients.map(ing => ({
                id: ing.id,
                name: ing.ingredientName,
                time: ing.addedAt,
                plan: ing.plannedWeight || 0,
                fact: ing.actualWeight,
                deviation: ing.plannedWeight ? (ing.actualWeight - ing.plannedWeight) : 0,
                isViolation: ing.isViolation
            })),
            ingredients: buildIngredientSummary(batch)
        };

        res.json(detailedBatch);
    } catch (error) {
        console.error('[Ошибка GET /batches/:id]:', error);
        res.status(500).json({ error: 'Не удалось получить замес' });
    }
});

// ============================================================================
// 2. GET /:id/telemetry - Детальная инфа (time/weight) для графика
// ============================================================================
router.get('/:id/telemetry', authenticate, requireReadAccess, async (req, res) => {
    try {
        const batchId = parseInt(req.params.id, 10);
        if (!Number.isInteger(batchId)) {
            return res.status(400).json({ error: 'Некорректный ID замеса' });
        }

        const batch = await prisma.batch.findUnique({
            where: { id: batchId }
        });

        if (!batch) return res.status(404).json({ error: 'Замес не найден' });

        // Ищем все точки телеметрии за время этого замеса
        const telemetryData = await prisma.telemetry.findMany({
            where: {
                deviceId: batch.deviceId,
                timestamp: {
                    gte: batch.startTime,
                    lte: batch.endTime || new Date() // Если еще не закончен, берем до текущего момента
                }
            },
            select: {
                timestamp: true,
                weight: true
            },
            orderBy: { timestamp: 'asc' }
        });

        res.json(telemetryData);
    } catch (error) {
        console.error('[Ошибка графика замеса]:', error);
        res.status(500).json({ error: 'Не удалось получить график замеса' });
    }
});

// ============================================================================
// 3. PATCH /:id - Ручное редактирование (изменение группы или рациона)
// ============================================================================
router.patch('/:id', authenticate, requireWriteAccess, async (req, res) => {
    try {
        const { rationId, groupId } = req.body;
        const batchId = parseInt(req.params.id, 10);

        if (!Number.isInteger(batchId)) {
            return res.status(400).json({ error: 'Некорректный ID замеса' });
        }

        const data = {};

        if (rationId !== undefined) {
            if (rationId === null || rationId === '') {
                data.rationId = null;
            } else {
                const parsedRationId = parseInt(rationId, 10);
                if (!Number.isInteger(parsedRationId)) return res.status(400).json({ error: 'Некорректный rationId' });
                const ration = await prisma.ration.findUnique({ where: { id: parsedRationId } });
                if (!ration) return res.status(404).json({ error: 'Рацион не найден' });
                data.rationId = parsedRationId;
            }
        }

        if (groupId !== undefined) {
            if (groupId === null || groupId === '') {
                data.groupId = null;
            } else {
                const parsedGroupId = parseInt(groupId, 10);
                if (!Number.isInteger(parsedGroupId)) return res.status(400).json({ error: 'Некорректный groupId' });
                const group = await prisma.livestockGroup.findUnique({ where: { id: parsedGroupId } });
                if (!group) return res.status(404).json({ error: 'Группа не найдена' });
                data.groupId = parsedGroupId;
            }
        }
        
        // Обновляем замес новыми данными от пользователя
        const updatedBatch = await prisma.batch.update({
            where: { id: batchId },
            data
        });

        const recalculation = await recalculateBatchViolations(prisma, updatedBatch.id);

        res.json({ status: 'ok', batch: updatedBatch, recalculation });
    } catch (error) {
        console.error('[Ошибка редактирования замеса]:', error);
        if (error.code === 'P2025') return res.status(404).json({ error: 'Замес не найден' });
        res.status(500).json({ error: 'Не удалось обновить замес' });
    }
});

// ============================================================================
// 5. PATCH /:batchId/ingredients/:ingredientId - Замена "Unknown" компонента
// ============================================================================
router.patch('/:batchId/ingredients/:ingredientId', authenticate, requireWriteAccess, async (req, res) => {
    try {
        const { ingredientName } = req.body;
        const batchId = parseInt(req.params.batchId, 10);
        const ingredientId = parseInt(req.params.ingredientId, 10);
        
        if (!Number.isInteger(batchId) || !Number.isInteger(ingredientId)) {
            return res.status(400).json({ error: 'Некорректный ID замеса или ингредиента' });
        }

        if (!ingredientName) {
            return res.status(400).json({ error: 'Не указано новое название корма' });
        }

        const nextIngredientName = String(ingredientName).trim().replace(/\s+/g, ' ');
        if (!nextIngredientName) {
            return res.status(400).json({ error: 'Название корма не может быть пустым' });
        }

        const batch = await prisma.batch.findUnique({
            where: { id: batchId },
            include: {
                ration: { include: { ingredients: true } },
                actualIngredients: true
            }
        });

        if (!batch) {
            return res.status(404).json({ error: 'Замес не найден' });
        }

        const batchIngredient = batch.actualIngredients.find((item) => item.id === ingredientId);
        if (!batchIngredient) {
            return res.status(404).json({ error: 'Ингредиент замеса не найден' });
        }

        if (!batch.ration) {
            return res.status(400).json({ error: 'Нельзя заменить Unknown: у замеса не назначен рацион' });
        }

        const matchedRationIngredient = batch.ration.ingredients.find((item) =>
            normalizeIngredientName(item.name) === normalizeIngredientName(nextIngredientName)
        );

        if (!matchedRationIngredient) {
            return res.status(400).json({
                error: 'Корм не входит в рацион этого замеса',
                allowedIngredients: batch.ration.ingredients.map((item) => item.name)
            });
        }

        // Обновляем имя компонента в базе
        const updatedIngredient = await prisma.batchIngredient.update({
            where: { id: ingredientId },
            data: { ingredientName: matchedRationIngredient.name }
        });

        const recalculation = await recalculateBatchViolations(prisma, batchId);

        res.json({ status: 'ok', ingredient: updatedIngredient, recalculation });
    } catch (error) {
        console.error('[Ошибка обновления ингредиента]:', error);
        if (error.code === 'P2025') return res.status(404).json({ error: 'Ингредиент замеса не найден' });
        res.status(500).json({ error: 'Не удалось обновить ингредиент замеса' });
    }
});

export default router;
