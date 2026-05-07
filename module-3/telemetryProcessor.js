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
  ANOMALY_CONFIRM_PACKETS,
  LOADING_ZONE_STICKY_SECONDS,
  DEFAULT_ZONE_DEBOUNCE_MS
  ZONE_CHANGE_CONFIRM_PACKETS
} from './config.js';

export class TelemetryProcessor {
  constructor() {
    this.deviceStates = new Map();
  }

  getInitialState(weight = 0) {
    return {
      lastZoneName: null,           // для мгновенных баннеров UI
      currentZone: null,            // ПОДТВЕРЖДЁННАЯ зона (используется в бизнес-логике)
      confirmedZoneName: null,      // имя подтверждённой зоны для сравнения
      zoneStartWeight: weight,
      peakWeight: weight,
      isMixing: false,
      isUnloading: false,
      lastUnloadWeight: null,
      lastIngredientName: null,
      isBatchStarted: false,
      lastAcceptedWeight: null,
      anomalyCandidateWeight: null,
      anomalyCandidateCount: 0,
      lastLoadingZone: null,
      lastLoadingZoneAtMs: null,
      // Дебаунс смены зоны
      pendingZoneName: null,
      pendingZoneEnteredAtMs: null
      pendingZone: null,
      pendingZoneKey: null,
      pendingZoneCount: 0
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
      anomalyConfirmPackets: Number(settings.anomalyConfirmPackets) > 0 ? Number(settings.anomalyConfirmPackets) : ANOMALY_CONFIRM_PACKETS,
      loadingZoneStickySeconds: Number(settings.loadingZoneStickySeconds) > 0 ? Number(settings.loadingZoneStickySeconds) : LOADING_ZONE_STICKY_SECONDS,
      zoneChangeDebounceMs: Number(settings.zoneChangeDebounceMs) > 0 ? Number(settings.zoneChangeDebounceMs) : DEFAULT_ZONE_DEBOUNCE_MS
      zoneChangeConfirmPackets: Number(settings.zoneChangeConfirmPackets) > 0 ? Number(settings.zoneChangeConfirmPackets) : ZONE_CHANGE_CONFIRM_PACKETS
    };
  }

  _parsePacketTimestampMs(packet) {
    const raw = packet?.timestamp;
    if (raw instanceof Date) {
      const ts = raw.getTime();
      return Number.isFinite(ts) ? ts : Date.now();
    }
    const ts = new Date(raw || Date.now()).getTime();
    return Number.isFinite(ts) ? ts : Date.now();
  }

  _zoneKey(zone) {
    if (!zone) return null;
    if (Number.isFinite(Number(zone.id))) return `id:${Number(zone.id)}`;
    if (zone.name) return `name:${String(zone.name).trim().toLowerCase()}`;
    return null;
  }

  _getZoneTransitionConfirmPackets(currentZone, nextZone, thresholds) {
    // Вход в зону фиксируем сразу, иначе можно пропускать короткие реальные заезды.
    if (!currentZone && nextZone) return 1;
    // Выход из зоны и переход зона->зона подтверждаем несколькими пакетами,
    // чтобы убрать дребезг на границах.
    return Number(thresholds.zoneChangeConfirmPackets || ZONE_CHANGE_CONFIRM_PACKETS);
  }

  _resolveStableZone(state, detectedZone, thresholds) {
    const currentKey = this._zoneKey(state.currentZone);
    const detectedKey = this._zoneKey(detectedZone);

    if (currentKey === detectedKey) {
      state.pendingZone = null;
      state.pendingZoneKey = null;
      state.pendingZoneCount = 0;
      return {
        changed: false,
        zone: state.currentZone
      };
    }

    if (state.pendingZoneKey !== detectedKey) {
      state.pendingZone = detectedZone ? { ...detectedZone } : null;
      state.pendingZoneKey = detectedKey;
      state.pendingZoneCount = 1;
    } else {
      state.pendingZoneCount += 1;
    }

    const confirmPackets = this._getZoneTransitionConfirmPackets(state.currentZone, detectedZone, thresholds);
    if (state.pendingZoneCount < confirmPackets) {
      return {
        changed: false,
        zone: state.currentZone
      };
    }

    const nextZone = state.pendingZone ? { ...state.pendingZone } : null;
    state.pendingZone = null;
    state.pendingZoneKey = null;
    state.pendingZoneCount = 0;

    return {
      changed: true,
      zone: nextZone
    };
  }

  _hasActiveStickyZone(state, thresholds, packetTimeMs) {
    if (!state?.lastLoadingZone) return false;
    if (!Number.isFinite(Number(state.lastLoadingZoneAtMs))) return false;
    const ttlMs = Number(thresholds.loadingZoneStickySeconds || LOADING_ZONE_STICKY_SECONDS) * 1000;
    const ageMs = packetTimeMs - Number(state.lastLoadingZoneAtMs);
    return ageMs >= 0 && ageMs <= ttlMs;
  }

  _resolveStickyIngredient(state) {
    return state?.lastLoadingZone?.ingredient || state?.lastLoadingZone?.name || null;
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

  _resolveSegmentIngredient(state, thresholds, options = {}) {
    const directIngredient = state?.currentZone?.ingredient || state?.currentZone?.name;
    if (directIngredient) return directIngredient;

    const packetTimeMs = Number(options.packetTimeMs || Date.now());
    if (this._hasActiveStickyZone(state, thresholds, packetTimeMs)) {
      const stickyIngredient = this._resolveStickyIngredient(state);
      if (stickyIngredient) return stickyIngredient;
    }
    return 'Unknown';
  }

  _flushCurrentSegment(state, currentWeight, thresholds, result, options = {}) {
    if (options.suppressLoading && !state.currentZone) {
      return false;
    }

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

    const ingredientName = this._resolveSegmentIngredient(state, thresholds, {
      packetTimeMs: options.packetTimeMs
    });
    state.isMixing = true;
    state.lastIngredientName = ingredientName;

    result.dbActions.push({
      type: 'ADD_INGREDIENT',
      ingredientName,
      actualWeight: Math.round(delta)
    });

    return true;
  }

  _confirmZoneChange(state, zoneName, zoneObject, ingredientName, currentWeight, thresholds, result, options = {}) {
    // Флешим сегмент ПРЕДЫДУЩЕЙ подтверждённой зоны
    this._flushCurrentSegment(state, currentWeight, thresholds, result, {
      suppressLoading: options.suppressLoading,
      packetTimeMs: options.packetTimeMs
    });

    // Обновляем состояние на НОВУЮ подтверждённую зону
    state.currentZone = zoneObject ? { ...zoneObject, ingredient: ingredientName } : null;
    state.confirmedZoneName = zoneName;
    state.zoneStartWeight = currentWeight;
  }

  processPacket(packet, zonesConfig, settings = {}, options = {}) {
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
    const suppressLoading = Boolean(options.suppressLoading);
    const packetTimeMs = this._parsePacketTimestampMs(packet);

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

    // Фильтр аномалий веса
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
    
    // БАННЕР: показываем сразу при первом детектировании (для отзывчивости UI)
    if (activeZoneName && activeZoneName !== state.lastZoneName) {
      result.banner = {
        type: 'zone_enter',
        message: `Въезд в зону ${activeZoneName}`
      };
      state.lastZoneName = activeZoneName;
    }
    const detectedZone = detectZoneObject(lat, lon, zonesConfig);
    const zoneResolution = this._resolveStableZone(state, detectedZone, thresholds);
    const currentResolvedZone = zoneResolution.changed ? zoneResolution.zone : state.currentZone;
    const activeZoneName = currentResolvedZone?.name || null;
    const activeIngredientName = currentResolvedZone?.ingredient || activeZoneName;

    // ДЕБАУНС СМЕНЫ ЗОНЫ (бизнес-логика)
    const confirmedZoneName = state.confirmedZoneName || null;
    
    if (activeZoneName !== confirmedZoneName) {
      if (activeZoneName === state.pendingZoneName) {
        const timeInPending = packetTimeMs - state.pendingZoneEnteredAtMs;
        if (timeInPending >= thresholds.zoneChangeDebounceMs) {
          this._confirmZoneChange(
            state, 
            activeZoneName, 
            activeZone, 
            activeIngredientName, 
            currentWeight, 
            thresholds, 
            result, 
            { suppressLoading, packetTimeMs }
          );
          state.pendingZoneName = null;
          state.pendingZoneEnteredAtMs = null;
        }
      } else {
        state.pendingZoneName = activeZoneName;
        state.pendingZoneEnteredAtMs = packetTimeMs;
      }
    } else {
      state.pendingZoneName = null;
      state.pendingZoneEnteredAtMs = null;
    }

    // Sticky-зона: обновляется на КАЖДОМ пакете с активной зоной, независимо от дебаунса
    if (activeZoneName) {
      state.lastLoadingZone = activeZone ? { ...activeZone, ingredient: activeIngredientName } : null;
      state.lastLoadingZoneAtMs = packetTimeMs;
    }

    // Базовый вес обновляется только в спокойном режиме
    if (!state.isMixing && !state.isUnloading) {
      if (currentWeight < state.zoneStartWeight) {
        state.zoneStartWeight = currentWeight;
      }
    }

    // Пиковый вес
    // ===== ШАГ 4: Детекция загрузки =====
    if (zoneResolution.changed) {
      this._flushCurrentSegment(state, currentWeight, thresholds, result, {
        suppressLoading,
        packetTimeMs
      });

      state.currentZone = currentResolvedZone
        ? { ...currentResolvedZone, ingredient: activeIngredientName }
        : null;
      state.zoneStartWeight = currentWeight;
    }

    // Запоминаем последнюю зону загрузки после обработки смены зоны,
    // чтобы при входе в новую зону не перетереть предыдущий компонент до flush.
    if (state.currentZone?.name) {
      state.lastLoadingZone = {
        ...state.currentZone,
        ingredient: state.currentZone.ingredient || state.currentZone.name
      };
      state.lastLoadingZoneAtMs = packetTimeMs;
    }

    if (activeZoneName !== state.lastZoneName) {
      if (activeZoneName) {
        result.banner = {
          type: 'zone_enter',
          message: `Въезд в зону ${activeZoneName}`
        };
      }
      state.lastZoneName = activeZoneName;
    }

    if (currentWeight > state.peakWeight) {
      state.peakWeight = currentWeight;
    }

    // ЯВНАЯ ДЕТЕКЦИЯ UNKNOWN ВНЕ ЗОН
    if (
      !state.currentZone &&
      !suppressLoading &&
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

    // Защита от недовыгрузки
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

    // Детекция выгрузки
    if (
      !state.isUnloading &&
      (
        state.isMixing ||
        (!suppressLoading && (currentWeight - Number(state.zoneStartWeight || 0)) > thresholds.batchStartThresholdKg)
      ) &&
      state.peakWeight > thresholds.unloadMinPeakKg &&
      currentWeight < state.peakWeight - thresholds.unloadDropThresholdKg
    ) {
      this._flushCurrentSegment(state, currentWeight, thresholds, result, {
        segmentEndWeight: state.peakWeight,
        packetTimeMs
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

    // Вывод состояния (на основе подтверждённой зоны)
    result.state = {
      currentZone: state.confirmedZoneName,
      currentIngredient: state.currentZone?.ingredient || (state.isMixing ? state.lastIngredientName : null),
      isMixing: state.isMixing,
      isUnloading: state.isUnloading,
      peakWeight: state.peakWeight,
      lastIngredientName: state.lastIngredientName,
      isBatchStarted: state.isBatchStarted,
      currentMode: this._getCurrentMode(state)
    };

    state.lastAcceptedWeight = currentWeight;
    return result;
  }

  getState(deviceId) {
    const state = this.deviceStates.get(deviceId) || this.getInitialState();
    return {
      ...state,
      currentZone: state.confirmedZoneName || null,
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