import { detectZoneObject } from '../../../../module-1/geo.js'

export const TELEMETRY_FRESHNESS_MS = 15000

export function isFreshTimestamp(value, thresholdMs = TELEMETRY_FRESHNESS_MS) {
  if (!value) return false

  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return false

  return (Date.now() - timestamp) < thresholdMs
}

function buildFreshnessBoundary(referenceTime, thresholdMs = TELEMETRY_FRESHNESS_MS) {
  const parsedReference = referenceTime ? new Date(referenceTime) : new Date()
  const referenceTimestamp = Number.isNaN(parsedReference.getTime()) ? Date.now() : parsedReference.getTime()
  return new Date(referenceTimestamp - thresholdMs)
}

export async function findFreshRtkPoint(prisma, { deviceId = null, referenceTime = null, thresholdMs = TELEMETRY_FRESHNESS_MS } = {}) {
  const freshnessBoundary = buildFreshnessBoundary(referenceTime, thresholdMs)

  if (deviceId) {
    const sameDevicePoint = await prisma.rtkTelemetry.findFirst({
      where: {
        deviceId,
        timestamp: { gte: freshnessBoundary }
      },
      orderBy: [
        { timestamp: 'desc' },
        { id: 'desc' }
      ]
    })

    if (sameDevicePoint) {
      return sameDevicePoint
    }
  }

  return prisma.rtkTelemetry.findFirst({
    where: {
      timestamp: { gte: freshnessBoundary }
    },
    orderBy: [
      { timestamp: 'desc' },
      { id: 'desc' }
    ]
  })
}

export async function resolveEffectiveCoordinates(prisma, telemetryLike, options = {}) {
  const source = telemetryLike || {}
  const referenceTime = options.referenceTime || source.timestamp || new Date()
  const rtkPoint = await findFreshRtkPoint(prisma, {
    deviceId: options.deviceId || source.deviceId || null,
    referenceTime,
    thresholdMs: options.thresholdMs || TELEMETRY_FRESHNESS_MS
  })

  if (rtkPoint) {
    return {
      lat: Number(rtkPoint.lat),
      lon: Number(rtkPoint.lon),
      source: 'rtk',
      rtkPoint
    }
  }

  return {
    lat: Number(source.lat),
    lon: Number(source.lon),
    source: 'host',
    rtkPoint: null
  }
}

export function getZoneByCoordinates(lat, lon, zones = []) {
  if (!Array.isArray(zones) || !zones.length) {
    return null
  }

  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) {
    return null
  }

  return detectZoneObject(Number(lat), Number(lon), zones)
}

function buildGroupZoneShape(group) {
  if (group?.storageZone) {
    return {
      ...group.storageZone,
      lat: Number(group.storageZone.lat),
      lon: Number(group.storageZone.lon),
      radius: Number(group.storageZone.radius),
    }
  }

  if (
    Number.isFinite(Number(group?.lat)) &&
    Number.isFinite(Number(group?.lon)) &&
    Number.isFinite(Number(group?.radius)) &&
    Number(group.radius) > 0
  ) {
    return {
      id: `group-fallback-${group.id}`,
      name: group.name,
      lat: Number(group.lat),
      lon: Number(group.lon),
      radius: Number(group.radius),
      shapeType: 'CIRCLE',
      active: true,
    }
  }

  return null
}

export async function resolveGroupByCoordinates(prisma, lat, lon) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) {
    return null
  }

  const groups = await prisma.livestockGroup.findMany({
    include: {
      storageZone: true,
    },
    orderBy: { id: 'asc' },
  })

  for (const group of groups) {
    const zoneCandidate = buildGroupZoneShape(group)
    if (!zoneCandidate) continue

    const matchedZone = detectZoneObject(Number(lat), Number(lon), [zoneCandidate])
    if (!matchedZone) continue

    return {
      id: group.id,
      name: group.name,
      rationId: group.rationId ?? null,
      storageZoneId: group.storageZoneId ?? null,
      matchedZoneId: group.storageZone?.id ?? null,
    }
  }

  return null
}
