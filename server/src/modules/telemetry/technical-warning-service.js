export async function syncTechnicalWarnings(db, warnings = [], detectedAt = new Date()) {
  const desiredKeys = new Set()

  for (const warning of warnings) {
    const scopeKey = String(warning.scopeKey || warning.deviceId || 'GLOBAL')
    const code = String(warning.code || '').trim()
    if (!code) {
      continue
    }

    desiredKeys.add(`${scopeKey}:${code}`)

    const existing = await db.technicalWarning.findUnique({
      where: {
        scopeKey_code: {
          scopeKey,
          code
        }
      },
      select: {
        status: true
      }
    })

    await db.technicalWarning.upsert({
      where: {
        scopeKey_code: {
          scopeKey,
          code
        }
      },
      update: {
        deviceId: warning.deviceId || null,
        title: warning.title,
        message: warning.message,
        severity: warning.severity,
        detailsJson: warning.detailsJson || null,
        lastSeenAt: detectedAt,
        resolvedAt: null,
        status: existing?.status === 'ACKNOWLEDGED' ? 'ACKNOWLEDGED' : 'OPEN'
      },
      create: {
        scopeKey,
        deviceId: warning.deviceId || null,
        code,
        title: warning.title,
        message: warning.message,
        severity: warning.severity,
        detailsJson: warning.detailsJson || null,
        firstSeenAt: detectedAt,
        lastSeenAt: detectedAt,
        status: 'OPEN'
      }
    })
  }

  const existingOpenWarnings = await db.technicalWarning.findMany({
    where: {
      status: { in: ['OPEN', 'ACKNOWLEDGED'] }
    },
    select: {
      id: true,
      scopeKey: true,
      code: true,
      status: true
    }
  })

  for (const existing of existingOpenWarnings) {
    const key = `${existing.scopeKey}:${existing.code}`
    if (desiredKeys.has(key)) {
      continue
    }

    await db.technicalWarning.update({
      where: { id: existing.id },
      data: {
        status: 'RESOLVED',
        resolvedAt: detectedAt
      }
    })
  }
}
