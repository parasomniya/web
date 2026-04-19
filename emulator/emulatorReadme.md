# 📋 Эмулятор: Справочник по функциям

> Файл: `emulator.js` | Версия: 2.1 | Node.js 18+

Документ описывает архитектуру скрипта последовательно: от конфигурации до точки входа. Каждая функция — с назначением, входными/выходными данными и ключевой логикой.

---

## 🔧 1. Конфигурация (`CONFIG`)

```js
const CONFIG = { ... }
```

**Назначение:** Централизованное хранение всех настраиваемых параметров эмулятора.

| Группа | Параметры | Описание |
|--------|-----------|----------|
| `tractorId` | `String` | Идентификатор устройства в телеметрии |
| `speedKmh` | `Number` | Скорость перемещения (км/ч) |
| `tickMs` | `Number` | Интервал отправки данных (мс) |
| `loadRate` / `unloadRate` | `Number` | Скорость изменения веса (кг/сек) |
| `noise` | `Object` | Параметры шума: `gpsDriftMeters`, `bumpKg`, `signalLossChance`, `signalLossDurationSec` |
| `chaos` | `Object` | Сценарии и их вероятности: `scenarios[]`, `weights[]` |

---

## 🧠 2. Глобальное состояние (`STATE`)

```js
const STATE = { ... }
```

**Назначение:** Хранение изменяемого контекста работы эмулятора между тиками цикла.

| Поле | Тип | Описание |
|------|-----|----------|
| `zones` | `Array` | Массив активных зон с сервера |
| `currentPos` | `Object` | Текущие координаты с флагом `gpsValid` |
| `idealPos` | `Object` | "Идеальные" координаты без шума (для расчёта движения) |
| `currentWeight` | `Number` | Текущий вес в кузове (кг) |
| `state` | `String` | Текущее состояние автомата: `FETCH_ZONES`, `IDLE`, `MOVING`, `LOADING`, `UNLOADING`, `BREAK`, `THEFT_DROP` |
| `stepsTotal` / `stepsDone` | `Number` | Счётчики шагов движения |
| `moveVector` | `Object` | Предвычисленный вектор смещения на шаг (`dLat`, `dLon`) |
| `signalLossEnd` | `Number` | Timestamp окончания потери связи |
| `chaosActive` | `String` | Активный сценарий хаоса |
| `chaosTimers` | `Object` | Внутренние счётчики для сценариев |
| `targetLoadZone` / `targetUnloadZone` | `Object` | Целевые зоны для текущего цикла |

---

## ⚙️ 3. Утилиты

### `log(msg: String)`
Выводит сообщение в консоль с префиксом-временем в формате ISO.

### `sleep(ms: Number): Promise`
Возвращает Promise, который резолвится через `ms` миллисекунд. Используется для неблокирующих задержек.

### `rand(min: Number, max: Number): Number`
Возвращает случайное вещественное число в диапазоне `[min, max)`.

### `randInt(min: Number, max: Number): Number`
Возвращает случайное целое число в диапазоне `[min, max]`.

### `pickWeighted(arr: Array, weights: Array): Any`
Возвращает элемент из `arr` с учётом весов из `weights`. Используется для выбора сценария хаоса.

### `calcDistance(p1: Object, p2: Object): Number`
Вычисляет расстояние в метрах между двумя точками (формула гаверсинусов).  
**Вход:** `{ lat: Number, lon: Number }`  
**Выход:** `Number` (метры)

---

## 🌐 4. Работа с API

### `fetchZones(baseUrl: String): Promise<Array>`
**Назначение:** Загружает активные зоны с бэкенда.

**Логика:**
1. Формирует URL: `${baseUrl}/api/telemetry/zones`
2. Выполняет `GET`-запрос
3. Фильтрует зоны: `active !== false`
4. Логирует результат и возвращает массив

**Ошибки:** При `!res.ok` выбрасывает исключение с кодом статуса.

---

### `sendTelemetry(baseUrl: String, payload: Object): Promise<void>`
**Назначение:** Отправляет точку телеметрии на сервер.

**Логика:**
1. Формирует URL: `${baseUrl}/api/telemetry/host`
2. Выполняет `POST` с `Content-Type: application/json`
3. При ошибке сети или `!res.ok` — логирует предупреждение, но **не прерывает выполнение**

**Гарантия:** Скрипт продолжает работу даже при недоступности бэкенда.

---

## 🌍 5. Физика и шум

### `applyPhysicsAndNoise(): void`
**Назначение:** Применяет реалистичные помехи к координатам и весу.

**Последовательность:**
1. **Потеря связи:** С вероятностью `signalLossChance` устанавливает `gpsValid: false` на случайный интервал. В этот период координаты принудительно `0,0`.
2. **GPS-дрифт:** Если связь активна, к `idealPos` добавляется случайное смещение 2–5 метров (с учётом косинуса широты).
3. **Кочки:** В состояниях `MOVING` / `MOVING_BACK` к весу добавляется шум `±bumpKg`.
4. **Защита от отрицательного веса:** `currentWeight = max(0, currentWeight)`.

**Результат:** `STATE.currentPos` и `STATE.currentWeight` содержат "зашумлённые" значения для отправки.

---

## 🎲 6. Генератор хаоса

### `pickScenario(): void`
**Назначение:** Выбирает сценарий поведения на новый цикл.

**Логика:**
1. Вызывает `pickWeighted(CONFIG.chaos.scenarios, CONFIG.chaos.weights)`
2. Сбрасывает `chaosTimers` в начальное состояние
3. Логирует выбранный сценарий

---

### `isOutsideAllZones(pos: Object, zones: Array): Boolean`
**Назначение:** Проверяет, находится ли точка вне радиусов всех активных зон.

**Использование:** Критично для сценария `theft` — слив корма возможен только в "серой зоне".

---

### `applyChaosLogic(): void`
**Назначение:** Модифицирует состояние в зависимости от активного сценария.

| Сценарий | Условие активации | Действие |
|----------|-------------------|----------|
| `overload` | `LOADING` | Увеличивает лимит загрузки до 2500 кг, затем переключает на `MOVING_BACK` |
| `theft` | `MOVING` + вне зон | Переключает в `THEFT_DROP`, плавно снижает вес на 500 кг, затем возвращает в маршрут |
| `rush` | `UNLOADING` + вес ≤ 400 кг | Принудительно переключает в `BREAK` (недовыгруз) |
| `equipment_fail` | Любой | С вероятностью генерирует экстремальный вес (`99999` / `-150`) или координаты `0,0` |
| `normal` | — | Нет действий |

**Важно:** Функция не возвращает значение, а напрямую модифицирует `STATE`.

---

## 📦 7. Сборка payload

### `buildPayload(): Object`
**Назначение:** Формирует объект телеметрии, соответствующий Prisma-модели `Telemetry`.

**Логика валидации:**
```js
const isHardwareZero = (lat === 0 && lon === 0 && !gpsValid);
const isValid = !isHardwareZero && gpsValid;
```

**Возвращаемый объект:**
```js
{
  deviceId: String,        // из CONFIG
  timestamp: ISOString,    // new Date().toISOString()
  lat/lon: Float(7),       // из currentPos
  gpsValid: Boolean,       // с учётом валидации
  gpsSatellites: 0|6-12,   // 0 при !isValid
  weight: Float(2),        // из currentWeight
  weightValid: Boolean,    // isValid + диапазон 0-5000
  gpsQuality: 0|3-5,       // 0 при !isValid
  wifiClients: "0"-"3",    // случайное
  cpuTempC: 42.5-88.2,     // случайное
  lteRssiDbm: -115..-55,   // случайное
  lteAccessTech: "LTE"|"4G"|"LTE-A",
  eventsReaderOk: Boolean, // 95% true
  scenario: String         // текущий сценарий хаоса
}
```

---

## 🔄 8. Главный цикл

### `runLoop(hostUrl: String): Promise<void>`
**Назначение:** Бесконечный асинхронный цикл эмуляции.

**Структура цикла (один тик = 1 секунда):**

```
┌─────────────────────────────┐
│ 1. FETCH_ZONES              │
│    • GET /zones             │
│    • Инициализация позиции  │
└─────────┬───────────────────┘
          ▼
┌─────────────────────────────┐
│ 2. IDLE (планирование)      │
│    • pickScenario()         │
│    • Выбор target-зон       │
│    • Переход в MOVING       │
└─────────┬───────────────────┘
          ▼
┌─────────────────────────────┐
│ 3. Движение / Процессы      │
│    • MOVING → LOADING       │
│    • LOADING → MOVING_BACK  │
│    • MOVING_BACK → UNLOADING│
│    • UNLOADING → BREAK      │
│    • BREAK → IDLE           │
│    • Расчёт вектора движения│
│    • Проверка прибытия      │
└─────────┬───────────────────┘
          ▼
┌─────────────────────────────┐
│ 4. Обработка данных         │
│    • applyPhysicsAndNoise() │
│    • applyChaosLogic()      │
│    • buildPayload()         │
│    • sendTelemetry()        │
└─────────┬───────────────────┘
          ▼
┌─────────────────────────────┐
│ 5. await sleep(tickMs)      │
└─────────────────────────────┘
```

**Ключевые особенности:**
- Движение рассчитывается **один раз** при входе в состояние (через `moveVector`), что обеспечивает плавную траекторию.
- Все состояния, кроме `BREAK`, выполняются за 1 тик (1 сек).
- `BREAK` использует `await sleep()` на 5 или 90 минут, затем `continue` для немедленного возврата в начало цикла.
- Ошибки в `fetchZones` обрабатываются: лог + `sleep(10000)` + `continue`.

---

## 🚪 9. Точка входа (CLI)

```js
// Парсинг аргументов
const args = {};
process.argv.slice(2).forEach(arg => {
  const [k, v] = arg.split('=');
  if (k) args[k.replace('--', '')] = v;
});

// Валидация режима
if (args.mode !== 'auto') { /* вывод справки + exit(1) */ }

// Нормализация host (удаление конечных слэшей)
const host = (args.host || 'http://localhost:3000').replace(/\/+$/, '');

// Запуск
log(`🚀 Start. Host: ${host}`);
runLoop(host).catch(err => {
  log(`💀 Fatal: ${err.stack}`);
  process.exit(1);
});
```

**Поддерживаемые аргументы:**
| Аргумент | Обязательный | По умолчанию | Описание |
|----------|--------------|--------------|----------|
| `--mode=auto` | ✅ | — | Включает автономный режим |
| `--host=<URL>` | ❌ | `http://localhost:3000` | Базовый адрес API |
| `--tractor-id=<ID>` | ❌ | `EMULATOR-01` | Идентификатор в телеметрии |

---

## 🚀 Как запустить

### Базовый запуск
```bash
node emulator.js --mode=auto --host=http://localhost:3000 --tractor-id=TR-01
```

### Запуск в фоне (PM2)
```bash
# Установка (один раз)
npm install -g pm2

# Старт
pm2 start emulator.js --name "tractor-emu" -- \
  --mode=auto \
  --host=http://localhost:3000 \
  --tractor-id=TR-01

# Управление
pm2 logs tractor-emu      # Просмотр логов
pm2 restart tractor-emu   # Перезапуск
pm2 stop tractor-emu      # Остановка
pm2 delete tractor-emu    # Удаление из списка
pm2 save                  # Сохранение для автозапуска при перезагрузке
```

### Несколько эмуляторов одновременно
```bash
# Терминал 1
node emulator.js --mode=auto --host=http://localhost:3000 --tractor-id=TR-01

# Терминал 2
node emulator.js --mode=auto --host=http://localhost:3000 --tractor-id=TR-02

# Терминал 3
node emulator.js --mode=auto --host=http://localhost:3000 --tractor-id=TR-03
```

### Проверка работы
1. В консоли должны появляться логи:  
   `🚀 Start`, `🌐 Загрузка зон`, `🎲 Сценарий`, `🚜 Цикл #...`
2. На сервере в эндпоинте `/api/telemetry/host` должны появляться новые записи каждую секунду.
3. При активации сценариев хаоса в логах будут метки: `🕳️`, `💥`, `⚡`, `🌍`.
