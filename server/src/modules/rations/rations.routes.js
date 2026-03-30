import { Router } from 'express';
import multer from 'multer';
import * as xlsx from 'xlsx';
import prisma from '../../database.js'; // Убедись, что путь до database.js правильный
import { requireReadAccess, requireWriteAccess } from '../../middleware/auth.js';

const router = Router();

// Настраиваем multer, чтобы он сохранял загруженный файл прямо в оперативную память (буфер)
const upload = multer({ storage: multer.memoryStorage() });

// 1. POST /upload - Загрузка Excel и создание рациона - только для записи
router.post('/upload', requireWriteAccess, upload.single('file'), async (req, res) => {
  try {
    // Название рациона фронтенд может передать обычным текстовым полем вместе с файлом
    const rationName = req.body.name || 'Новый рацион (без названия)';
    
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не загружен' });
    }

    // Читаем Excel файл из памяти
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    
    // Берем первый лист из таблицы
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    // Превращаем лист в массив объектов (ключи будут взяты из первой строки-заголовка)
    const rows = xlsx.utils.sheet_to_json(sheet);

    if (rows.length === 0) {
      return res.status(400).json({ error: 'Excel файл пуст' });
    }

    // Подготавливаем массив ингредиентов для базы
    const ingredientsData = rows.map((row, index) => {
      // ВНИМАНИЕ: Здесь нужно указать точные названия колонок из твоего Excel-файла!
      // Например, если в первой строке Excel написано "Ингредиент", "План", "СВ"
      return {
        name: String(row['Ингредиент'] || `Неизвестно (строка ${index + 1})`),
        plannedWeight: parseFloat(row['План']) || 0,
        dryMatterWeight: parseFloat(row['СВ']) || 0
      };
    });

    // Сохраняем Рацион и все его ингредиенты в базу одним махом
    const newRation = await prisma.ration.create({
      data: {
        name: rationName,
        ingredients: {
          create: ingredientsData
        }
      },
      include: {
        ingredients: true // Чтобы Prisma сразу вернула нам созданные ингредиенты в ответе
      }
    });

    console.log(`[Рационы] Успешно загружен рацион "${rationName}" с ${ingredientsData.length} ингредиентами`);
    res.status(201).json({ status: 'ok', ration: newRation });

  } catch (error) {
    console.error('[Ошибка парсинга Excel]:', error);
    res.status(500).json({ error: 'Ошибка сервера при обработке файла', details: error.message });
  }
});

// 2. GET / - Получить все рационы - доступно для чтения всем авторизованным
router.get('/', requireReadAccess, async (req, res) => {
  try {
    const rations = await prisma.ration.findMany({
      include: { ingredients: true }
    });
    res.json(rations);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 3. DELETE /:id - Удалить рацион - только для записи
router.delete('/:id', requireWriteAccess, async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.ration.delete({
      where: { id: parseInt(id, 10) }
    });
    // Благодаря onDelete: Cascade удалятся и все его RationIngredient
    res.json({ status: 'ok', message: 'Рацион удален' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;