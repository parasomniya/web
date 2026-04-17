import detectZone from '../module-1/geo.js';
import isValidLocation from '../module-1/validator.js';

/**
 * Главный автомат состояний для обработки телеметрии
 * Отслеживает загрузки, выгрузки и перемещения между зонами
 */
class TelemetryProcessor {
  constructor() {
    // Хранилище состояний по deviceId
    this.deviceStates = new Map();
  }

  /**
   * Возвращает начальное состояние для нового устройства
   */
  getInitialState() {
    return {
      lastZoneName: null,        // Зона из предыдущего пакета (для баннеров)
      currentZone: null,         // Текущая активная зона загрузки
      zoneStartWeight: 0,        // Вес в момент начала загрузки в зоне
      peakWeight: 0,             // Максимальный вес за цикл
      isMixing: false,           // Флаг: идет набор веса?
      isUnloading: false,        // Флаг: идет разгрузка?
      lastUnloadWeight: null     // Последний вес при разгрузке
    };
  }

  /**
   * Обрабатывает один пакет телеметрии
   * @param {Object} packet - Пакет телеметрии
   * @param {Array} zonesConfig - Массив активных зон
   * @returns {Object} Инструкция для контроллера
   */
  processPacket(packet, zonesConfig) {
    const result = {
      isValid: true,
      error: null,
      banner: null,
      dbActions: []
    };

    // ===== ШАГ 1: Базовая проверка координат =====
    if (!isValidLocation(packet.lat, packet.lon)) {
      result.isValid = false;
      result.error = 'Invalid GPS coordinates';
      return result;
    }

    // ===== Получаем или создаем состояние устройства =====
    let state = this.deviceStates.get(packet.deviceId);
    if (!state) {
      state = this.getInitialState();
      this.deviceStates.set(packet.deviceId, state);
    }

    const currentWeight = packet.weight;

    // ===== ШАГ 2: Определение зоны и баннеров =====
    const activeZone = detectZone(packet.lat, packet.lon, zonesConfig);
    
    // Если зона сменилась — генерируем баннер
    if (activeZone !== state.lastZoneName) {
      if (activeZone) {
        result.banner = {
          type: 'zone_enter',
          message: `Въезд в зону ${activeZone}`
        };
      }
      state.lastZoneName = activeZone;
    }

    // ===== ШАГ 3: Авто-Тара (Защита от "Васи с лопатой") =====
    // Если трактор пустой и вес упал ниже стартового — обновляем дно
    if (!state.isMixing && !state.isUnloading) {
      if (currentWeight < state.zoneStartWeight) {
        state.zoneStartWeight = currentWeight;
      }
    }

    // ===== ШАГ 4: Детекция загрузки (смена зоны) =====
    if (state.currentZone !== activeZone) {
      // Проверяем, был ли в какой-то зоне до этого
      if (state.currentZone) {
        const delta = currentWeight - state.zoneStartWeight;
        
        // Если набрал больше 30 кг — это загрузка
        if (delta > 30) {
          state.isMixing = true;
          
          result.dbActions.push({
            type: 'ADD_INGREDIENT',
            ingredientName: state.currentZone,
            actualWeight: Math.round(delta)
          });
        }
      }

      // В любом случае обновляем якоря
      state.currentZone = activeZone;
      state.zoneStartWeight = currentWeight;
    }

    // ===== ШАГ 5: Поиск пика веса =====
    if (currentWeight > state.peakWeight) {
      state.peakWeight = currentWeight;
    }

    // ===== ШАГ 6: Защита от недовыгрузки (новый цикл поверх старого) =====
    if (state.isUnloading && currentWeight > state.lastUnloadWeight + 50) {
      // Трактор не до конца выгрузился и поехал грузиться снова
      result.dbActions.push({
        type: 'FORCE_CLOSE_BATCH'
      });

      // Перерождаем состояние, сохраняя остаток
      state.zoneStartWeight = state.lastUnloadWeight;
      state.isMixing = false;
      state.isUnloading = false;
      state.peakWeight = currentWeight;
      state.lastUnloadWeight = null;
    }

    // ===== ШАГ 7: Детекция выгрузки и завершение =====
    // Если в замесе, пик > 400 кг, и вес упал сильно ниже пика
    if (state.isMixing && state.peakWeight > 400 && currentWeight < state.peakWeight - 200) {
      state.isUnloading = true;
      state.lastUnloadWeight = currentWeight;

      result.dbActions.push({
        type: 'UPDATE_UNLOAD',
        endWeight: Math.round(currentWeight)
      });
    }

    // Окончание: если кузов пуст (< 50 кг)
    if (state.isUnloading && currentWeight < 50) {
      result.dbActions.push({
        type: 'COMPLETE_BATCH'
      });

      // Полностью удаляем состояние из памяти
      this.deviceStates.delete(packet.deviceId);
    }

    return result;
  }

  /**
   * Получение состояния конкретного устройства (для отладки)
   */
  getDeviceState(deviceId) {
    return this.deviceStates.get(deviceId);
  }

  /**
   * Очистка всех состояний (для тестов)
   */
  clearStates() {
    this.deviceStates.clear();
  }
}
