/**
 * Вычисляет расстояние между двумя точками по формуле гаверсинуса.
 * @param {number} lat1 - Широта первой точки (градусы)
 * @param {number} lon1 - Долгота первой точки (градусы)
 * @param {number} lat2 - Широта второй точки (градусы)
 * @param {number} lon2 - Долгота второй точки (градусы)
 * @returns {number} Расстояние в метрах
 */
export function calculateHaversine(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Средний радиус Земли в метрах
  const toRad = deg => deg * Math.PI / 180;

  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lon2 - lon1);

  const sinDPhi2 = Math.sin(dPhi / 2);
  const sinDLambda2 = Math.sin(dLambda / 2);

  let a = sinDPhi2 * sinDPhi2 + 
          Math.cos(phi1) * Math.cos(phi2) * 
          sinDLambda2 * sinDLambda2;

  // Защита от микропереполнения float: a может стать 1.0000000000000002
  if (a > 1) a = 1;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}


export function detectZoneObject(lat, lon, zonesConfig = []) {
    let distance
    for (const zone of zonesConfig)
    {
        distance = calculateHaversine(lat, lon, Number(zone.lat), Number(zone.lon))
        if (distance <= Number(zone.radius))
        {
            return zone
        }
    }
    return null
}

export function detectZone(lat, lon, zonesConfig = []) {
    return detectZoneObject(lat, lon, zonesConfig)?.name || null
}

export default detectZone
