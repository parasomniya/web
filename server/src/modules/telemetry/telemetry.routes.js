// src/modules/telemetry/telemetry.routes.js
import { Router } from 'express'
import prisma from "../../database.js"

const router = Router()

// Функция расстояния (метры)
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

// ============================================
// POST /api/telemetry/host
// ============================================
router.post('/', async (req, res) => {
  console.log('📩 POST /host received:', req.body)
  
  try {
    const { timestamp, weight, lat, lon, deviceId } = req.body
    
    // Валидация
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return res.status(400).json({ error: 'Invalid coordinates' })
    }
    
    // Сохранение в БД
    const telemetry = await prisma.telemetry.create({
      data: {
        timestamp: new Date(),
        weight: weight || 0,
        lat,
        lon,
        deviceId: deviceId || 'host_01'
      }
    })
    console.log('Saved to DB with ID:', telemetry.id)

    // Проверка зон (баннеры)
    const zones = await prisma.storageZone.findMany({ where: { active: true } })
    let banner = null
    for (const zone of zones) {
      const distance = getDistanceFromLatLonInMeters(lat, lon, zone.lat, zone.lon)
      if (distance <= (zone.radius || 50)) {
        banner = {
          type: 'zone_enter',
          zoneName: zone.name,
          message: `Въезд в зону: ${zone.name}`
        }
        console.log('Banner:', banner.message)
        break
      }
    }
    
    res.status(201).json({ status: 'ok', id: telemetry.id, banner })
  } catch (error) {
    console.error('ERROR:', error.message)
    res.status(500).json({ error: 'Internal server error', details: error.message })
  }
})

// ============================================
// GET /api/telemetry/host/latest
// ============================================
router.get('/latest', async (req, res) => {
  console.log('GET /latest requested')
  try {
    const data = await prisma.telemetry.findFirst({ 
      orderBy: { timestamp: 'desc' } 
    })
    console.log('Returning:', data)
    if (!data) return res.status(404).json({ error: 'No data found' })
    res.json(data)
  } catch (error) {
    console.error('ERROR:', error.message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ============================================
// GET /api/telemetry/host/history
// ============================================
router.get('/history', async (req, res) => {
  console.log('GET /history requested')
  try {
    const limit = parseInt(req.query.limit) || 10
    const data = await prisma.telemetry.findMany({ 
      orderBy: { timestamp: 'desc' },
      take: limit
    })
    res.json(data)
  } catch (error) {
    console.error('ERROR:', error.message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router