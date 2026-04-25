import { detectZoneObject } from '../module-1/geo.js';
import { isValidLocation } from '../module-1/validator.js';

export class TelemetryProcessor {
  constructor() {
    this.deviceStates = new Map();
  }

  getInitialState(weight = 0) {
    return {
      lastZoneName: null,
      currentZone: null,
      zoneStartWeight: weight,
      peakWeight: weight,
      isMixing: false,
      isUnloading: false,
      lastUnloadWeight: null,
      lastIngredientName: null,
      isBatchStarted: false
    };
  }

  /**
   * Вычисляет текущий режим работы устройства
   */
  _getCurrentMode(state) {
    if (state.isUnloading) return 'unloading';
    if (state.isMixing) return 'loading';
    return 'idle';
  }

  processPacket(packet, zonesConfig) {
    const result = {
      isValid: true,
      error: null,
      banner: null,
      dbActions: []
    };

    const deviceId = packet.deviceId || packet.device_id || 'host_01';
    const lat = Number(packet.lat);
    const lon = Number(packet.lon);
    const currentWeight = Number(packet.weight || 0);

    if (!isValidLocation(lat, lon)) {
      result.isValid = false;
      result.error = 'Invalid GPS coordinates';
      return result;
    }

    let state = this.deviceStates.get(deviceId);
    if (!state) {
      state = this.getInitialState(currentWeight);
      this.deviceStates.set(deviceId, state);
    }

    const activeZone = detectZoneObject(lat, lon, zonesConfig);
    const activeZoneName = activeZone?.name || null;
    const activeIngredientName = activeZone?.ingredient || activeZoneName;
    
    if (activeZoneName !== state.lastZoneName) {
      if (activeZoneName) {
        result.banner = {
          type: 'zone_enter',
          message: `Въезд в зону ${activeZoneName}`
        };
      }
      state.lastZoneName = activeZoneName;
    }

    if (!state.isMixing && !state.isUnloading) {
      if (currentWeight < state.zoneStartWeight) {
        state.zoneStartWeight = currentWeight;
      }
    }

    // ===== ШАГ 4: Детекция загрузки =====
    if ((state.currentZone?.name || null) !== activeZoneName) {
      if (state.currentZone) {
        const delta = currentWeight - state.zoneStartWeight;
        
        if (delta > 30) {
          if (!state.isBatchStarted) {
            state.isBatchStarted = true;
            result.dbActions.push({
              type: 'START_BATCH',
              startWeight: currentWeight
            });
          }

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

      state.currentZone = activeZone ? { ...activeZone, ingredient: activeIngredientName } : null;
      state.zoneStartWeight = currentWeight;
    }

    if (currentWeight > state.peakWeight) {
      state.peakWeight = currentWeight;
    }

    // ===== ШАГ 6: Защита от недовыгрузки =====
    if (state.isUnloading && currentWeight > state.lastUnloadWeight + 50) {
      const leftoverWeight = state.lastUnloadWeight;
  
      if (leftoverWeight > 50) {
        result.dbActions.push({
          type: 'LEFTOVER_VIOLATION',
          leftoverWeight: Math.round(leftoverWeight),
        });
      }

      result.dbActions.push({
        type: 'FORCE_CLOSE_BATCH'
      });

      state.zoneStartWeight = state.lastUnloadWeight;
      state.isMixing = false;
      state.isUnloading = false;
      state.isBatchStarted = false;
      state.peakWeight = currentWeight;
      state.lastUnloadWeight = null;
    }

    // ===== ШАГ 7: Детекция выгрузки =====
    if (state.isMixing && state.peakWeight > 400 && currentWeight < state.peakWeight - 200) {
      state.isUnloading = true;
      state.lastUnloadWeight = currentWeight;

      result.dbActions.push({
        type: 'START_UNLOAD',
        startUnloadWeight: Math.round(currentWeight),
        peakWeight: state.peakWeight
      });
    }

    // Окончание: если кузов пуст (< 50 кг)
    if (state.isUnloading && currentWeight < 50) {
      result.dbActions.push({
        type: 'COMPLETE_BATCH'
      });

      this.deviceStates.delete(deviceId);
    }

    // 🆕 Добавляем явный режим в output state
    result.state = {
      currentZone: activeZoneName,
      currentIngredient: activeIngredientName,
      isMixing: state.isMixing,
      isUnloading: state.isUnloading,
      peakWeight: state.peakWeight,
      lastIngredientName: state.lastIngredientName,
      isBatchStarted: state.isBatchStarted,
      currentMode: this._getCurrentMode(state)  // ✅ Явный режим
    };

    return result;
  }

  getState(deviceId) {
    const state = this.deviceStates.get(deviceId) || this.getInitialState();
    return {
      ...state,
      currentZone: state.currentZone?.name || null,
      currentIngredient: state.currentZone?.ingredient || state.lastIngredientName || null,
      currentMode: this._getCurrentMode(state)  // ✅ И здесь тоже
    };
  }

  getDeviceState(deviceId) {
    return this.getState(deviceId);
  }

  clearStates() {
    this.deviceStates.clear();
  }
}

export default new TelemetryProcessor();