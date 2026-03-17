const ZONES_API = "http://localhost:3000/api/storage-zones";
const TELEMETRY_API = "http://localhost:3000/api/telemetry/latest";

let map;
let deviceMarker = null;

let zones = [];
let zoneCircles = [];

ymaps.ready(init);

function init() {

    map = new ymaps.Map("map", {
        center: [55.75, 37.57],
        zoom: 12
    });

    loadZones();
    loadTelemetry();

    setInterval(loadTelemetry, 5000);

}

async function loadZones() {

    const response = await fetch(ZONES_API, {
        headers: {
            "Authorization": "Bearer token"
        }
    });

    zones = await response.json();

    drawZones();
    renderTable();

}

function drawZones() {

    zoneCircles.forEach(circle => map.geoObjects.remove(circle));
    zoneCircles = [];

    zones.forEach(zone => {

        const circle = new ymaps.Circle(
            [[zone.lat, zone.lon], zone.radius],
            {
                balloonContent: zone.ingredient
            },
            {
                fillColor: "#00FF0088",
                strokeColor: "#0000FF",
                strokeWidth: 2
            }
        );

        map.geoObjects.add(circle);
        zoneCircles.push(circle);

    });

}

function renderTable() {

    const table = document.getElementById("zones-table");

    table.innerHTML = "";

    zones.forEach(zone => {

        const row = document.createElement("tr");

        row.innerHTML = `
        <td>${zone.ingredient}</td>
        <td>${zone.lat}</td>
        <td>${zone.lon}</td>
        <td>${zone.radius}</td>
        <td>${zone.active ? "Да" : "Нет"}</td>
        `;

        table.appendChild(row);

    });

}

async function loadTelemetry(){

    const response = await fetch(TELEMETRY_API, {
        headers: {
            "Authorization": "Bearer token"
        }
    });

    const data = await response.json();

    updateDeviceMarker(data);

}

function updateDeviceMarker(data){

    const coords = [data.lat, data.lon];

    if(deviceMarker === null){

        deviceMarker = new ymaps.Placemark(coords, {
            balloonContent: "Кормораздатчик"
        });

        map.geoObjects.add(deviceMarker);

    } else {

        deviceMarker.geometry.setCoordinates(coords);

    }

}