import { detectZoneObject } from '../module-1/geo.js';
import { isValidLocation } from '../module-1/validator.js';

/**
 * Главный автомат состояний для обработки телеметрии
 * Отслеживает загрузки, выгрузки и перемещения между зонами
 */
export class TelemetryProcessor {
  constructor() {
    // Хранилище состояний по deviceId
    this.deviceStates = new Map();
  }

  /**
   * Возвращает начальное состояние для нового устройства
   */
  getInitialState(weight = 0) {
    return {
      lastZoneName: null,        // Зона из предыдущего пакета (для баннеров)
      currentZone: null,         // Текущая активная зона загрузки
      zoneStartWeight: weight,   // Вес в момент начала загрузки в зоне
      peakWeight: weight,        // Максимальный вес за цикл
      isMixing: false,           // Флаг: идет набор веса?
      isUnloading: false,        // Флаг: идет разгрузка?
      lastUnloadWeight: null,    // Последний вес при разгрузке
      lastIngredientName: null
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
    const deviceId = packet.deviceId || packet.device_id || 'host_01';
    const lat = Number(packet.lat);
    const lon = Number(packet.lon);
    const currentWeight = Number(packet.weight || 0);

    if (!isValidLocation(lat, lon)) {
      result.isValid = false;
      result.error = 'Invalid GPS coordinates';
      return result;
    }

    // ===== Получаем или создаем состояние устройства =====
    let state = this.deviceStates.get(deviceId);
    if (!state) {
      state = this.getInitialState(currentWeight);
      this.deviceStates.set(deviceId, state);
    }

    // ===== ШАГ 2: Определение зоны и баннеров =====
    const activeZone = detectZoneObject(lat, lon, zonesConfig);
    const activeZoneName = activeZone?.name || null;
    const activeIngredientName = activeZone?.ingredient || activeZoneName;
    
    // Если зона сменилась — генерируем баннер
    if (activeZoneName !== state.lastZoneName) {
      if (activeZoneName) {
        result.banner = {
          type: 'zone_enter',
          message: `Въезд в зону ${activeZoneName}`
        };
      }
      state.lastZoneName = activeZoneName;
    }

    // ===== ШАГ 3: Авто-Тара (Защита от "Васи с лопатой") =====
    // Если трактор пустой и вес упал ниже стартового — обновляем дно
    if (!state.isMixing && !state.isUnloading) {
      if (currentWeight < state.zoneStartWeight) {
        state.zoneStartWeight = currentWeight;
      }
    }

    // ===== ШАГ 4: Детекция загрузки (смена зоны) =====
    if ((state.currentZone?.name || null) !== activeZoneName) {
      // Проверяем, был ли в какой-то зоне до этого
      if (state.currentZone) {
        const delta = currentWeight - state.zoneStartWeight;
        
        // Если набрал больше 30 кг — это загрузка
        if (delta > 30) {
          state.isMixing = true;
          const ingredientName = state.currentZone.ingredient || state.currentZone.name || 'Unknown';
          state.lastIngredientName = ingredientName;
          
          result.dbActions.push({
            type: 'ADD_INGREDIENT',
            ingredientName,
            actualWeight: Math.round(delta)
          });
        }
      }

      // В любом случае обновляем якоря
      state.currentZone = activeZone ? { ...activeZone, ingredient: activeIngredientName } : null;
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
      this.deviceStates.delete(deviceId);
    }

    result.state = {
      currentZone: activeZoneName,
      currentIngredient: activeIngredientName,
      isMixing: state.isMixing,
      isUnloading: state.isUnloading,
      peakWeight: state.peakWeight,
      lastIngredientName: state.lastIngredientName
    };

    return result;
  }

  /**
   * Получение состояния конкретного устройства (для отладки)
   */
  getState(deviceId) {
    const state = this.deviceStates.get(deviceId) || this.getInitialState();
    return {
      ...state,
      currentZone: state.currentZone?.name || null,
      currentIngredient: state.currentZone?.ingredient || state.lastIngredientName || null
    };
  }

  getDeviceState(deviceId) {
    return this.getState(deviceId);
  }

  /**
   * Очистка всех состояний (для тестов)
   */
  clearStates() {
    this.deviceStates.clear();
  }
}

export default new TelemetryProcessor();
