import { Router } from 'express';
import prisma from "../../database.js";
import { authenticate, requireReadAccess, requireWriteAccess } from "../../middleware/auth.js";
import { recalculateBatchViolations } from './batch-violations.js';

const router = Router();

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
                ration: true, // Связка с "Планом"
                actualIngredients: true // Тут лежат компоненты и их нарушения
            },
            orderBy: { startTime: 'desc' }
        });

        // Форматируем ответ для удобной таблицы фронтенда
        const formattedBatches = batches.map(b => ({
            id: b.id,
            deviceId: b.deviceId,
            startTime: b.startTime,
            endTime: b.endTime,
            rationName: b.ration?.name || 'Неизвестный рацион',
            groupName: b.group?.name || 'Без группы',
            hasViolations: b.hasViolations, // Общий флаг нарушений
            startWeight: b.startWeight,
            endWeight: b.endWeight,
            ingredients: b.actualIngredients.map(ing => ({
                id: ing.id,
                name: ing.ingredientName,
                time: ing.addedAt, // Точное время загрузки
                plan: ing.plannedWeight || 0,
                fact: ing.actualWeight,
                isViolation: ing.isViolation
            }))
        }));

        res.json(formattedBatches);
    } catch (error) {
        console.error('[Ошибка GET /batches]:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// 4. GET /:id - Получить детальную информацию по одному замесу
// ============================================================================
router.get('/:id', authenticate, requireReadAccess, async (req, res) => {
    try {
        const batch = await prisma.batch.findUnique({
            where: { id: parseInt(req.params.id) },
            include: {
                group: true,
                ration: true,
                actualIngredients: {
                    orderBy: { addedAt: 'asc' } // Сортируем по времени добавления
                }
            }
        });

        if (!batch) {
            return res.status(404).json({ error: 'Замес не найден' });
        }

        // Форматируем ответ строго под нужды интерфейса Сони
        const detailedBatch = {
            id: batch.id,
            deviceId: batch.deviceId,
            startTime: batch.startTime,
            endTime: batch.endTime,
            rationName: batch.ration?.name || 'Без рациона',
            
            // Данные для ПЛАШКИ ВЫГРУЗКИ (пункт 4)
            unloadingInfo: {
                barnName: batch.group?.name || 'Коровник не выбран',
                remainingWeight: batch.endWeight || 0
            },

            // СПИСОК ИНГРЕДИЕНТОВ И ПЛАН/ФАКТ (пункты 2 и 3)
            ingredients: batch.actualIngredients.map(ing => ({
                id: ing.id,
                name: ing.ingredientName,
                time: ing.addedAt,
                plan: ing.plannedWeight || 0,
                fact: ing.actualWeight,
                deviation: ing.plannedWeight ? (ing.actualWeight - ing.plannedWeight) : 0,
                isViolation: ing.isViolation
            }))
        };

        res.json(detailedBatch);
    } catch (error) {
        console.error('[Ошибка GET /batches/:id]:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// 2. GET /:id/telemetry - Детальная инфа (time/weight) для графика
// ============================================================================
router.get('/:id/telemetry', authenticate, requireReadAccess, async (req, res) => {
    try {
        const batch = await prisma.batch.findUnique({
            where: { id: parseInt(req.params.id) }
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
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// 3. PATCH /:id - Ручное редактирование (изменение группы или рациона)
// ============================================================================
router.patch('/:id', authenticate, requireWriteAccess, async (req, res) => {
    try {
        const { rationId, groupId } = req.body;
        
        // Обновляем замес новыми данными от пользователя
        const updatedBatch = await prisma.batch.update({
            where: { id: parseInt(req.params.id) },
            data: {
                rationId: rationId ? parseInt(rationId) : undefined,
                groupId: groupId ? parseInt(groupId) : undefined
            }
        });

        const recalculation = await recalculateBatchViolations(prisma, updatedBatch.id);

        res.json({ status: 'ok', batch: updatedBatch, recalculation });
    } catch (error) {
        console.error('[Ошибка редактирования замеса]:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// 5. PATCH /:batchId/ingredients/:ingredientId - Замена "Unknown" компонента
// ============================================================================
router.patch('/:batchId/ingredients/:ingredientId', authenticate, requireWriteAccess, async (req, res) => {
    try {
        const { ingredientName } = req.body;
        
        if (!ingredientName) {
            return res.status(400).json({ error: 'Не указано новое название корма' });
        }

        // Обновляем имя компонента в базе
        const updatedIngredient = await prisma.batchIngredient.update({
            where: { id: parseInt(req.params.ingredientId) },
            data: { ingredientName }
        });

        const recalculation = await recalculateBatchViolations(prisma, req.params.batchId);

        res.json({ status: 'ok', ingredient: updatedIngredient, recalculation });
    } catch (error) {
        console.error('[Ошибка обновления ингредиента]:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
