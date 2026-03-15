const API_URL = "http://localhost:3000/api/storage-zones";

let map;

ymaps.ready(init);

function init() {

    map = new ymaps.Map("map", {
        center: [55.75, 37.57],
        zoom: 12
    });

    // ТЕСТОВАЯ ЗОНА
    const testCircle = new ymaps.Circle(
        [[55.75, 37.57], 500],
        {
            balloonContent: "Тестовая зона"
        },
        {
            fillColor: "#00FF0088",
            strokeColor: "#008800",
            strokeWidth: 2
        }
    );

    map.geoObjects.add(testCircle);

}

async function loadStorageZones() {

    try {

        const res = await fetch(API_URL);
        const zones = await res.json();

        drawZones(zones);

    } catch (err) {

        console.error("Ошибка загрузки зон", err);

    }

}

function drawZones(zones) {

    zones.forEach(zone => {

        const circle = new ymaps.Circle(
            [[zone.lat, zone.lon], zone.radius],
            {
                balloonContent: zone.ingredient
            },
            {
                fillColor: "#00FF0088",
                strokeColor: "#008800",
                strokeWidth: 2
            }
        );

        map.geoObjects.add(circle);

    });

}