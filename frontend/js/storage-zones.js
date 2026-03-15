const API_URL = "http://localhost:3000/api/storage-zones";

let map;
let zones = [];

ymaps.ready(init);

function init() {

    map = new ymaps.Map("map", {
        center: [55.75, 37.57],
        zoom: 12
    });

    loadZones();

}

async function loadZones() {

    const res = await fetch(API_URL);
    zones = await res.json();

    drawZones();
    renderTable();

}

function drawZones() {

    zones.forEach(zone => {

        const circle = new ymaps.Circle(
            [[zone.lat, zone.lon], zone.radius],
            {},
            {
                fillColor: "#00FF0088",
                strokeColor: "#0000FF",
                strokeWidth: 2
            }
        );

        map.geoObjects.add(circle);

    });

}

function renderTable() {

    const table = document.getElementById("zones-table");

    table.innerHTML = "";

    zones.forEach(z => {

        const row = document.createElement("tr");

        row.innerHTML = `
        <td>${z.ingredient}</td>
        <td>${z.lat}</td>
        <td>${z.lon}</td>
        <td>${z.radius}</td>
        <td>${z.active ? "Да" : "Нет"}</td>
        `;

        table.appendChild(row);

    });

}