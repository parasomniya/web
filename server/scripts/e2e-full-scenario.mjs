import XLSX from 'xlsx'

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000'
const scenarioLog = []

function apiUrl(path) {
  return `${BASE_URL}${path}`
}

function pushLog(step, details) {
  scenarioLog.push({ step, ...details })
}

async function readResponseBody(response) {
  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    try {
      return await response.json()
    } catch (error) {
      return null
    }
  }

  try {
    return await response.text()
  } catch (error) {
    return null
  }
}

async function request(method, path, options = {}) {
  const headers = {
    ...(options.headers || {})
  }

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`
  }

  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  const response = await fetch(apiUrl(path), {
    method,
    headers,
    body: options.form
      ? options.form
      : options.json !== undefined
        ? JSON.stringify(options.json)
        : undefined
  })

  const body = await readResponseBody(response)
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status}: ${JSON.stringify(body)}`)
  }

  return body
}

function buildRationWorkbookBuffer() {
  const rows = [
    { 'Ингредиент': 'Силос', 'План': 520, 'СВ': 180 },
    { 'Ингредиент': 'Сено', 'План': 120, 'СВ': 80 }
  ]

  const worksheet = XLSX.utils.json_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Рацион')
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
}

function isoAt(baseTimeMs, offsetSeconds) {
  return new Date(baseTimeMs + offsetSeconds * 1000).toISOString()
}

async function main() {
  const startedAt = new Date()
  const runTag = Date.now().toString().slice(-6)
  const userName = `e2e_operator_${runTag}`
  const userEmail = `e2e.operator.${runTag}@example.com`
  const circleZoneName = `Силосная зона E2E ${runTag}`
  const squareZoneName = `Сенная зона E2E ${runTag}`
  const unloadZoneName = `Коровник E2E ${runTag}`
  const rationName = `Рацион E2E ${runTag}`
  const mainGroupName = `Группа E2E ${runTag}`
  const updatedGroupName = `Группа E2E основная ${runTag}`
  const tempGroupName = `Группа E2E временная ${runTag}`

  const health = await request('GET', '/api/health')
  pushLog('health', { status: 'ok', health })

  const login = await request('POST', '/api/auth/login', {
    json: {
      username: 'admin',
      password: 'KorovkiTOP'
    }
  })
  const adminToken = login.token
  pushLog('login', { status: 'ok', role: login.role })

  const createdUser = await request('POST', '/api/users', {
    token: adminToken,
    json: {
      username: userName,
      email: userEmail,
      password: 'Operator123',
      role: 'GUEST'
    }
  })
  pushLog('user_create', { status: 'ok', id: createdUser.id })

  const promotedUser = await request('PATCH', `/api/users/${createdUser.id}/role`, {
    token: adminToken,
    json: { role: 'DIRECTOR' }
  })
  pushLog('user_patch_role', { status: 'ok', role: promotedUser.user?.role || 'DIRECTOR' })

  const circleZone = await request('POST', '/api/telemetry/zones', {
    token: adminToken,
    json: {
      name: circleZoneName,
      ingredient: 'Силос',
      shapeType: 'CIRCLE',
      lat: 52.5284,
      lon: 85.1275,
      radius: 40,
      active: true
    }
  })
  pushLog('zone_circle_create', { status: 'ok', id: circleZone.id })

  const squareZone = await request('POST', '/api/telemetry/zones', {
    token: adminToken,
    json: {
      name: squareZoneName,
      ingredient: 'Сено',
      shapeType: 'SQUARE',
      lat: 52.5292,
      lon: 85.1284,
      sideMeters: 60,
      active: true
    }
  })
  pushLog('zone_square_create', { status: 'ok', id: squareZone.id })

  const unloadZone = await request('POST', '/api/telemetry/zones', {
    token: adminToken,
    json: {
      name: unloadZoneName,
      ingredient: 'Коровник',
      shapeType: 'CIRCLE',
      lat: 52.53,
      lon: 85.1293,
      radius: 45,
      active: true
    }
  })
  pushLog('zone_unload_create', { status: 'ok', id: unloadZone.id })

  const form = new FormData()
  form.append('name', rationName)
  form.append(
    'file',
    new Blob(
      [buildRationWorkbookBuffer()],
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
    ),
    'ration-e2e.xlsx'
  )
  const rationUpload = await request('POST', '/api/rations/upload', {
    token: adminToken,
    form
  })
  const ration = rationUpload.ration
  pushLog('ration_upload', { status: 'ok', id: ration.id, ingredients: ration.ingredients?.length || 0 })

  const mainGroup = await request('POST', '/api/groups', {
    token: adminToken,
    json: {
      name: mainGroupName,
      headcount: 1,
      rationId: ration.id,
      storageZoneId: unloadZone.id
    }
  })
  pushLog('group_create', { status: 'ok', id: mainGroup.id })

  const updatedGroup = await request('PUT', `/api/groups/${mainGroup.id}`, {
    token: adminToken,
    json: {
      name: updatedGroupName,
      headcount: 1,
      rationId: ration.id,
      storageZoneId: unloadZone.id
    }
  })
  pushLog('group_update', { status: 'ok', id: updatedGroup.group?.id || mainGroup.id })

  const tempGroup = await request('POST', '/api/groups', {
    token: adminToken,
    json: {
      name: tempGroupName,
      headcount: 5,
      storageZoneId: circleZone.id
    }
  })
  pushLog('group_temp_create', { status: 'ok', id: tempGroup.id })

  await request('DELETE', `/api/groups/${tempGroup.id}`, {
    token: adminToken
  })
  pushLog('group_delete', { status: 'ok', id: tempGroup.id })

  const deviceEvent = await request('POST', '/api/events', {
    json: {
      device_id: 'host_01',
      type: 'sms',
      timestamp: new Date().toISOString(),
      from: '+79990000000',
      text: 'E2E test event'
    }
  })
  pushLog('event_post', { status: 'ok', id: deviceEvent.id })

  const events = await request('GET', '/api/events?limit=5', {
    token: adminToken
  })
  pushLog('event_get', { status: 'ok', count: Array.isArray(events) ? events.length : 0 })

  const digestSettings = await request('PUT', '/api/digest-settings', {
    token: adminToken,
    json: {
      enabled: false,
      senderEmail: 'digest@example.com',
      sendTime: '08:00',
      timezone: 'Asia/Novosibirsk',
      recipients: ['digest@example.com']
    }
  })
  pushLog('digest_put', { status: 'ok', enabled: digestSettings.settings?.enabled ?? false })

  const digestLoaded = await request('GET', '/api/digest-settings', {
    token: adminToken
  })
  pushLog('digest_get', { status: 'ok', recipients: digestLoaded.recipients?.length || 0 })

  const baseTime = Date.now()
  const hostPackets = [
    { time: isoAt(baseTime, 1), lat: 52.5284, lon: 85.1275, weight: 100.0 },
    { time: isoAt(baseTime, 3), lat: 52.5292, lon: 85.1284, weight: 620.0 },
    { time: isoAt(baseTime, 5), lat: 52.5300, lon: 85.1293, weight: 720.0 },
    { time: isoAt(baseTime, 7), lat: 52.5300, lon: 85.1293, weight: 300.0 },
    { time: isoAt(baseTime, 9), lat: 52.5300, lon: 85.1293, weight: 40.0 }
  ]
  const rtkPackets = [
    { time: isoAt(baseTime, 0), lat: 52.5284, lon: 85.1275 },
    { time: isoAt(baseTime, 2), lat: 52.5292, lon: 85.1284 },
    { time: isoAt(baseTime, 4), lat: 52.5300, lon: 85.1293 },
    { time: isoAt(baseTime, 6), lat: 52.5300, lon: 85.1293 },
    { time: isoAt(baseTime, 8), lat: 52.5300, lon: 85.1293 }
  ]

  for (let index = 0; index < hostPackets.length; index += 1) {
    const rtkPacket = rtkPackets[index]
    if (rtkPacket) {
      await request('POST', '/api/telemetry/rtk', {
        json: {
          deviceId: 'rtk_loader_01',
          timestamp: rtkPacket.time,
          lat: rtkPacket.lat,
          lon: rtkPacket.lon,
          valid: true,
          quality: 4,
          quality_label: 'rtk_fixed',
          satellites: 18,
          raw_gga: '$GNGGA,E2E',
          events_reader_ok: true,
          wifi_connected: true,
          wifi_ssid: 'ISRK_Hozyain',
          wifi_profile: 'primary',
          rssi_dbm: -61,
          sd_ready: true,
          ram_queue_len: 0,
          free_heap_bytes: 214320
        }
      })
    }

    const hostPacket = hostPackets[index]
    await request('POST', '/api/telemetry/host', {
      json: {
        deviceId: 'host_01',
        timestamp: hostPacket.time,
        lat: hostPacket.lat,
        lon: hostPacket.lon,
        gpsValid: true,
        gpsSatellites: 12,
        weight: hostPacket.weight,
        weightValid: true,
        gpsQuality: 4,
        wifiClients: [],
        cpuTempC: 56.2,
        lteRssiDbm: -72,
        lteAccessTech: 'LTE',
        eventsReaderOk: true
      }
    })
  }
  pushLog('telemetry_flow', { status: 'ok', hostPackets: hostPackets.length, rtkPackets: rtkPackets.length })

  const hostCurrent = await request('GET', '/api/telemetry/host/current', {
    token: adminToken
  })
  const rtkCurrent = await request('GET', '/api/telemetry/rtk/current', {
    token: adminToken
  })
  pushLog('telemetry_current', {
    status: 'ok',
    hostMode: hostCurrent.mode,
    rtkQuality: rtkCurrent.qualityLabel || rtkCurrent.rtkQuality || null
  })

  const batches = await request('GET', '/api/batches', {
    token: adminToken
  })
  const latestBatch = Array.isArray(batches) && batches.length > 0 ? batches[0] : null
  if (!latestBatch?.id) {
    throw new Error('После телеметрии не найден ни один замес')
  }
  pushLog('batches_list', { status: 'ok', count: batches.length, latestBatchId: latestBatch.id })

  const batchDetails = await request('GET', `/api/batches/${latestBatch.id}`, {
    token: adminToken
  })
  if (batchDetails.groupId !== mainGroup.id || batchDetails.rationId !== ration.id) {
    throw new Error(`Автопривязка batch не сработала: groupId=${batchDetails.groupId}, rationId=${batchDetails.rationId}`)
  }
  pushLog('batch_details', {
    status: 'ok',
    ingredients: batchDetails.ingredients?.length || 0,
    unloadingBarn: batchDetails.unloadingInfo?.barnName || null
  })
  pushLog('batch_auto_binding', {
    status: 'ok',
    batchId: latestBatch.id,
    groupId: batchDetails.groupId,
    rationId: batchDetails.rationId
  })

  const reports = await request('GET', '/api/reports', {
    token: adminToken
  })
  pushLog('reports', {
    status: 'ok',
    batches: reports.batches?.length || 0,
    violations: reports.violations?.length || 0
  })

  const violations = await request('GET', '/api/violations', {
    token: adminToken
  })
  pushLog('violations', {
    status: 'ok',
    count: Array.isArray(violations) ? violations.length : 0
  })

  const warnings = await request('GET', '/api/telemetry/warnings/current', {
    token: adminToken
  })
  pushLog('warnings', {
    status: 'ok',
    count: warnings.items?.length || 0
  })

  const groups = await request('GET', '/api/groups', {
    token: adminToken
  })
  const zones = await request('GET', '/api/telemetry/zones?includeInactive=true', {
    token: adminToken
  })
  const users = await request('GET', '/api/users', {
    token: adminToken
  })
  pushLog('reference_lists', {
    status: 'ok',
    groups: Array.isArray(groups) ? groups.length : 0,
    zones: Array.isArray(zones) ? zones.length : 0,
    users: Array.isArray(users) ? users.length : 0
  })

  await request('DELETE', `/api/users/${createdUser.id}`, {
    token: adminToken
  })
  pushLog('user_delete', { status: 'ok', id: createdUser.id })

  const result = {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    created: {
      runTag,
      userId: createdUser.id,
      userName,
      rationId: ration.id,
      groupId: mainGroup.id,
      circleZoneId: circleZone.id,
      squareZoneId: squareZone.id,
      unloadZoneId: unloadZone.id,
      latestBatchId: latestBatch.id
    },
    credentials: {
      admin: { username: 'admin', password: 'KorovkiTOP' },
      director: { username: 'dir', password: 'SrostkiFARM' },
      guest: { username: 'guest', password: 'pass123' }
    },
    reportSnapshot: {
      batches: reports.batches?.length || 0,
      violations: reports.violations?.length || 0,
      violationItems: Array.isArray(violations) ? violations.length : 0,
      warnings: warnings.items?.length || 0
    },
    steps: scenarioLog
  }

  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error('[E2E] Scenario failed:', error)
  process.exitCode = 1
})
