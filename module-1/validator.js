/**
 * Базовый фильтр от «мусорных» GPS-данных
 * @param {number|null} lat - Широта
 * @param {number|null} lon - Долгота
 * @returns {boolean} true, если координаты валидны
 */
function isValidLocation(lat, lon) {
  // 1. Проверяем, что значения существуют и являются числами
  if (lat === null || lat === undefined || typeof lat !== 'number') {
    return false;
  }
  
  if (lon === null || lon === undefined || typeof lon !== 'number') {
    return false;
  }

  // 2. Проверяем, что это не NaN
  if (isNaN(lat) || isNaN(lon)) {
    return false;
  }

  // 3. Проверяем реальные земные границы
  // Широта: от -90° (Южный полюс) до +90° (Северный полюс)
  if (lat < -90 || lat > 90) {
    return false;
  }

  // Долгота: от -180° до +180°
  if (lon < -180 || lon > 180) {
    return false;
  }

  // Все проверки пройдены
  return true;
}