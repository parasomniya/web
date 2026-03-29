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

/** Три прежние точки — раздаём по кругу ингредиентам из JSON (временно, пока нет координат в рационе). */
const _defaultZoneSlots = [
    { center: [55.7558, 37.6173], radius: 100 },
    { center: [55.7658, 37.6273], radius: 100 },
    { center: [55.7458, 37.6073], radius: 100 },
];

function _normIngredient(s) {
    return String(s || '').trim().toLowerCase();
}

/**
 * Только зоны загрузки: ключ = id ингредиента в рационе (как в batch).
 * Учитываются только active !== false; ingredient в JSON должен совпадать с name ингредиента.
 */
function applyLoadingZonesFromApi(ration, zonesList) {
    const ings = ration && ration.ingredients ? ration.ingredients : [];
    for (const k of Object.keys(LOADING_ZONES)) delete LOADING_ZONES[k];
    const list = Array.isArray(zonesList) ? zonesList : [];
    for (const z of list) {
        if (z.active === false) continue;
        const lat = Number(z.lat);
        const lon = Number(z.lon);
        if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
        const ing = ings.find((i) => _normIngredient(i.name) === _normIngredient(z.ingredient));
        if (!ing) continue;
        LOADING_ZONES[String(ing.id)] = {
            center: [lat, lon],
            radius: Number(z.radius) || 15,
        };
    }
}

/**
 * Рацион + опционально массив геозон (формат API). Если зон нет — старая раздача координат по кругу.
 */
function applyRation(ration, loadingZonesFromApi) {
    const ings = ration && ration.ingredients ? ration.ingredients : [];
    if (ings.length === 0) return;
    for (const k of Object.keys(FeedType)) delete FeedType[k];
    for (const ing of ings) {
        FeedType[String(ing.id)] = ing.name;
    }
    FeedType.UNKNOWN = 'unknown';

    for (const k of Object.keys(IDEAL_WEIGHTS)) delete IDEAL_WEIGHTS[k];
    for (const ing of ings) {
        IDEAL_WEIGHTS[String(ing.id)] = Number(ing.plannedWeight) || 0;
    }

    for (const k of Object.keys(LOADING_ZONES)) delete LOADING_ZONES[k];
    if (Array.isArray(loadingZonesFromApi) && loadingZonesFromApi.length > 0) {
        applyLoadingZonesFromApi(ration, loadingZonesFromApi);
    } else {
        ings.forEach((ing, i) => {
            LOADING_ZONES[String(ing.id)] = { ..._defaultZoneSlots[i % _defaultZoneSlots.length] };
        });
    }
}

function emptyBatchFeeds() {
    const o = { [FeedType.UNKNOWN]: 0 };
    for (const key of Object.keys(FeedType)) {
        if (key === 'UNKNOWN') continue;
        o[key] = 0;
    }
    return o;
}

module.exports = {
    FeedType,
    LOADING_ZONES,
    UNLOAD_ZONE,
    WEIGHT_THRESHOLD_W,
    BATCH_END_DELAY,
    WEIGHT_EPSILON,
    IDEAL_WEIGHTS,
    ACCEPTABLE_DELTA_PERCENT,
    ACCEPTABLE_REMAINING_WEIGHT,
    applyRation,
    applyLoadingZonesFromApi,
    emptyBatchFeeds,
};