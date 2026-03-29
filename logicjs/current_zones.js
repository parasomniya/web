/** Как ответ GET с геозонами: active: false не попадают в LOADING_ZONES. */
module.exports = [
    {
        id: 1,
        name: 'Склад',
        lat: 55.7558,
        lon: 37.6173,
        radius: 100,
        ingredient: 'Силос',
        active: true,
    },
    {
        id: 2,
        name: 'Площадка',
        lat: 55.7658,
        lon: 37.6273,
        radius: 100,
        ingredient: 'Сенаж',
        active: true,
    },
    {
        id: 3,
        name: 'Бункер',
        lat: 55.7458,
        lon: 37.6073,
        radius: 100,
        ingredient: 'Концентрат',
        active: true,
    },
    {
        id: 4,
        name: 'Снята с учёта',
        lat: 55.0,
        lon: 83.0,
        radius: 15,
        ingredient: 'Силос',
        active: false,
    },
];
