import { Router } from 'express'
import prisma from "../../database.js"
import { authMiddleware } from "../../middleware/auth.js"


const router = Router()

function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000 // Радиус Земли в метрах
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  return R * c
}


router.post('/host', async (req, res) => {
  try {
    const { timestamp, weight, lat, lon, deviceId } = req.body
    
    // Валидация
    if (typeof weight !== 'number' || weight <= 0) {
      return res.status(400).json({ error: 'Invalid weight' })
    }
    
    // Сохранение в БД
    const telemetry = await prisma.telemetry.create({
       date: {
        timestamp: new Date(timestamp || Date.now()),
        weight,
        lat,
        lon,
        deviceId: deviceId || 'host_01'
      }
    })
    
    // 🔥 ПРОВЕРКА ПОПАДАНИЯ В ЗОНУ
    const zones = await prisma.storageZone.findMany({
      where: { active: true }
    })
    
    let banner = null
    for (const zone of zones) {
      const distance = getDistanceFromLatLonInMeters(lat, lon, zone.lat, zone.lon)
      if (distance <= (zone.radius || 15)) {
        banner = {
          type: 'zone_enter',
          zoneName: zone.name,
          ingredient: zone.ingredient,
          message: `Въезд в зону: ${zone.name}`
        }
        break
      }
    }
    
    // Возвращаем ответ с баннером
    res.status(201).json({ 
      status: 'ok', 
      id: telemetry.id,
      banner // ← если null — вне зоны
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /api/telemetry (все записи)
router.get('/', async (req, res) => {
  try {
    const data = await prisma.telemetry.findMany({
      orderBy: { timestamp: 'desc' },
      take: 100
    })
    res.json(data)
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /api/telemetry/latest (последняя запись)
router.get('/latest', async (req, res) => {
  try {
    const data = await prisma.telemetry.findFirst({
      orderBy: { timestamp: 'desc' }
    })
    res.json(data)
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /api/telemetry/history (история за период)
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query
    
    const history = await prisma.telemetry.findMany({
      where: {
        timestamp: {
          gte: startDate ? new Date(startDate) : new Date(Date.now() - 24 * 60 * 60 * 1000),
          lte: endDate ? new Date(endDate) : new Date()
        }
      },
      orderBy: { timestamp: 'asc' },
      take: 1000
    })
    
    res.json(history)
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router