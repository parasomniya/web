import { detectZoneObject } from '../module-1/geo.js';
import { isValidLocation } from '../module-1/validator.js';
import {
  BATCH_START_THRESHOLD_KG,
  LEFTOVER_THRESHOLD_KG,
  UNLOAD_DROP_THRESHOLD_KG,
  UNLOAD_MIN_PEAK_KG,
  UNLOAD_UPDATE_DELTA_KG,
  UNLOAD_WEIGHT_BUFFER_KG,
  EMPTY_VEHICLE_THRESHOLD_KG,
  ANOMALY_THRESHOLD_KG,
  ANOMALY_CONFIRM_DELTA_KG,
  ANOMALY_CONFIRM_PACKETS
} from './config.js';

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
      isBatchStarted: false,
      lastAcceptedWeight: null,
      anomalyCandidateWeight: null,
      anomalyCandidateCount: 0
    };
  }

  _getCurrentMode(state) {
    if (state.isUnloading) return 'unloading';
    if (state.isMixing) return 'loading';
    return 'idle';
  }

  _resolveThresholds(settings = {}) {
    return {
      batchStartThresholdKg: Number(settings.batchStartThresholdKg) > 0 ? Number(settings.batchStartThresholdKg) : BATCH_START_THRESHOLD_KG,
      leftoverThresholdKg: Number(settings.leftoverThresholdKg) > 0 ? Number(settings.leftoverThresholdKg) : LEFTOVER_THRESHOLD_KG,
      unloadDropThresholdKg: Number(settings.unloadDropThresholdKg) > 0 ? Number(settings.unloadDropThresholdKg) : UNLOAD_DROP_THRESHOLD_KG,
      unloadMinPeakKg: Number(settings.unloadMinPeakKg) > 0 ? Number(settings.unloadMinPeakKg) : UNLOAD_MIN_PEAK_KG,
      unloadUpdateDeltaKg: Number(settings.unloadUpdateDeltaKg) > 0 ? Number(settings.unloadUpdateDeltaKg) : UNLOAD_UPDATE_DELTA_KG,
      anomalyThresholdKg: Number(settings.anomalyThresholdKg) > 0 ? Number(settings.anomalyThresholdKg) : ANOMALY_THRESHOLD_KG,
      anomalyConfirmDeltaKg: Number(settings.anomalyConfirmDeltaKg) > 0 ? Number(settings.anomalyConfirmDeltaKg) : ANOMALY_CONFIRM_DELTA_KG,
      anomalyConfirmPackets: Number(settings.anomalyConfirmPackets) > 0 ? Number(settings.anomalyConfirmPackets) : ANOMALY_CONFIRM_PACKETS
    };
  }

  _buildSkippedResult(deviceId) {
    return {
      isValid: true,
      skipped: true,
      error: null,
      banner: null,
      dbActions: [],
      state: this.getState(deviceId)
    };
  }

  _resolveSegmentIngredient(state) {
    return state?.currentZone?.ingredient || state?.currentZone?.name || 'Unknown';
  }

  _flushCurrentSegment(state, currentWeight, thresholds, result, options = {}) {
    const segmentEndWeight = Number(options.segmentEndWeight ?? currentWeight);
    const delta = segmentEndWeight - Number(state.zoneStartWeight || 0);

    if (!(delta > thresholds.batchStartThresholdKg)) {
      return false;
    }

    if (!state.isBatchStarted) {
      state.isBatchStarted = true;
      result.dbActions.push({
        type: 'START_BATCH',
        startWeight: Math.round(state.zoneStartWeight)
      });
    }

    const ingredientName = this._resolveSegmentIngredient(state);
    state.isMixing = true;
    state.lastIngredientName = ingredientName;

    result.dbActions.push({
      type: 'ADD_INGREDIENT',
      ingredientName,
      actualWeight: Math.round(delta)
    });

    return true;
  }

  processPacket(packet, zonesConfig, settings = {}) {
    const result = {
      isValid: true,
      error: null,
      banner: null,
      dbActions: []
    };

    const deviceId = packet.deviceId || packet.device_id || 'host_01';
    const lat = Number(packet.lat);
    const lon = Number(packet.lon);
    const currentWeightRaw = Number(packet.weight || 0);
    const currentWeight = Number.isFinite(currentWeightRaw)
      ? Math.max(0, currentWeightRaw)
      : 0;
    const thresholds = this._resolveThresholds(settings);

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

    if (state.lastAcceptedWeight === null) {
      state.lastAcceptedWeight = currentWeight;
    }

    // Фильтр аномалий:
    // 1) если скачок от последнего принятого веса слишком большой - не принимаем сразу;
    // 2) принимаем только после серии подтверждающих пакетов рядом с новым уровнем.
    const deltaFromAccepted = Math.abs(currentWeight - state.lastAcceptedWeight);
    if (deltaFromAccepted > thresholds.anomalyThresholdKg) {
      if (
        state.anomalyCandidateWeight !== null &&
        Math.abs(currentWeight - state.anomalyCandidateWeight) <= thresholds.anomalyConfirmDeltaKg
      ) {
        state.anomalyCandidateCount += 1;
      } else {
        state.anomalyCandidateWeight = currentWeight;
        state.anomalyCandidateCount = 1;
      }

      if (state.anomalyCandidateCount < thresholds.anomalyConfirmPackets) {
        return this._buildSkippedResult(deviceId);
      }

      state.lastAcceptedWeight = state.anomalyCandidateWeight;
      state.anomalyCandidateWeight = null;
      state.anomalyCandidateCount = 0;
    } else if (state.anomalyCandidateWeight !== null || state.anomalyCandidateCount > 0) {
      state.anomalyCandidateWeight = null;
      state.anomalyCandidateCount = 0;
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
      this._flushCurrentSegment(state, currentWeight, thresholds, result);

      state.currentZone = activeZone ? { ...activeZone, ingredient: activeIngredientName } : null;
      state.zoneStartWeight = currentWeight;
    }

    if (currentWeight > state.peakWeight) {
      state.peakWeight = currentWeight;
    }

    // ===== ЯВНАЯ ДЕТЕКЦИЯ UNKNOWN ВНЕ ЗОН =====
    if (
      !activeZone &&
      !state.isUnloading &&
      !state.isBatchStarted &&
      (currentWeight - Number(state.zoneStartWeight || 0)) > thresholds.batchStartThresholdKg
    ) {
      state.isBatchStarted = true;
      state.isMixing = true;
      state.lastIngredientName = 'Unknown';

      result.dbActions.push({
        type: 'START_BATCH',
        startWeight: Math.round(state.zoneStartWeight)
      });
    }

    // ===== ШАГ 6: Защита от недовыгрузки =====
    if (state.isUnloading && Number.isFinite(state.lastUnloadWeight) && currentWeight > state.lastUnloadWeight + UNLOAD_WEIGHT_BUFFER_KG) {
      const leftoverWeight = state.lastUnloadWeight;
  
      if (leftoverWeight > thresholds.leftoverThresholdKg) {
        result.dbActions.push({
          type: 'LEFTOVER_VIOLATION',
          leftoverWeight: Math.round(leftoverWeight),
        });
      }

      result.dbActions.push({
        type: 'FORCE_CLOSE_BATCH',
        closeWeight: Math.round(leftoverWeight),
        nextStartWeight: Math.round(currentWeight)
      });

      state.zoneStartWeight = state.lastUnloadWeight;
      state.isMixing = false;
      state.isUnloading = false;
      state.isBatchStarted = false;
      state.peakWeight = currentWeight;
      state.lastUnloadWeight = null;
    }

    // ===== ШАГ 7: Детекция выгрузки =====
    if (
      !state.isUnloading &&
      (state.isMixing || (currentWeight - Number(state.zoneStartWeight || 0)) > thresholds.batchStartThresholdKg) &&
      state.peakWeight > thresholds.unloadMinPeakKg &&
      currentWeight < state.peakWeight - thresholds.unloadDropThresholdKg
    ) {
      this._flushCurrentSegment(state, currentWeight, thresholds, result, {
        segmentEndWeight: state.peakWeight
      });
      state.isUnloading = true;
      state.lastUnloadWeight = currentWeight;

      result.dbActions.push({
        type: 'START_UNLOAD',
        startUnloadWeight: Math.round(currentWeight),
        peakWeight: state.peakWeight
      });

      result.dbActions.push({
        type: 'UPDATE_UNLOAD',
        endWeight: Math.round(currentWeight)
      });
    } else if (
      state.isUnloading &&
      Number.isFinite(state.lastUnloadWeight) &&
      Math.abs(currentWeight - state.lastUnloadWeight) >= thresholds.unloadUpdateDeltaKg
    ) {
      state.lastUnloadWeight = currentWeight;
      result.dbActions.push({
        type: 'UPDATE_UNLOAD',
        endWeight: Math.round(currentWeight)
      });
    }

    // Окончание: если кузов пуст
    if (state.isUnloading && currentWeight < EMPTY_VEHICLE_THRESHOLD_KG) {
      result.dbActions.push({
        type: 'COMPLETE_BATCH',
        endWeight: Math.round(currentWeight)
      });

      this.deviceStates.delete(deviceId);
    }

    result.state = {
      currentZone: activeZoneName,
      currentIngredient: activeIngredientName || (state.isMixing ? state.lastIngredientName : null),
      isMixing: state.isMixing,
      isUnloading: state.isUnloading,
      peakWeight: state.peakWeight,
      lastIngredientName: state.lastIngredientName,
      isBatchStarted: state.isBatchStarted,
      currentMode: this._getCurrentMode(state)
    };

    // Запоминаем вес только если пакет прошёл фильтр
    state.lastAcceptedWeight = currentWeight;
    return result;
  }

  getState(deviceId) {
    const state = this.deviceStates.get(deviceId) || this.getInitialState();
    return {
      ...state,
      currentZone: state.currentZone?.name || null,
      currentIngredient: state.currentZone?.ingredient || state.lastIngredientName || null,
      currentMode: this._getCurrentMode(state)
    };
  }

  getDeviceState(deviceId) {
    return this.getState(deviceId);
  }

  clearDeviceState(deviceId) {
    if (!deviceId) return;
    this.deviceStates.delete(deviceId);
  }

  clearStates() {
    this.deviceStates.clear();
  }
}

export default new TelemetryProcessor();
