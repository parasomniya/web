// zones.js

const FeedType = {
    CORN: "corn",
    WHEAT: "wheat",
    SOY: "soy",
    UNKNOWN: "unknown",
};

const LOADING_ZONES = {
    [FeedType.CORN]: { center: [55.7558, 37.6173], radius: 100 },
    [FeedType.WHEAT]: { center: [55.7658, 37.6273], radius: 100 },
    [FeedType.SOY]: { center: [55.7458, 37.6073], radius: 100 },
};

const UNLOAD_ZONE = { center: [55.7358, 37.5973], radius: 100 };

const WEIGHT_THRESHOLD_W = 100.0;
const BATCH_END_DELAY = 10; // Секунды для тестов
const WEIGHT_EPSILON = 0.5;

const IDEAL_WEIGHTS = {
    [FeedType.CORN]: 5000.0,
    [FeedType.WHEAT]: 4500.0,
    [FeedType.SOY]: 3000.0,
};

const ACCEPTABLE_DELTA_PERCENT = 5.0;

// --- НОВАЯ КОНСТАНТА ---
// Максимально допустимый остаточный вес после выгрузки (в кг)
// Если W_final > этого значения, будет добавлено нарушение
const ACCEPTABLE_REMAINING_WEIGHT = 200.0; 

module.exports = {
    FeedType,
    LOADING_ZONES,
    UNLOAD_ZONE,
    WEIGHT_THRESHOLD_W,
    BATCH_END_DELAY,
    WEIGHT_EPSILON,
    IDEAL_WEIGHTS,
    ACCEPTABLE_DELTA_PERCENT,
    ACCEPTABLE_REMAINING_WEIGHT // Экспортируем новую константу
};