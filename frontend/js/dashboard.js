document.addEventListener("DOMContentLoaded", function () {
    loadBatches();
});

async function loadBatches() {

    const table = document.querySelector("#batchesTable tbody");
    table.innerHTML = "";

    try {

        const response = await fetch("http://localhost:3000/api/batches");

        let data = [];

        if (response.ok) {
            data = await response.json();
        }

        if (!data || data.length === 0) {
            // временные данные если API не работает
            data = [
                { id: 1, date: "2026-03-07 10:00", group: "Дойные", weight: 1200 },
                { id: 2, date: "2026-03-07 12:00", group: "Сухостой", weight: 980 }
            ];
        }

        const rows = data.map(batch => `
            <tr>
                <td>${batch.id}</td>
                <td>${batch.date}</td>
                <td>${batch.group}</td>
                <td>${batch.weight}</td>
            </tr>
        `).join("");

        table.innerHTML = rows;

    } catch (error) {
        console.error("Ошибка API:", error);
    }
}
ymaps.ready(initMap);

function initMap() {

    const map = new ymaps.Map("map", {
        center: [54.983123, 82.901234], // координаты центра
        zoom: 20
    });

    const placemark = new ymaps.Placemark([54.983123, 82.901234], {
        balloonContent: "Хозяин тут"
    });

    map.geoObjects.add(placemark);

}