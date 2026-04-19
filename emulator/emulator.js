#!/usr/bin/env node
/**
 * CLI Эмулятор тракториста v2.1 (FIXED)
 * Исправления: физика движения, логика воровства, стабильность таймеров
 * Запуск: node emulator.js --mode=auto --host=http://localhost:3000 --tractor-id=TR-01
 */

// ================= НАСТРОЙКИ =================
const CONFIG = {
  tractorId: process.env.TRACTOR_ID || 'EMULATOR-01',
  speedKmh: 15,
  tickMs: 1000,
  loadRate: 30,      // кг/сек
  unloadRate: 40,    // кг/сек
  noise: {
    gpsDriftMeters: [2, 5],
    bumpKg: 50,
    signalLossChance: 0.01,
    signalLossDurationSec: [10, 25]
  },
  chaos: {
    scenarios: ['normal', 'theft', 'overload', 'rush', 'equipment_fail', 'long_break'],
    weights: [40, 15, 15, 10, 10, 10]
  }
};

// ================= СОСТОЯНИЕ =================
const STATE = {
  zones: [],
  currentPos: { lat: 0, lon: 0, gpsValid: true },
  currentWeight: 0,
  state: 'FETCH_ZONES',
  targetPos: null,
  // FIX: Добавили идеальную позицию для расчета движения (до применения шума)
  idealPos: { lat: 0, lon: 0 }, 
  stepsTotal: 0,
  stepsDone: 0,
  signalLossEnd: 0,
  chaosActive: null,
  chaosTimers: {},
  cycleCount: 0,
  targetLoadZone: null,
  targetUnloadZone: null,
  moveVector: { dLat: 0, dLon: 0 } // FIX: Вектор движения
};

// ================= УТИЛИТЫ =================
const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rand = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max + 1));

const pickWeighted = (arr, weights) => {
  const sum = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * sum;
  for (let i = 0; i < arr.length; i++) {
    r -= weights[i];
    if (r <= 0) return arr[i];
  }
  return arr[0];
};

const calcDistance = (p1, p2) => {
  const R = 6371000;
  const dLat = (p2.lat - p1.lat) * Math.PI / 180;
  const dLon = (p2.lon - p1.lon) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(p1.lat*Math.PI/180)*Math.cos(p2.lat*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
};

// ================= API =================
async function fetchZones(baseUrl) {
  const url = `${baseUrl}/api/telemetry/zones`;
  log(`🌐 Загрузка зон: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET /zones -> ${res.status}`);
  const data = await res.json();
  const zones = Array.isArray(data) ? data.filter(z => z.active !== false) : [];
  log(`✅ Активных зон: ${zones.length}`);
  return zones;
}

async function sendTelemetry(baseUrl, payload) {
  const url = `${baseUrl}/api/telemetry/host`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) log(`⚠️ POST /host -> ${res.status}`);
  } catch (e) {
    log(`❌ Ошибка сети: ${e.message}`);
  }
}

// ================= ФИЗИКА И ШУМ =================
function applyPhysicsAndNoise() {
  const now = Date.now() / 1000;
  
  // 1. Потеря связи
  if (STATE.signalLossEnd > now) {
    STATE.currentPos.gpsValid = false;
  } else if (Math.random() < CONFIG.noise.signalLossChance) {
    STATE.signalLossEnd = now + randInt(...CONFIG.noise.signalLossDurationSec);
    log(`📡 Связь потеряна на ${Math.round(STATE.signalLossEnd - now)} сек`);
  }

  // 2. Если связь есть - берем идеальные координаты и накладываем шум
  if (STATE.currentPos.gpsValid) {
    // Копируем идеальную позицию
    STATE.currentPos.lat = STATE.idealPos.lat;
    STATE.currentPos.lon = STATE.idealPos.lon;

    // Накладываем дрифт
    const driftM = rand(...CONFIG.noise.gpsDriftMeters);
    const dLat = driftM / 111111;
    const dLon = driftM / (111111 * Math.cos(STATE.idealPos.lat * Math.PI / 180));
    STATE.currentPos.lat += rand(-dLat, dLat);
    STATE.currentPos.lon += rand(-dLon, dLon);
  }

  // 3. Кочки (шум веса)
  if ((STATE.state === 'MOVING' || STATE.state === 'MOVING_BACK') && STATE.stepsDone < STATE.stepsTotal) {
    STATE.currentWeight += rand(-CONFIG.noise.bumpKg, CONFIG.noise.bumpKg);
  }
  if (STATE.currentWeight < 0) STATE.currentWeight = 0;
}

function pickScenario() {
  STATE.chaosActive = pickWeighted(CONFIG.chaos.scenarios, CONFIG.chaos.weights);
  STATE.chaosTimers = { equipmentFailTick: 0, theftDropDone: false, rushTriggered: false };
  log(`🎲 Сценарий: ${STATE.chaosActive.toUpperCase()}`);
}

// Проверка: находится ли точка ВНЕ всех активных геозон
function isOutsideAllZones(pos, zones) {
  return zones.every(z => calcDistance(pos, z) > (z.radius || 15));
}

function applyChaosLogic() {
  const sc = STATE.chaosActive;
  if (sc === 'normal') return;

  // Перевес
  if (sc === 'overload' && STATE.state === 'LOADING') {
    if (STATE.currentWeight < 2500) return;
    STATE.state = 'MOVING_BACK'; // Сразу едем выгружать
    STATE.stepsDone = 0;
    return;
  }

  // Воровство (слив в серой зоне)
  // FIX: Проверяем, что мы ВНЕ зон, а не просто далеко от цели
  if (sc === 'theft' && STATE.state === 'MOVING' && !STATE.chaosTimers.theftDropDone) {
    if (isOutsideAllZones(STATE.idealPos, STATE.zones)) {
      // Шанс начать слив, если мы уже проехали немного от старта
      if (STATE.stepsDone > 10 && Math.random() < 0.05) { 
        STATE.state = 'THEFT_DROP';
        STATE.chaosTimers.theftDropStart = STATE.currentWeight;
        log(`🕳️ Воровство: слив в серой зоне`);
      }
    }
  }
  if (STATE.state === 'THEFT_DROP') {
    STATE.currentWeight -= 15;
    if (STATE.currentWeight <= STATE.chaosTimers.theftDropStart - 500) {
      STATE.chaosTimers.theftDropDone = true;
      STATE.state = 'MOVING'; // Возвращаемся в маршрут
      log(`✅ Слив завершен`);
    }
    return;
  }

  // Спешка (недовыгруз)
  if (sc === 'rush' && STATE.state === 'UNLOADING' && !STATE.chaosTimers.rushTriggered) {
    if (STATE.currentWeight <= 400) {
      log(`⚡ Спешка: обрыв на ${STATE.currentWeight.toFixed(1)} кг`);
      STATE.chaosTimers.rushTriggered = true;
      STATE.state = 'BREAK';
    }
    return;
  }

  // Отвал оборудования
  if (sc === 'equipment_fail') {
    STATE.chaosTimers.equipmentFailTick++;
    // FIX: Используем четкие пороги и сброс
    if (STATE.chaosTimers.equipmentFailTick === 10) {
      STATE.currentWeight = rand() > 0.5 ? 99999 : -150;
      log(`💥 Сбой датчика веса: ${STATE.currentWeight}`);
    }
    if (STATE.chaosTimers.equipmentFailTick === 25) {
      STATE.currentPos.lat = 0; STATE.currentPos.lon = 0; STATE.currentPos.gpsValid = false;
      log(`🌍 Сбой GPS: 0,0`);
      STATE.chaosTimers.equipmentFailTick = 0; // FIX: Сброс в 0, а не -3
    }
  }
}

// ================= PAYLOAD =================
function buildPayload() {
  const p = STATE.currentPos;
  // FIX: Валидация должна учитывать, что при сбое мы принудительно ставим 0,0
  const isHardwareZero = (p.lat === 0 && p.lon === 0 && !p.gpsValid);
  const isValid = !isHardwareZero && p.gpsValid;
  
  return {
    deviceId: CONFIG.tractorId,
    timestamp: new Date().toISOString(),
    lat: parseFloat(p.lat.toFixed(7)),
    lon: parseFloat(p.lon.toFixed(7)),
    gpsValid: isValid,
    gpsSatellites: isValid ? randInt(6, 12) : 0,
    weight: parseFloat(STATE.currentWeight.toFixed(2)),
    weightValid: isValid && STATE.currentWeight >= 0 && STATE.currentWeight < 5000,
    gpsQuality: isValid ? randInt(3, 5) : 0,
    wifiClients: randInt(0, 3).toString(),
    cpuTempC: parseFloat(rand(42.5, 88.2).toFixed(1)),
    lteRssiDbm: randInt(-115, -55),
    lteAccessTech: ['LTE', '4G', 'LTE-A'][randInt(0, 2)],
    eventsReaderOk: Math.random() > 0.05,
    scenario: STATE.chaosActive
  };
}

// ================= ГЛАВНЫЙ ЦИКЛ =================
async function runLoop(hostUrl) {
  STATE.cycleCount = 0;
  
  while (true) {
    // 1. Разведка
    if (STATE.state === 'FETCH_ZONES') {
      try {
        STATE.zones = await fetchZones(hostUrl);
        if (STATE.zones.length === 0) throw new Error('Нет активных зон');
        STATE.idealPos.lat = STATE.zones[0].lat;
        STATE.idealPos.lon = STATE.zones[0].lon;
        STATE.currentPos = { ...STATE.idealPos, gpsValid: true };
        STATE.state = 'IDLE';
      } catch (e) {
        log(`❌ ${e.message}. Повтор через 10с...`);
        await sleep(10000);
        continue;
      }
    }

    // 2. Планирование
    if (STATE.state === 'IDLE') {
      pickScenario();
      STATE.cycleCount++;
      log(`🚜 Цикл #${STATE.cycleCount}`);

      const loadZones = STATE.zones.filter(z => z.ingredient && z.radius > 0);
      // Улучшенный поиск коровника
      const unloadZone = STATE.zones.find(z => 
        /коровник|сенаж|трава|корм|barn|feed/i.test(z.name + ' ' + z.ingredient)
      );
      
      STATE.targetLoadZone = loadZones[randInt(0, Math.max(0, loadZones.length - 1))] || loadZones[0];
      STATE.targetUnloadZone = unloadZone || STATE.zones[1] || STATE.zones[0];
      
      STATE.state = 'MOVING';
      STATE.stepsDone = 0;
    }

    // 3. Логика движения (FIXED)
    let target = null;
    const isMovingForward = STATE.state === 'MOVING';
    const isMovingBack = STATE.state === 'MOVING_BACK';

    if (isMovingForward || isMovingBack) {
      target = isMovingForward ? STATE.targetLoadZone : STATE.targetUnloadZone;
      
      // FIX: Инициализация движения происходит только 1 раз при входе в состояние (stepsDone === 0)
      if (STATE.stepsDone === 0) {
        const dist = calcDistance(STATE.idealPos, target);
        const stepM = (CONFIG.speedKmh * 1000) / 3600; 
        STATE.stepsTotal = Math.max(1, Math.ceil(dist / stepM));
        
        // Предвычисляем вектор шага
        STATE.moveVector.dLat = (target.lat - STATE.idealPos.lat) / STATE.stepsTotal;
        STATE.moveVector.dLon = (target.lon - STATE.idealPos.lon) / STATE.stepsTotal;
      }
      
      const dist = calcDistance(STATE.idealPos, target);
      
      // Проверка прибытия
      if (dist < (target.radius || 15)) {
        if (isMovingForward) STATE.state = 'LOADING';
        else STATE.state = 'UNLOADING';
      } else {
        // Движение по вектору
        STATE.idealPos.lat += STATE.moveVector.dLat;
        STATE.idealPos.lon += STATE.moveVector.dLon;
        STATE.stepsDone++;
      }
    }

    // Загрузка
    if (STATE.state === 'LOADING') {
      const maxLoad = STATE.chaosActive === 'overload' ? 2500 : 1200;
      if (STATE.currentWeight < maxLoad) {
        STATE.currentWeight += CONFIG.loadRate;
      } else {
        STATE.state = 'MOVING_BACK';
        STATE.stepsDone = 0;
        log(`📦 Загружено ${STATE.currentWeight} кг. Едем в ${STATE.targetUnloadZone.name}`);
      }
    }

    // Разгрузка
    if (STATE.state === 'UNLOADING') {
      if (STATE.currentWeight > 0) {
        STATE.currentWeight = Math.max(0, STATE.currentWeight - CONFIG.unloadRate);
      } else {
        STATE.state = 'BREAK';
      }
    }

    // Простой
    if (STATE.state === 'BREAK') {
      const isLong = STATE.chaosActive === 'long_break';
      const pauseMin = isLong ? 90 : 5;
      log(`💤 Простой ${pauseMin} мин...`);
      await sleep(pauseMin * 60 * 1000);
      STATE.state = 'IDLE';
      continue;
    }

    // 4. Физика -> Хаос -> Отправка
    applyPhysicsAndNoise();
    applyChaosLogic();
    const payload = buildPayload();
    await sendTelemetry(hostUrl, payload);

    await sleep(CONFIG.tickMs);
  }
}

// ================= CLI =================
const args = {};
process.argv.slice(2).forEach(arg => {
  const [k, v] = arg.split('=');
  if (k) args[k.replace('--', '')] = v;
});

if (args.mode !== 'auto') {
  console.log('Usage: node emulator.js --mode=auto --host=<URL> [--tractor-id=ID]');
  process.exit(1);
}

const host = (args.host || 'http://localhost:3000').replace(/\/+$/, '');
log(`🚀 Start. Host: ${host}`);
runLoop(host).catch(err => {
  log(`💀 Fatal: ${err.stack}`);
  process.exit(1);
});