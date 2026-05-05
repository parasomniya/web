import { Router } from 'express'
import prisma from "../../database.js" // Проверь правильность пути к database.js
import { authenticate, requireAdmin, requireWriteAccess } from "../../middleware/auth.js"

const router = Router()

// POST: Прием SMS и звонков
router.post('/', async (req, res) => {
  try {
    const { device_id, type, timestamp, from, text } = req.body

    // Базовая валидация: проверяем, что обязательные поля есть
    if (!device_id || !type || !from) {
      return res.status(400).json({ error: 'Missing required fields: device_id, type, or from' })
    }

    const event = await prisma.deviceEvent.create({
      data: {
        deviceId: device_id,
        type: type,
        timestamp: timestamp ? new Date(timestamp) : new Date(),
        fromNumber: from,
        text: text || '', // Если текста нет (как в звонке), запишем пустую строку
      }
    })

    console.log(`[Event] Получено событие ${type} от ${from} на устройство ${device_id}`)

    res.status(201).json({ status: 'ok', id: event.id })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Internal server error', details: error.message })
  }
})

// GET: Получение последних событий (пригодится для вывода на фронтенд)
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20
    const events = await prisma.deviceEvent.findMany({
      orderBy: { timestamp: 'desc' },
      take: limit
    })
    res.json(events)
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

// DELETE: Очистка журнала событий (только админ)
router.delete('/admin/truncate', authenticate, requireAdmin, requireWriteAccess, async (req, res) => {
  try {
    const deleted = await prisma.deviceEvent.deleteMany({})
    res.json({
      status: 'ok',
      message: 'Журнал событий очищен',
      count: deleted.count
    })
  } catch (error) {
    console.error('[Ошибка DELETE /api/events/admin/truncate]:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
