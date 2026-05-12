import fs from 'fs'
import path from 'path'
import { performance } from 'perf_hooks'
import { setTimeout as sleep } from 'timers/promises'

const BASE_URL = (process.env.CAP_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '')
const USERNAME = process.env.CAP_USERNAME || 'admin'
const PASSWORD = process.env.CAP_PASSWORD || 'KorovkiTOP'
const STEPS = parseIntList(process.env.CAP_STEPS || '10,25,50,75,100')
const STEP_DURATION_SEC = parseIntOrDefault(process.env.CAP_STEP_DURATION_SEC, 60)
const REQUEST_TIMEOUT_MS = parseIntOrDefault(process.env.CAP_REQUEST_TIMEOUT_MS, 8000)
const THINK_MIN_MS = parseIntOrDefault(process.env.CAP_THINK_MIN_MS, 50)
const THINK_MAX_MS = parseIntOrDefault(process.env.CAP_THINK_MAX_MS, 180)
const P95_LIMIT_MS = parseFloatOrDefault(process.env.CAP_P95_LIMIT_MS, 1200)
const ERROR_RATE_LIMIT = parseFloatOrDefault(process.env.CAP_ERROR_RATE_LIMIT, 0.02)
const OUTPUT_DIR = process.env.CAP_OUTPUT_DIR || path.resolve(process.cwd(), 'scripts', 'reports')

function parseIntOrDefault(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseFloatOrDefault(value, fallback) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseIntList(value) {
  return String(value)
    .split(',')
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isFinite(item) && item > 0)
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return 0
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.floor((sortedValues.length - 1) * p))
  )
  return sortedValues[index]
}

function randomInt(min, max) {
  if (max <= min) return min
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function weightedPicker(items) {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0)
  return () => {
    let roll = Math.random() * totalWeight
    for (const item of items) {
      roll -= item.weight
      if (roll <= 0) return item
    }
    return items[items.length - 1]
  }
}

async function readBodySafe(response) {
  const type = response.headers.get('content-type') || ''
  try {
    if (type.includes('application/json')) return await response.json()
    return await response.text()
  } catch {
    return null
  }
}

async function request({
  method = 'GET',
  path: endpointPath,
  token,
  timeoutMs = REQUEST_TIMEOUT_MS,
  body
}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const headers = {}
    if (token) headers.Authorization = `Bearer ${token}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'

    const response = await fetch(`${BASE_URL}${endpointPath}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal
    })

    const payload = await readBodySafe(response)
    return { ok: response.ok, status: response.status, payload }
  } finally {
    clearTimeout(timer)
  }
}

async function login() {
  const response = await request({
    method: 'POST',
    path: '/api/auth/login',
    body: { username: USERNAME, password: PASSWORD }
  })

  if (!response.ok || !response.payload?.token) {
    throw new Error(`Login failed: ${response.status} ${JSON.stringify(response.payload)}`)
  }

  return response.payload.token
}

async function resolveDeviceId(token) {
  const response = await request({
    method: 'GET',
    path: '/api/telemetry/host/admin/latest?limit=1',
    token
  })

  if (!response.ok) return null
  const first = Array.isArray(response.payload) ? response.payload[0] : null
  return first?.deviceId || null
}

function buildScenario(deviceId) {
  const hostCurrentPath = deviceId
    ? `/api/telemetry/host/current?deviceId=${encodeURIComponent(deviceId)}`
    : '/api/telemetry/host/current'

  return [
    { name: 'health', method: 'GET', path: '/api/health', auth: false, weight: 10 },
    { name: 'host_current', method: 'GET', path: hostCurrentPath, auth: true, weight: 25 },
    { name: 'rtk_current', method: 'GET', path: '/api/telemetry/rtk/current', auth: true, weight: 20 },
    { name: 'batches', method: 'GET', path: '/api/batches?page=1&limit=20', auth: true, weight: 20 },
    { name: 'groups', method: 'GET', path: '/api/groups', auth: true, weight: 10 },
    { name: 'violations', method: 'GET', path: '/api/violations', auth: true, weight: 10 },
    { name: 'reports', method: 'GET', path: '/api/reports', auth: true, weight: 5 }
  ]
}

async function runStep({ users, durationSec, token, scenario }) {
  const pickEndpoint = weightedPicker(scenario)
  const latencies = []
  const statuses = new Map()
  const endpointStats = new Map()

  let total = 0
  let errors = 0
  const startedAt = Date.now()
  const until = startedAt + durationSec * 1000

  function countStatus(statusKey) {
    statuses.set(statusKey, (statuses.get(statusKey) || 0) + 1)
  }

  function countEndpoint(name, ok) {
    const current = endpointStats.get(name) || { total: 0, errors: 0 }
    current.total += 1
    if (!ok) current.errors += 1
    endpointStats.set(name, current)
  }

  async function workerLoop() {
    while (Date.now() < until) {
      const endpoint = pickEndpoint()
      const started = performance.now()
      try {
        const response = await request({
          method: endpoint.method,
          path: endpoint.path,
          token: endpoint.auth ? token : undefined
        })
        const latency = performance.now() - started
        latencies.push(latency)
        total += 1
        countStatus(String(response.status))
        countEndpoint(endpoint.name, response.ok)
        if (!response.ok) errors += 1
      } catch (error) {
        const latency = performance.now() - started
        latencies.push(latency)
        total += 1
        errors += 1
        countStatus(error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR')
        countEndpoint(endpoint.name, false)
      }

      await sleep(randomInt(THINK_MIN_MS, THINK_MAX_MS))
    }
  }

  await Promise.all(Array.from({ length: users }, () => workerLoop()))

  const actualDurationSec = Math.max(1, (Date.now() - startedAt) / 1000)
  const sorted = latencies.slice().sort((a, b) => a - b)

  const result = {
    users,
    requestedDurationSec: durationSec,
    actualDurationSec: Number(actualDurationSec.toFixed(2)),
    totalRequests: total,
    errors,
    errorRate: total ? errors / total : 1,
    rps: total / actualDurationSec,
    latencyMs: {
      min: sorted.length ? sorted[0] : 0,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
      max: sorted.length ? sorted[sorted.length - 1] : 0
    },
    statuses: Object.fromEntries(statuses.entries()),
    endpoints: Object.fromEntries(endpointStats.entries())
  }

  result.passed = result.errorRate <= ERROR_RATE_LIMIT && result.latencyMs.p95 <= P95_LIMIT_MS
  return result
}

function formatPercent(value) {
  return `${(value * 100).toFixed(2)}%`
}

function printStepResult(result) {
  const passLabel = result.passed ? 'PASS' : 'FAIL'
  console.log(
    `[${passLabel}] users=${result.users} rps=${result.rps.toFixed(1)} p95=${result.latencyMs.p95.toFixed(0)}ms ` +
      `errors=${result.errors}/${result.totalRequests} (${formatPercent(result.errorRate)})`
  )
}

async function main() {
  if (!STEPS.length) {
    throw new Error('No valid CAP_STEPS provided')
  }

  console.log(`[CapacityTest] Base URL: ${BASE_URL}`)
  console.log(`[CapacityTest] Steps: ${STEPS.join(', ')}`)
  console.log(
    `[CapacityTest] Thresholds: p95<=${P95_LIMIT_MS}ms, errorRate<=${formatPercent(ERROR_RATE_LIMIT)}`
  )

  const token = await login()
  const deviceId = await resolveDeviceId(token)
  const scenario = buildScenario(deviceId)

  console.log(`[CapacityTest] Login OK. Host device: ${deviceId || 'not detected (generic endpoints)'}`)

  const startedAtIso = new Date().toISOString()
  const results = []

  for (const users of STEPS) {
    console.log(`\n[CapacityTest] Running step: ${users} concurrent users for ${STEP_DURATION_SEC}s`)
    const stepResult = await runStep({
      users,
      durationSec: STEP_DURATION_SEC,
      token,
      scenario
    })
    results.push(stepResult)
    printStepResult(stepResult)
  }

  const lastPassing = results.filter((item) => item.passed).pop()
  const recommendation = {
    maxStableConcurrentUsers: lastPassing ? lastPassing.users : 0,
    basedOn: {
      p95LimitMs: P95_LIMIT_MS,
      errorRateLimit: ERROR_RATE_LIMIT,
      stepDurationSec: STEP_DURATION_SEC
    }
  }

  const finishedAtIso = new Date().toISOString()
  const report = {
    startedAt: startedAtIso,
    finishedAt: finishedAtIso,
    config: {
      baseUrl: BASE_URL,
      steps: STEPS,
      stepDurationSec: STEP_DURATION_SEC,
      timeoutMs: REQUEST_TIMEOUT_MS,
      thinkMinMs: THINK_MIN_MS,
      thinkMaxMs: THINK_MAX_MS,
      thresholds: {
        p95LimitMs: P95_LIMIT_MS,
        errorRateLimit: ERROR_RATE_LIMIT
      },
      scenario
    },
    recommendation,
    steps: results
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  const safeTimestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const reportPath = path.join(OUTPUT_DIR, `capacity-${safeTimestamp}.json`)
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')

  console.log('\n[CapacityTest] Summary:')
  for (const step of results) {
    printStepResult(step)
  }
  console.log(
    `[CapacityTest] Recommended stable limit: ${recommendation.maxStableConcurrentUsers} concurrent users`
  )
  console.log(`[CapacityTest] Report saved: ${reportPath}`)
}

main().catch((error) => {
  console.error('[CapacityTest] Failed:', error)
  process.exitCode = 1
})
