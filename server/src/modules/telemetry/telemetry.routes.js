import { Router } from 'express'
import prisma from "../../database.js"

const router = Router()

// POST /api/telemetry/host
router.post('/host', async (req, res) => {
  try {
    const { timestamp, weight, lat, lon, deviceId } = req.body
    
    // Валидация
    if (typeof weight !== 'number' || weight <= 0) {
      return res.status(400).json({ error: 'Invalid weight' })
    }
    
    // Сохранение в БД
    const telemetry = await prisma.telemetry.create({
      data: {  // ← вот так правильно!
        timestamp: new Date(timestamp || Date.now()),
        weight,
        lat,
        lon,
        deviceId: deviceId || 'host_01'
      }
    })
    
    res.status(201).json({ status: 'ok', id: telemetry.id })
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

export default router