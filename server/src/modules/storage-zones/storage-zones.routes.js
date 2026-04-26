import { Router } from 'express'
import prisma from "../../database.js"
import { requireReadAccess, requireWriteAccess } from "../../middleware/auth.js"

const router = Router()

function parseId(value) {
  const id = parseInt(value, 10)
  return Number.isInteger(id) ? id : null
}

function parseBooleanField(value) {
  if (value === undefined) return { ok: true, value: undefined }
  if (typeof value === 'boolean') return { ok: true, value }
  if (typeof value === 'number') return value === 0 || value === 1 ? { ok: true, value: value !== 0 } : { ok: false, value: null }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1') return { ok: true, value: true }
    if (normalized === 'false' || normalized === '0') return { ok: true, value: false }
  }
  return { ok: false, value: null }
}

function parseNumberField(value) {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : NaN
}

function normalizeZonePayload(body, options = {}) {
  const { partial = false } = options
  const data = {}

  if (!partial || body.name !== undefined) {
    const name = String(body.name || '').trim()
    if (!name) {
      return { ok: false, error: 'Название зоны не может быть пустым' }
    }
    data.name = name
  }

  if (!partial || body.ingredient !== undefined) {
    const ingredient = String(body.ingredient || '').trim()
    if (!ingredient) {
      return { ok: false, error: 'Ингредиент не может быть пустым' }
    }
    data.ingredient = ingredient
  }

  if (!partial || body.lat !== undefined) {
    const lat = parseNumberField(body.lat)
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return { ok: false, error: 'Неверный формат широты (lat)' }
    }
    data.lat = lat
  }

  if (!partial || body.lon !== undefined) {
    const lon = parseNumberField(body.lon)
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      return { ok: false, error: 'Неверный формат долготы (lon)' }
    }
    data.lon = lon
  }

  if (!partial || body.radius !== undefined) {
    const radius = body.radius === undefined ? 20.0 : parseNumberField(body.radius)
    if (!Number.isFinite(radius) || radius <= 0) {
      return { ok: false, error: 'Неверный радиус зоны' }
    }
    data.radius = radius
  }

  if (!partial || body.active !== undefined) {
    const parsedActive = parseBooleanField(body.active)
    if (!parsedActive.ok) {
      return { ok: false, error: 'Поле active должно быть boolean true/false' }
    }
    if (parsedActive.value !== undefined) {
      data.active = parsedActive.value
    }
  }

  return { ok: true, data }
}

// GET все активные зоны - доступно для чтения всем авторизованным
router.get('/', requireReadAccess, async (req, res) => {
  try {
    const includeInactive = parseBooleanField(req.query.includeInactive)
    if (!includeInactive.ok) {
      return res.status(400).json({ error: 'Параметр includeInactive должен быть boolean true/false' })
    }

    const zones = await prisma.storageZone.findMany({
      where: includeInactive.value ? undefined : { active: true },
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
    const id = parseId(req.params.id)
    if (!id) {
      return res.status(400).json({ error: 'Некорректный ID зоны' })
    }

    const payload = normalizeZonePayload(req.body, { partial: true })
    if (!payload.ok) {
      return res.status(400).json({ error: payload.error })
    }

    if (Object.keys(payload.data).length === 0) {
      return res.status(400).json({ error: 'Не передано ни одного поля для обновления' })
    }

    const updatedZone = await prisma.storageZone.update({
      where: { id },
      data: payload.data
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
    const payload = normalizeZonePayload(req.body)
    if (!payload.ok) {
      return res.status(400).json({ error: payload.error })
    }

    const zone = await prisma.storageZone.create({
      data: payload.data
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
    const id = parseId(req.params.id)
    if (!id) {
      return res.status(400).json({ error: 'Некорректный ID зоны' })
    }

    await prisma.storageZone.update({
      where: { id },
      data: { active: false }
    })
    res.json({ message: 'Zone deactivated' })
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Зона с таким ID не найдена' })
    }
    console.error(error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
