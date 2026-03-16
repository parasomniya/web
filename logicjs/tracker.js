// tracker.js
const {
    LOADING_ZONES,
    UNLOAD_ZONE,
    WEIGHT_THRESHOLD_W,
    BATCH_END_DELAY,
    WEIGHT_EPSILON,
    FeedType,
    IDEAL_WEIGHTS,
    ACCEPTABLE_DELTA_PERCENT,
    ACCEPTABLE_REMAINING_WEIGHT // Импортируем новую константу
} = require('./zones');

// ... (функции haversineDistance и checkZone без изменений) ...
function haversineDistance(coord1, coord2) {
    const R = 6371000;
    const toRad = (deg) => deg * (Math.PI / 180);
    const lat1 = toRad(coord1[0]);
    const lon1 = toRad(coord1[1]);
    const lat2 = toRad(coord2[0]);
    const lon2 = toRad(coord2[1]);
    const dLat = lat2 - lat1;
    const dLon = lon2 - lon1;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function checkZone(location, zones) {
    for (const [zoneName, zoneData] of Object.entries(zones)) {
        const dist = haversineDistance(location, zoneData.center);
        if (dist <= zoneData.radius) {
            return zoneName;
        }
    }
    return null;
}

class FeedBatchTracker {
    constructor(thresholdW = WEIGHT_THRESHOLD_W) {
        this.threshold_W = thresholdW;
        this.is_batch_active = false;
        this.batch_start_time = null;
        this.initial_weight_W0 = 0.0;
        this.current_weight = 0.0;
        this.previous_weight = 0.0;
        this.previous_location = null;
        this.previous_timestamp = null;
        this.unload_detected_time = null;
        this.weight_stable_time = null;
        
        this.batch_feeds = {
            [FeedType.CORN]: 0.0,
            [FeedType.WHEAT]: 0.0,
            [FeedType.SOY]: 0.0,
            [FeedType.UNKNOWN]: 0.0
        };
        
        this.completed_batches = [];
        this.batch_counter = 0;
        this.last_batch_final_weight = 0.0;
    }

    processTelemetry(lat, lon, weight, timestamp) {
        this.previous_weight = this.current_weight;
        this.current_weight = weight;
        this.previous_location = [lat, lon];
        this.previous_timestamp = timestamp;

        const weightDiff = weight - this.previous_weight;

        if (!this.is_batch_active && weight > this.threshold_W) {
            this._startBatch(weight);
            return { status: "batch_started", W0: this.initial_weight_W0 };
        }

        if (this.is_batch_active) {
            return this._processActiveBatch([lat, lon], timestamp, weight, weightDiff);
        }

        return { status: "waiting", weight: weight };
    }

    _startBatch(initialWeight) {
        this.is_batch_active = true;
        this.batch_start_time = new Date();
        this.initial_weight_W0 = this.last_batch_final_weight;
        this.batch_counter += 1;
        
        this.batch_feeds = {
            [FeedType.CORN]: 0.0,
            [FeedType.WHEAT]: 0.0,
            [FeedType.SOY]: 0.0,
            [FeedType.UNKNOWN]: 0.0
        };

        const weightDiff = initialWeight - this.initial_weight_W0;
        if (weightDiff > 0) {
            if (this.previous_location) {
                const loadingZone = checkZone(this.previous_location, LOADING_ZONES);
                const feedType = loadingZone || FeedType.UNKNOWN;
                this.batch_feeds[feedType] += weightDiff;
            } else {
                this.batch_feeds[FeedType.UNKNOWN] += weightDiff;
            }
        }

        this.unload_detected_time = null;
        this.weight_stable_time = null;
    }

    _processActiveBatch(location, timestamp, weight, weightDiff) {
        const loadingZone = checkZone(location, LOADING_ZONES);
        const inUnloadZone = checkZone(location, { unload: UNLOAD_ZONE }) !== null;

        if (weightDiff > WEIGHT_EPSILON) {
            this.weight_stable_time = null;
            const feedType = loadingZone || FeedType.UNKNOWN;
            this.batch_feeds[feedType] += weightDiff;
            
            return {
                status: "loading",
                weight: weight,
                feed_type: feedType,
                added: parseFloat(weightDiff.toFixed(2))
            };
        } 
        else if (weightDiff < -WEIGHT_EPSILON) {
            if (inUnloadZone) {
                this.unload_detected_time = timestamp;
                return { status: "unloading", weight: weight };
            } else {
                return { status: "weight_loss_warning", weight: weight };
            }
        } 
        else {
            if (inUnloadZone && this.unload_detected_time) {
                if (!this.weight_stable_time) {
                    this.weight_stable_time = timestamp;
                }
                
                const timeDiffSeconds = (timestamp - this.weight_stable_time) / 1000;
                
                if (timeDiffSeconds >= BATCH_END_DELAY) {
                    this._endBatch(weight);
                    return { status: "batch_completed", weight: weight };
                }
            }
            return { status: "stable", weight: weight };
        }
    }

    _endBatch(finalWeight) {
        const totalLoaded = Object.values(this.batch_feeds).reduce((sum, val) => sum + val, 0);
        
        // 1. Сначала считаем нарушения по типам кормов
        const violations = this._calculateFeedViolations();

        // 2. ПРОВЕРКА ОСТАТОЧНОГО ВЕСА
        if (finalWeight > ACCEPTABLE_REMAINING_WEIGHT) {
            violations.push(`Не выгружено ${finalWeight.toFixed(2)} кг`);
        }

        const report = {
            batch_id: this.batch_counter,
            start_time: this.batch_start_time,
            end_time: new Date(),
            W0: parseFloat(this.initial_weight_W0.toFixed(2)),
            W_final: parseFloat(finalWeight.toFixed(2)),
            feeds: Object.fromEntries(
                Object.entries(this.batch_feeds).map(([k, v]) => [k, parseFloat(v.toFixed(2))])
            ),
            total_loaded: parseFloat(totalLoaded.toFixed(2)),
            violations: violations
        };

        this.completed_batches.push(report);
        this.last_batch_final_weight = finalWeight;
        
        this.is_batch_active = false;
        this.batch_feeds = {};
        this.unload_detected_time = null;
        this.weight_stable_time = null;
        
        return report;
    }

    // Переименовали метод для ясности, он теперь только про корма
    _calculateFeedViolations() {
        const violations = [];
        
        for (const [feedType, currentWeight] of Object.entries(this.batch_feeds)) {
            if (feedType === FeedType.UNKNOWN || !(feedType in IDEAL_WEIGHTS)) {
                continue;
            }

            const idealWeight = IDEAL_WEIGHTS[feedType];
            const allowedDeltaKg = idealWeight * (ACCEPTABLE_DELTA_PERCENT / 100.0);
            const diff = currentWeight - idealWeight;
            const absDiff = Math.abs(diff);

            if (absDiff > allowedDeltaKg) {
                let message = "";
                if (diff > 0) {
                    message = `вес ${feedType} превышен. Идеальный вес=${idealWeight}, текущий=${currentWeight.toFixed(2)}`;
                } else {
                    message = `вес ${feedType} занижен. Идеальный вес=${idealWeight}, текущий=${currentWeight.toFixed(2)}`;
                }
                violations.push(message);
            }
        }
        return violations;
    }

    getCurrentStatus() {
        // Для статуса в реальном времени проверяем только корма, 
        // так как финальный вес еще не известен (батч не завершен)
        const violations = this._calculateFeedViolations();

        return {
            is_active: this.is_batch_active,
            current_weight: parseFloat(this.current_weight.toFixed(2)),
            initial_weight_W0: this.is_batch_active ? parseFloat(this.initial_weight_W0.toFixed(2)) : null,
            batch_start_time: this.batch_start_time,
            feeds: this.is_batch_active 
                ? Object.fromEntries(Object.entries(this.batch_feeds).map(([k, v]) => [k, parseFloat(v.toFixed(2))]))
                : {},
            message: this.is_batch_active ? "Batch активен" : "Ожидание начала Batch",
            violations: violations
        };
    }

    getBatchHistory() {
        return this.completed_batches;
    }

    getLastBatch() {
        return this.completed_batches.length > 0 ? this.completed_batches[this.completed_batches.length - 1] : null;
    }
}

const tracker = new FeedBatchTracker();

module.exports = { tracker };