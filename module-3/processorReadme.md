# 📄 Документация: TelemetryProcessor

> Главный автомат состояний для обработки телеметрии сельскохозяйственной техники

---

## 🎯 Назначение

Класс `TelemetryProcessor` — это «мозг» системы мониторинга кормораздатчиков. Он принимает поток телеметрических данных от устройств, отслеживает их состояние в реальном времени и генерирует команды для сервера:

- ✅ Фиксирует загрузки ингредиентов по зонам
- ✅ Детектирует начало и конец выгрузки корма
- ✅ Защищает от ошибок оператора («Вася с лопатой», недовыгрузка)
- ✅ Формирует баннеры для фронтенда при смене зон

---

## 📦 Импорт зависимостей

```javascript
import { detectZone } from '../module-1/geo.js';      // Определение геозоны по координатам
import { isValidLocation } from '../module-1/validator.js'; // Валидация GPS-координат
```

---

## 🗂️ Структура класса

### Конструктор

```javascript
constructor() {
  this.deviceStates = new Map(); // Хранилище состояний: { deviceId → state }
}
```

Каждое устройство (`deviceId`) имеет собственный объект состояния, который хранится в памяти между пакетами телеметрии.

---

## 🧠 Объект состояния (State)

```javascript
{
  lastZoneName: null,        // Зона из предыдущего пакета (только для баннеров)
  currentZone: null,         // Текущая зона, где происходит загрузка
  zoneStartWeight: 0,        // Вес в момент входа в зону (база для расчёта дельты)
  peakWeight: 0,             // Максимальный вес за весь цикл замеса
  isMixing: false,           // Флаг: идёт ли набор веса (загрузка)?
  isUnloading: false,        // Флаг: идёт ли выгрузка корма?
  lastUnloadWeight: null     // Вес при последнем тике выгрузки
}
```

---

## ⚙️ Метод `processPacket(packet, zonesConfig)`

### Входные данные

| Параметр | Тип | Описание |
|----------|-----|----------|
| `packet` | `Object` | Пакет телеметрии с полями: `deviceId`, `lat`, `lon`, `weight`, `timestamp` и др. |
| `zonesConfig` | `Array` | Массив активных геозон (передаётся в `detectZone`) |

### Выходные данные

```javascript
{
  isValid: boolean,     // true, если пакет прошёл базовую валидацию
  error: string|null,   // Сообщение об ошибке (если isValid === false)
  banner: Object|null,  // Объект для отображения уведомления на фронтенде
  dbActions: Array      // Массив команд для сохранения в БД
}
```

---

## 🔄 Алгоритм обработки (7 шагов)

### 🔹 Шаг 1: Базовая проверка координат

```javascript
if (!isValidLocation(packet.lat, packet.lon)) {
  return { isValid: false, error: 'Invalid GPS coordinates', ... };
}
```

- Отбрасывает «мусорные» данные от GPS-трекера
- Если координаты невалидны — обработка прекращается

---

### 🔹 Шаг 2: Инициализация состояния

```javascript
let state = this.deviceStates.get(packet.deviceId);
if (!state) {
  state = this.getInitialState();
  this.deviceStates.set(packet.deviceId, state);
}
```

- Если устройство отправляет данные впервые — создаётся новое состояние
- Если уже есть — загружается из памяти

---

### 🔹 Шаг 3: Определение зоны и генерация баннеров

```javascript
const activeZone = detectZone(packet.lat, packet.lon, zonesConfig);

if (activeZone !== state.lastZoneName) {
  result.banner = { type: 'zone_enter', message: `Въезд в зону ${activeZone}` };
  state.lastZoneName = activeZone;
}
```

- Вызывает внешнюю функцию `detectZone()` для определения текущей геозоны
- Если зона изменилась — формируется баннер для фронтенда
- `lastZoneName` обновляется для сравнения в следующем пакете

---

### 🔹 Шаг 4: Авто-Тара («Защита от Васи с лопатой»)

```javascript
if (!state.isMixing && !state.isUnloading) {
  if (currentWeight < state.zoneStartWeight) {
    state.zoneStartWeight = currentWeight; // Обновляем «ноль»
  }
}
```

**Сценарий:** Тракторист вручную вычистил остатки корма из кузова → вес упал.  
**Решение:** Система автоматически сдвигает базовый вес, чтобы не считать «отрицательную загрузку».

---

### 🔹 Шаг 5: Детекция загрузки при смене зоны

```javascript
if (state.currentZone !== activeZone) {
  if (state.currentZone) {
    const delta = currentWeight - state.zoneStartWeight;
    if (delta > 30) { // Порог: 30 кг
      state.isMixing = true;
      result.dbActions.push({
        type: 'ADD_INGREDIENT',
        ingredientName: state.currentZone,
        actualWeight: Math.round(delta)
      });
    }
  }
  // Обновляем якоря для следующей зоны
  state.currentZone = activeZone;
  state.zoneStartWeight = currentWeight;
}
```

**Логика:**
1. Если трактор переехал из одной зоны в другую
2. И в предыдущей зоне набрал >30 кг → фиксируем загрузку ингредиента
3. Сбрасываем точку отсчёта веса для новой зоны

> 📌 Порог **30 кг** отсекает ложные срабатывания от вибрации и кочек.

---

### 🔹 Шаг 6: Отслеживание пика веса

```javascript
if (currentWeight > state.peakWeight) {
  state.peakWeight = currentWeight;
}
```

- Запоминает максимальный вес за цикл
- Нужен для детекции начала выгрузки (когда вес начнёт падать)

---

### 🔹 Шаг 7: Защита от недовыгрузки

```javascript
if (state.isUnloading && currentWeight > state.lastUnloadWeight + 50) {
  result.dbActions.push({ type: 'FORCE_CLOSE_BATCH' });
  
  // Перерождаем состояние
  state.zoneStartWeight = state.lastUnloadWeight;
  state.isMixing = false;
  state.isUnloading = false;
  state.peakWeight = currentWeight;
  state.lastUnloadWeight = null;
}
```

**Сценарий:** Трактор не до конца выгрузил корм в коровнике и поехал грузиться снова.  
**Решение:** 
- Принудительно закрывает предыдущий замес (`FORCE_CLOSE_BATCH`)
- Сохраняет остаток как новую точку отсчёта
- Сбрасывает флаги для нового цикла

> 📌 Порог **+50 кг** — если вес вырос существенно, значит, началась новая загрузка.

---

### 🔹 Шаг 8: Детекция выгрузки

```javascript
if (state.isMixing && state.peakWeight > 400 && currentWeight < state.peakWeight - 200) {
  state.isUnloading = true;
  state.lastUnloadWeight = currentWeight;
  
  result.dbActions.push({
    type: 'UPDATE_UNLOAD',
    endWeight: Math.round(currentWeight)
  });
}
```

**Условия срабатывания:**
- ✅ Была загрузка (`isMixing === true`)
- ✅ Набрано >400 кг (значимый замес)
- ✅ Вес упал на ≥200 кг от пика

→ Система понимает: началась раздача корма.

---

### 🔹 Шаг 9: Завершение цикла

```javascript
if (state.isUnloading && currentWeight < 50) {
  result.dbActions.push({ type: 'COMPLETE_BATCH' });
  this.deviceStates.delete(packet.deviceId); // Очистка памяти
}
```

**Условие:** Вес упал ниже **50 кг** → кузов считается пустым.  
**Действия:**
- Фиксирует завершение замеса (`COMPLETE_BATCH`)
- Удаляет состояние устройства из памяти (экономия ресурсов)

---

## 📤 Словарь команд (`dbActions`)

| Тип команды | Описание | Параметры |
|-------------|----------|-----------|
| `ADD_INGREDIENT` | Зафиксировать загрузку ингредиента | `ingredientName`, `actualWeight` |
| `UPDATE_UNLOAD` | Обновить статус выгрузки | `endWeight` — текущий остаток |
| `COMPLETE_BATCH` | Завершить цикл замеса | — |
| `FORCE_CLOSE_BATCH` | Принудительно закрыть замес при недовыгрузке | — |

---

## 🧪 Вспомогательные методы

### `getInitialState()`

Возвращает шаблон нового состояния для устройства.

### `getDeviceState(deviceId)`

Возвращает текущее состояние устройства (для отладки/мониторинга).

### `clearStates()`

Полностью очищает память состояний (используется в тестах).

---

## ⚙️ Конфигурируемые пороги

| Параметр | Значение | Назначение |
|----------|----------|------------|
| `delta > 30` | 30 кг | Мин. набор веса для фиксации загрузки |
| `peakWeight > 400` | 400 кг | Мин. вес замеса для детекции выгрузки |
| `weight drop > 200` | 200 кг | Падение веса для старта выгрузки |
| `weight rise > 50` | 50 кг | Рост веса при выгрузке = новый цикл |
| `final weight < 50` | 50 кг | Порог «пустого кузова» |

> 💡 Все пороги «зашиты» в код — при необходимости их можно вынести в конфиг-объект.

---

## 🔄 Пример жизненного цикла

```
[Трактор] 
   │
   ▼
1. Въезд в зону "Силос" 
   → баннер: "Въезд в зону Силос"
   │
   ▼
2. Набор веса: 100 → 1150 кг (+1050)
   → dbActions: [{type: 'ADD_INGREDIENT', ingredientName: 'Силос', actualWeight: 1050}]
   │
   ▼
3. Переезд в зону "Сенаж"
   → баннер: "Въезд в зону Сенаж"
   │
   ▼
4. Набор веса: 1150 → 1550 кг (+400)
   → dbActions: [{type: 'ADD_INGREDIENT', ingredientName: 'Сенаж', actualWeight: 400}]
   │
   ▼
5. Выезд на поле, вес падает: 1550 → 350 кг
   → dbActions: [{type: 'UPDATE_UNLOAD', endWeight: 350}]
   │
   ▼
6. Вес < 50 кг
   → dbActions: [{type: 'COMPLETE_BATCH'}]
   → состояние удалено из памяти
```

---

## 🛡️ Обработка ошибок и краевых случаев

| Ситуация | Реакция системы |
|----------|----------------|
| Некорректные GPS | `isValid: false`, пакет игнорируется |
| Устройство впервые | Создаётся новое состояние |
| Вес упал в режиме ожидания | Авто-тара: обновляется `zoneStartWeight` |
| Загрузка <30 кг | Игнорируется (вибрация, погрешность) |
| Недовыгрузка + новая загрузка | `FORCE_CLOSE_BATCH`, сохранение остатка |
| Потеря связи с устройством | Состояние хранится до следующего пакета или ручной очистки |

---

## 📝 Примечания для разработчика

1. **Потокобезопасность**: Класс не использует асинхронность — вызовы `processPacket` должны быть последовательными для одного `deviceId`.
2. **Память**: Состояния удаляются автоматически при завершении цикла. Для долгоживущих сессий можно добавить таймаут очистки.
3. **Тестирование**: Используйте `clearStates()` между тестами для изоляции.
4. **Расширяемость**: Для добавления новых типов событий — расширяйте `dbActions` и соответствующие условия в шагах 4–9.

---
