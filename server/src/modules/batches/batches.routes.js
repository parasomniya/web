import { Router } from 'express';
import prisma from "../../database.js"; // Проверь путь к своей БД
import { authenticate, requireReadAccess } from "../../middleware/auth.js"; // Проверь пути

const router = Router();

// GET /api/batches - Получить историю операций
router.get('/', authenticate, requireReadAccess, async (req, res) => {
    try {
        const batches = await prisma.batch.findMany({
            include: {
                group: true,
                actualIngredients: true
            },
            orderBy: {
                startTime: 'desc'
            }
        });

        const operationsLog = [];

        batches.forEach(b => {
            // Добавляем шаги загрузки
            b.actualIngredients.forEach(ing => {
                operationsLog.push({
                    id: `load_${ing.id}`,
                    time: b.startTime, 
                    action: 'Загрузка',
                    zone: ing.ingredientName,
                    weight: `+${ing.actualWeight.toFixed(0)} кг`,
                    status: b.endTime ? 'Завершен' : 'В процессе'
                });
            });

            // Добавляем шаг выгрузки (если трактор уже разгрузился)
            if (b.endTime) {
                operationsLog.push({
                    id: `unload_${b.id}`,
                    time: b.endTime,
                    action: 'Разгрузка (Замес завершен)',
                    zone: b.group ? b.group.name : 'Коровник',
                    weight: `Остаток: ${b.endWeight?.toFixed(0) || 0} кг`,
                    status: 'Завершен'
                });
            }
        });

        // Сортируем так, чтобы последние действия были сверху таблицы
        operationsLog.sort((a, b) => new Date(b.time) - new Date(a.time));

        res.json(operationsLog);
    } catch (error) {
        console.error('[Ошибка получения логов]:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;