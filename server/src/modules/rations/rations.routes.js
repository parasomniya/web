import { Router } from 'express';
import multer from 'multer';
import prisma from '../../database.js'; 
import { requireReadAccess, requireWriteAccess } from '../../middleware/auth.js';


// ВРЕМЕННАЯ ЗАГЛУШКА (Удалишь, когда Илья отдаст файл)
const rationManager = {
  parseExcel: (fileBuffer) => {
    // Илья там внутри использует xlsx, проверяет колонки и возвращает:
    return {
      success: true,
      data: [
        { name: 'Силос кукурузный', plannedWeight: 15, dryMatterWeight: 5 },
        { name: 'Сенаж', plannedWeight: 10, dryMatterWeight: 4 }
      ],
      error: null
    };
    // Если ошибка, вернет: { success: false, data: null, error: 'Не найдена колонка "План"' }
  }
};

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// ============================================================================
// POST /upload - Загрузка Excel и создание рациона
// ============================================================================
router.post('/upload', requireWriteAccess, upload.single('file'), async (req, res) => {
  try {
    const rationName = req.body.name?.trim();
    // Связь с группами: фронтенд должен передать ID группы, для которой этот рацион
    const groupId = req.body.groupId ? parseInt(req.body.groupId, 10) : null; 
    
    if (!rationName) return res.status(400).json({ error: 'Необходимо указать название рациона' });
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });

    // ЗАДАЧА: Уникальность названий для рационов
    const existing = await prisma.ration.findFirst({ where: { name: rationName } });
    if (existing) {
      return res.status(400).json({ error: `Рацион с названием "${rationName}" уже существует. Выберите другое имя или удалите старый.` });
    }

    // Отдаем буфер файла
    const parsedResult = rationManager.parseExcel(req.file.buffer);

    // ЗАДАЧА: Обработка ошибок для пользователя в парсинге
    if (!parsedResult.success) {
      return res.status(400).json({ error: `Ошибка в Excel файле: ${parsedResult.error}` });
    }

    // Сохраняем в базу
    // Сохраняем рацион и его ингредиенты
    const newRation = await prisma.ration.create({
      data: {
        name: rationName,
        isActive: false, // Теперь поле есть в базе!
        ingredients: {
          create: parsedResult.data
        }
      },
      include: { ingredients: true }
    });

    // СВЯЗЬ С ГРУППАМИ: Если фронт прислал массив ID групп, привязываем их к рациону
    // Например, Соня передала в body: groups = "[1, 2]" (ID коровников)
    if (req.body.groups) {
        try {
            const groupIds = JSON.parse(req.body.groups); // парсим массив из строки FormData
            if (Array.isArray(groupIds) && groupIds.length > 0) {
                // Обновляем все выбранные группы, прописывая им ID нового рациона
                await prisma.livestockGroup.updateMany({
                    where: { id: { in: groupIds } },
                    data: { rationId: newRation.id }
                });
            }
        } catch (e) {
            console.warn('[Рационы] Не удалось распарсить группы:', req.body.groups);
        }
    }

    console.log(`[Рационы] Загружен рацион "${rationName}"`);
    res.status(201).json({ status: 'ok', ration: newRation });

  } catch (error) {
    console.error('[Ошибка POST /upload]:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера при сохранении рациона' });
  }
});

// ============================================================================
// GET / - Получить все рационы
// ============================================================================
router.get('/', requireReadAccess, async (req, res) => {
  try {
    const rations = await prisma.ration.findMany({
      include: { ingredients: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json(rations);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// PATCH /:id/toggle - Активировать/Деактивировать рацион (Для кнопок Сони)
// ============================================================================
router.patch('/:id/toggle', requireWriteAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body; // Фронт передает { "isActive": true/false }

    const updated = await prisma.ration.update({
      where: { id: parseInt(id, 10) },
      data: { isActive: Boolean(isActive) }
    });

    res.json({ status: 'ok', message: isActive ? 'Рацион активирован' : 'Рацион деактивирован', ration: updated });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка при изменении статуса рациона' });
  }
});

// ============================================================================
// DELETE /:id - Удалить рацион
// ============================================================================
router.delete('/:id', requireWriteAccess, async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.ration.delete({
      where: { id: parseInt(id, 10) }
    });
    res.json({ status: 'ok', message: 'Рацион успешно удален' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
