import prisma from '../../database.js'

export const TELEMETRY_SETTINGS_SINGLETON_ID = 1

export const DEFAULT_TELEMETRY_SETTINGS = {
  batchStartThresholdKg: 30,
  leftoverThresholdKg: 50,
  unloadDropThresholdKg: 200,
  unloadMinPeakKg: 400,
  unloadUpdateDeltaKg: 1
}

function toPositiveInteger(value, fallback) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback
  }

  return parsed
}

export function coerceTelemetrySettings(row = {}) {
  return {
    batchStartThresholdKg: toPositiveInteger(row.batchStartThresholdKg, DEFAULT_TELEMETRY_SETTINGS.batchStartThresholdKg),
    leftoverThresholdKg: toPositiveInteger(row.leftoverThresholdKg, DEFAULT_TELEMETRY_SETTINGS.leftoverThresholdKg),
    unloadDropThresholdKg: toPositiveInteger(row.unloadDropThresholdKg, DEFAULT_TELEMETRY_SETTINGS.unloadDropThresholdKg),
    unloadMinPeakKg: toPositiveInteger(row.unloadMinPeakKg, DEFAULT_TELEMETRY_SETTINGS.unloadMinPeakKg),
    unloadUpdateDeltaKg: toPositiveInteger(row.unloadUpdateDeltaKg, DEFAULT_TELEMETRY_SETTINGS.unloadUpdateDeltaKg)
  }
}

export async function getTelemetrySettings(db = prisma) {
  const row = await db.telemetrySettings.findUnique({
    where: { id: TELEMETRY_SETTINGS_SINGLETON_ID }
  })

  if (!row) {
    return { ...DEFAULT_TELEMETRY_SETTINGS }
  }

  return coerceTelemetrySettings(row)
}

export function validateTelemetrySettingsInput(payload = {}, { partial = false } = {}) {
  const fields = [
    'batchStartThresholdKg',
    'leftoverThresholdKg',
    'unloadDropThresholdKg',
    'unloadMinPeakKg',
    'unloadUpdateDeltaKg'
  ]

  const data = {}

  for (const field of fields) {
    if (payload[field] === undefined) {
      if (!partial) {
        data[field] = DEFAULT_TELEMETRY_SETTINGS[field]
      }
      continue
    }

    const parsed = Number(payload[field])
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return {
        error: `${field} должен быть положительным целым числом`
      }
    }

    data[field] = parsed
  }

  return { data }
}

export async function upsertTelemetrySettings(payload = {}, db = prisma) {
  const validation = validateTelemetrySettingsInput(payload, { partial: true })
  if (validation.error) {
    throw new Error(validation.error)
  }

  return db.telemetrySettings.upsert({
    where: { id: TELEMETRY_SETTINGS_SINGLETON_ID },
    update: validation.data,
    create: {
      id: TELEMETRY_SETTINGS_SINGLETON_ID,
      ...DEFAULT_TELEMETRY_SETTINGS,
      ...validation.data
    }
  })
}
