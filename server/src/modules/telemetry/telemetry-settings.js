import prisma from '../../database.js'

export const TELEMETRY_SETTINGS_SINGLETON_ID = 1

export const DEFAULT_TELEMETRY_SETTINGS = {
  batchStartThresholdKg: 30,
  leftoverThresholdKg: 50,
  unloadDropThresholdKg: 200,
  unloadMinPeakKg: 400,
  unloadUpdateDeltaKg: 1,
  anomalyThresholdKg: 200,
  anomalyConfirmDeltaKg: 40,
  anomalyConfirmPackets: 3,
  zoneChangeConfirmPackets: 2,
  deviationPercentThreshold: 10,
  deviationMinKgThreshold: 10,
  rtkTrackResetTime: '03:00'
}

function toPositiveInteger(value, fallback) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback
  }

  return parsed
}

function normalizeTime(value, fallback) {
  if (typeof value !== 'string') {
    return fallback
  }

  const normalized = value.trim()
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(normalized)) {
    return fallback
  }

  return normalized
}

export function coerceTelemetrySettings(row = {}) {
  return {
    batchStartThresholdKg: toPositiveInteger(row.batchStartThresholdKg, DEFAULT_TELEMETRY_SETTINGS.batchStartThresholdKg),
    leftoverThresholdKg: toPositiveInteger(row.leftoverThresholdKg, DEFAULT_TELEMETRY_SETTINGS.leftoverThresholdKg),
    unloadDropThresholdKg: toPositiveInteger(row.unloadDropThresholdKg, DEFAULT_TELEMETRY_SETTINGS.unloadDropThresholdKg),
    unloadMinPeakKg: toPositiveInteger(row.unloadMinPeakKg, DEFAULT_TELEMETRY_SETTINGS.unloadMinPeakKg),
    unloadUpdateDeltaKg: toPositiveInteger(row.unloadUpdateDeltaKg, DEFAULT_TELEMETRY_SETTINGS.unloadUpdateDeltaKg),
    anomalyThresholdKg: toPositiveInteger(row.anomalyThresholdKg, DEFAULT_TELEMETRY_SETTINGS.anomalyThresholdKg),
    anomalyConfirmDeltaKg: toPositiveInteger(row.anomalyConfirmDeltaKg, DEFAULT_TELEMETRY_SETTINGS.anomalyConfirmDeltaKg),
    anomalyConfirmPackets: toPositiveInteger(row.anomalyConfirmPackets, DEFAULT_TELEMETRY_SETTINGS.anomalyConfirmPackets),
    zoneChangeConfirmPackets: toPositiveInteger(row.zoneChangeConfirmPackets, DEFAULT_TELEMETRY_SETTINGS.zoneChangeConfirmPackets),
    deviationPercentThreshold: toPositiveInteger(row.deviationPercentThreshold, DEFAULT_TELEMETRY_SETTINGS.deviationPercentThreshold),
    deviationMinKgThreshold: toPositiveInteger(row.deviationMinKgThreshold, DEFAULT_TELEMETRY_SETTINGS.deviationMinKgThreshold),
    rtkTrackResetTime: normalizeTime(row.rtkTrackResetTime, DEFAULT_TELEMETRY_SETTINGS.rtkTrackResetTime),
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null
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
  const integerFields = [
    'batchStartThresholdKg',
    'leftoverThresholdKg',
    'unloadDropThresholdKg',
    'unloadMinPeakKg',
    'unloadUpdateDeltaKg',
    'anomalyThresholdKg',
    'anomalyConfirmDeltaKg',
    'anomalyConfirmPackets',
    'zoneChangeConfirmPackets',
    'deviationPercentThreshold',
    'deviationMinKgThreshold'
  ]

  const data = {}

  for (const field of integerFields) {
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

  if (payload.rtkTrackResetTime === undefined) {
    if (!partial) {
      data.rtkTrackResetTime = DEFAULT_TELEMETRY_SETTINGS.rtkTrackResetTime
    }
  } else {
    const normalizedTime = normalizeTime(payload.rtkTrackResetTime, null)
    if (!normalizedTime) {
      return {
        error: 'rtkTrackResetTime должен быть в формате HH:mm'
      }
    }

    data.rtkTrackResetTime = normalizedTime
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
