import { Router } from 'express'
import prisma from "../../database.js"  // ← из database.js, не напрямую из generated!
import { authMiddleware } from "../../middleware/auth.js"

const router = Router()

// GET все активные зоны
router.get('/', async (req, res) => {
  try {
    const zones = await prisma.storageZone.findMany({
      where: { active: true }
    })
    
    // Конвертация createdAt в UTC+7 для ответа
    res.json(zones.map(zone => ({
      ...zone,
      createdAt: toUTC7(zone.createdAt).toISOString()
    })))
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST создать зону
router.post('/', authMiddleware, async (req, res) => {
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
router.delete('/:id', authMiddleware, async (req, res) => {
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

export default router  // ← ОБЯЗАТЕЛЬНО в самом конце!