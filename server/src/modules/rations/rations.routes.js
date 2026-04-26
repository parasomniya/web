import { Router } from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import prisma from '../../database.js'; 
import { requireReadAccess, requireWriteAccess } from '../../middleware/auth.js';
import { processRationRows } from '../../../../module-2/rationManager.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

function normalizeRationName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function parseId(value) {
  const id = parseInt(value, 10);
  return Number.isInteger(id) ? id : null;
}

function parseStrictBoolean(value) {
  if (typeof value === 'boolean') return { ok: true, value };
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return { ok: true, value: true };
    if (normalized === 'false') return { ok: true, value: false };
  }
  return { ok: false, value: null };
}

function parseExcel(fileBuffer) {
  try {
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];

    if (!firstSheetName) {
      return { success: false, data: null, error: 'В Excel-файле нет листов' };
    }

    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { defval: '' });
    const parsed = processRationRows(rows);

    return {
      success: parsed.success,
      data: parsed.success ? parsed.data : null,
      errors: parsed.errors,
      error: parsed.errors.join('; ')
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      errors: ['Не удалось прочитать Excel-файл. Проверьте структуру листа и формат данных'],
      error: 'Не удалось прочитать Excel-файл. Проверьте структуру листа и формат данных'
    };
  }
}

async function findRationByNormalizedName(name) {
  const normalizedName = normalizeRationName(name);
  if (!normalizedName) return null;

  const rations = await prisma.ration.findMany({
    select: { id: true, name: true }
  });

  return rations.find((item) => normalizeRationName(item.name) === normalizedName) || null;
}

// ============================================================================
// POST /upload - Загрузка Excel и создание рациона
// ============================================================================
router.post('/upload', requireWriteAccess, upload.single('file'), async (req, res) => {
  try {
    const rationName = String(req.body.name || '').trim().replace(/\s+/g, ' ');
    
    if (!rationName) return res.status(400).json({ error: 'Необходимо указать название рациона' });
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
    if (req.body.groupId !== undefined) {
      return res.status(400).json({ error: 'Используйте единый формат groups: JSON-массив ID групп' });
    }

    // ЗАДАЧА: Уникальность названий для рационов
    const existing = await findRationByNormalizedName(rationName);
    if (existing) {
      return res.status(400).json({ error: `Рацион с названием "${rationName}" уже существует. Выберите другое имя или удалите старый.` });
    }

    // Отдаем буфер файла
    const parsedResult = parseExcel(req.file.buffer);

    // ЗАДАЧА: Обработка ошибок для пользователя в парсинге
    if (!parsedResult.success) {
      return res.status(400).json({
        error: `Ошибка в Excel файле: ${parsedResult.errors?.[0] || parsedResult.error}`,
        details: parsedResult.errors || []
      });
    }

    let selectedGroupIds = [];
    if (req.body.groups) {
        try {
            const groupIds = JSON.parse(req.body.groups);
            if (!Array.isArray(groupIds)) {
                return res.status(400).json({ error: 'groups должен быть JSON-массивом ID групп' });
            }
            selectedGroupIds = [...new Set(groupIds.map(id => parseInt(id, 10)))];
        } catch (e) {
            return res.status(400).json({ error: 'groups должен быть корректным JSON-массивом ID групп' });
        }

        if (selectedGroupIds.some(id => !Number.isInteger(id))) {
            return res.status(400).json({ error: 'groups должен содержать только числовые ID групп' });
        }

        if (selectedGroupIds.length > 0) {
            const existingGroups = await prisma.livestockGroup.findMany({
                where: { id: { in: selectedGroupIds } },
                select: { id: true }
            });
            if (existingGroups.length !== selectedGroupIds.length) {
                return res.status(404).json({ error: 'Одна или несколько групп не найдены' });
            }
        }
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

    // СВЯЗЬ С ГРУППАМИ: единый формат groups = "[1,2]"
    if (selectedGroupIds.length > 0) {
        await prisma.livestockGroup.updateMany({
            where: { id: { in: selectedGroupIds } },
            data: { rationId: newRation.id }
        });
    }

    const rationWithGroups = await prisma.ration.findUnique({
      where: { id: newRation.id },
      include: {
        ingredients: true,
        livestockGroups: {
          select: {
            id: true,
            name: true,
            headcount: true
          }
        }
      }
    });

    console.log(`[Рационы] Загружен рацион "${rationName}"`);
    res.status(201).json({ status: 'ok', ration: rationWithGroups || newRation });

  } catch (error) {
    console.error('[Ошибка POST /upload]:', error);
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'Рацион с таким названием уже существует' });
    }
    res.status(500).json({ error: 'Внутренняя ошибка сервера при сохранении рациона' });
  }
});

// ============================================================================
// GET / - Получить все рационы
// ============================================================================
router.get('/', requireReadAccess, async (req, res) => {
  try {
    const rations = await prisma.ration.findMany({
      include: {
        ingredients: true,
        livestockGroups: {
          select: {
            id: true,
            name: true,
            headcount: true
          }
        }
      },
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
    const id = parseId(req.params.id);
    const { isActive } = req.body; // Фронт передает { "isActive": true/false }
    const parsedIsActive = parseStrictBoolean(isActive);

    if (!id) {
      return res.status(400).json({ error: 'Некорректный ID рациона' });
    }

    if (!parsedIsActive.ok) {
      return res.status(400).json({ error: 'isActive должен быть boolean true/false' });
    }

    const updated = await prisma.ration.update({
      where: { id },
      data: { isActive: parsedIsActive.value }
    });

    res.json({ status: 'ok', message: parsedIsActive.value ? 'Рацион активирован' : 'Рацион деактивирован', ration: updated });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Рацион не найден' });
    res.status(500).json({ error: 'Ошибка при изменении статуса рациона' });
  }
});

// ============================================================================
// DELETE /:id - Удалить рацион
// ============================================================================
router.delete('/:id', requireWriteAccess, async (req, res) => {
  try {
    const id = parseId(req.params.id);

    if (!id) {
      return res.status(400).json({ error: 'Некорректный ID рациона' });
    }

    const ration = await prisma.ration.findUnique({ where: { id } });
    if (!ration) {
      return res.status(404).json({ error: 'Рацион не найден' });
    }

    const [linkedGroups, linkedBatches] = await Promise.all([
      prisma.livestockGroup.count({ where: { rationId: id } }),
      prisma.batch.count({ where: { rationId: id } })
    ]);

    if (linkedBatches > 0) {
      return res.status(409).json({
        error: 'Рацион нельзя удалить: он уже используется в истории замесов',
        details: {
          linkedGroups,
          linkedBatches,
          hint: 'Сначала назначьте другой рацион в замесах или оставьте рацион для истории'
        }
      });
    }

    await prisma.$transaction([
      prisma.livestockGroup.updateMany({
        where: { rationId: id },
        data: { rationId: null }
      }),
      prisma.ration.delete({ where: { id } })
    ]);

    res.json({
      status: 'ok',
      message: linkedGroups > 0
        ? 'Рацион удален, привязки к группам сняты'
        : 'Рацион успешно удален'
    });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Рацион не найден' });
    console.error('[Ошибка DELETE /rations/:id]:', error);
    res.status(500).json({ error: 'Не удалось удалить рацион' });
  }
});

export default router;
