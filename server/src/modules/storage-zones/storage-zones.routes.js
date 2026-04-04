import { Router } from 'express'
import prisma from "../../database.js"
import { requireReadAccess, requireWriteAccess } from "../../middleware/auth.js"

const router = Router()

function parseActiveFlag(value) {
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1') return true
    if (normalized === 'false' || normalized === '0') return false
  }
  return Boolean(value)
}

// GET все активные зоны - доступно для чтения всем авторизованным
router.get('/', requireReadAccess, async (req, res) => {
  try {
    const zones = await prisma.storageZone.findMany({
      orderBy: [
        { active: 'desc' },
        { id: 'asc' }
      ]
    })
    res.json(zones)  // ← без map и toUTC7
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// PUT /:id - Обновление существующей зоны - только для записи
router.put('/:id', requireWriteAccess, async (req, res) => {
  try {
    const { id } = req.params;
    // Достаем lat и lon из тела запроса
    const { name, ingredient, radius, lat, lon, active } = req.body;

    // Подготавливаем объект с данными для обновления
    const updateData = {};

    if (name !== undefined) updateData.name = String(name).trim();
    if (ingredient !== undefined) updateData.ingredient = String(ingredient).trim();
    if (radius !== undefined) updateData.radius = parseFloat(radius);
    if (active !== undefined) updateData.active = parseActiveFlag(active);

    // Валидация и добавление координат, если фронтенд их прислал
    if (lat !== undefined) {
      const parsedLat = parseFloat(lat);
      if (isNaN(parsedLat) || parsedLat < -90 || parsedLat > 90) {
        return res.status(400).json({ error: 'Неверный формат широты (lat)' });
      }
      updateData.lat = parsedLat;
    }

    if (lon !== undefined) {
      const parsedLon = parseFloat(lon);
      if (isNaN(parsedLon) || parsedLon < -180 || parsedLon > 180) {
        return res.status(400).json({ error: 'Неверный формат долготы (lon)' });
      }
      updateData.lon = parsedLon;
    }

    if (updateData.name !== undefined && updateData.name.length === 0) {
      return res.status(400).json({ error: 'Название зоны не может быть пустым' });
    }

    if (updateData.ingredient !== undefined && updateData.ingredient.length === 0) {
      return res.status(400).json({ error: 'Ингредиент не может быть пустым' });
    }

    if (updateData.radius !== undefined) {
      if (!Number.isFinite(updateData.radius) || updateData.radius <= 0) {
        return res.status(400).json({ error: 'Неверный радиус зоны' });
      }
    }

    // Записываем изменения в базу
    const updatedZone = await prisma.storageZone.update({
      where: { id: parseInt(id, 10) },
      data: updateData
    });

    res.json({ status: 'ok', zone: updatedZone });
  } catch (error) {
    // Если Prisma не нашла зону по ID, она выкинет ошибку с кодом P2025
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Зона с таким ID не найдена' });
    }
    console.error('[Ошибка обновления зоны]:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST создать зону - только для записи
router.post('/', requireWriteAccess, async (req, res) => {
  try {
    const { name, lat, lon, radius, ingredient, active } = req.body
    const zone = await prisma.storageZone.create({
      data: {
        name,
        lat,
        lon,
        radius: radius || 20.0,
        ingredient,
        active: active !== undefined ? parseActiveFlag(active) : true
      }
    })
    res.status(201).json(zone)
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// DELETE деактивировать зону - только для записи
router.delete('/:id', requireWriteAccess, async (req, res) => {
  try {
    const { id } = req.params
    await prisma.storageZone.update({
      where: { id: parseInt(id) },
      data: { active: false }
    })
    res.json({ message: 'Zone deactivated' })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
