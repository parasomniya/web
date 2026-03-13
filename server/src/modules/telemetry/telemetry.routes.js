// src/modules/telemetry/telemetry.routes.js
import { Router } from 'express'
import prisma, { toUTC7 } from "../../database.js"
import { authMiddleware } from "../../middleware/auth.js"


const router = Router()

//Функция расстояния (метры)
function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  return R * c
}

// POST /api/telemetry/host
router.post('/host', async (req, res) => {
  try {
    const { timestamp, weight, lat, lon, deviceId } = req.body
    
    if (typeof weight !== 'number' || weight <= 0) {
      return res.status(400).json({ error: 'Invalid weight' })
    }
    
    // 🔥 Конвертация в UTC+7 ПЕРЕД сохранением
    const inputTimestamp = timestamp ? new Date(timestamp) : new Date()
    const timestampUTC7 = toUTC7(inputTimestamp)
    
    console.log('Original:', inputTimestamp.toISOString())
    console.log('UTC+7:', timestampUTC7.toISOString())
    
    const telemetry = await prisma.telemetry.create({
      data: {
        timestamp: timestampUTC7,  // ← сохраняем в UTC+7
        weight,
        lat,
        lon,
        deviceId: deviceId || 'host_01'
      }
    })

    // Проверка зон (баннеры)
    const zones = await prisma.storageZone.findMany({ where: { active: true } })
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
    
    res.status(201).json({ status: 'ok', id: telemetry.id, banner })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /api/telemetry/latest
router.get('/latest', authMiddleware, async (req, res) => {
  try {
    const data = await prisma.telemetry.findFirst({ orderBy: { timestamp: 'desc' } })
    if (!data) return res.status(404).json({ error: 'No data found' })
    res.json(data)
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /api/telemetry/history
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate, limit = 100 } = req.query
    const history = await prisma.telemetry.findMany({
      where: {
        timestamp: {
          gte: startDate ? toUTC7(new Date(startDate)) : toUTC7(new Date(Date.now() - 24 * 60 * 60 * 1000)),
          lte: endDate ? toUTC7(new Date(endDate)) : toUTC7(new Date())
        }
      },
      orderBy: { timestamp: 'asc' },
      take: parseInt(limit)
    })
    res.json(history)
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
