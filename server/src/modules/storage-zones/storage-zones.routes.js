import { Router } from 'express'
import prisma from "../../database.js"
import { authenticate } from "../../middleware/auth.js"

const router = Router()

// GET все активные зоны
router.get('/', async (req, res) => {
  try {
    const zones = await prisma.storageZone.findMany({
      where: { active: true }
    })
    res.json(zones)  // ← без map и toUTC7
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// PUT /:id - Обновление существующей зоны
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, lat, lon, radius, ingredient, active } = req.body;

    // Проверяем, что ID - это число
    const zoneId = parseInt(id, 10);
    if (isNaN(zoneId)) {
      return res.status(400).json({ error: 'Неверный формат ID зоны' });
    }

    // Собираем объект с новыми данными. 
    // Если поле не передали в запросе (undefined), мы его не меняем.
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (lat !== undefined) updateData.lat = parseFloat(lat);
    if (lon !== undefined) updateData.lon = parseFloat(lon);
    if (radius !== undefined) updateData.radius = parseFloat(radius);
    if (ingredient !== undefined) updateData.ingredient = ingredient;
    if (active !== undefined) updateData.active = Boolean(active);

    // Обновляем запись в базе
    const updatedZone = await prisma.storageZone.update({
      where: { id: zoneId },
      data: updateData
    });

    console.log(`[Зоны] Обновлена зона #${zoneId}`);
    res.json({ status: 'ok', zone: updatedZone });

  } catch (error) {
    console.error('[Ошибка обновления зоны]:', error);
    
    // P2025 — это специфичная ошибка Prisma: "Запись не найдена"
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Зона с таким ID не найдена' });
    }
    
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// POST создать зону
router.post('/', /*authMiddleware*/ async (req, res) => {
  try {
    const { name, lat, lon, radius, ingredient } = req.body
    const zone = await prisma.storageZone.create({
      data: { name, lat, lon, radius: radius || 15.0, ingredient }
    })
    res.status(201).json(zone)
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// DELETE деактивировать зону
router.delete('/:id', /*authMiddleware*/ async (req, res) => {
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