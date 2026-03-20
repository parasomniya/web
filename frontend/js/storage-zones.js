const API_HOST = "https://hostnamesrostkiserver.tail0cd01d.ts.net";

const ZONES_API = API_HOST + "/api/telemetry/zones";
const TELEMETRY_API = API_HOST + "/api/telemetry/host/latest";

let map;
let deviceMarker = null;

let zones = [];
let zoneCircles = [];
let selectedZoneId = null;
let lastTelemetry = null;

ymaps.ready(init);

function init() {
    map = new ymaps.Map("map", {
        center: [55.75, 37.57],
        zoom: 12
    });

    bindUI();
    bindMapClick();

    loadZones();
    loadTelemetry();

    setInterval(loadTelemetry, 5000);
}

function bindUI() {
    const addZoneForm = document.getElementById("add-zone-form");
    const deleteZoneBtn = document.getElementById("delete-zone-btn");
    const goToDeviceBtn = document.getElementById("go-to-device-btn");

    addZoneForm.addEventListener("submit", onAddZoneSubmit);
    deleteZoneBtn.addEventListener("click", onDeleteZoneClick);
    goToDeviceBtn.addEventListener("click", goToCurrentPoint);
}

function bindMapClick() {
    map.events.add("click", function (e) {
        const coords = e.get("coords");
        const latInput = document.getElementById("lat");
        const lonInput = document.getElementById("lon");

        latInput.value = coords[0].toFixed(6);
        lonInput.value = coords[1].toFixed(6);

        setStatus(`Координаты выбраны: ${coords[0].toFixed(6)}, ${coords[1].toFixed(6)}`);
    });
}

async function loadZones() {
    try {
        const response = await fetch(ZONES_API);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Ошибка загрузки зон: ${response.status} ${errorText}`);
        }

        zones = await response.json();

        drawZones();
        renderTable();
        restoreSelectionAfterReload();
    } catch (error) {
        console.error(error);
        setStatus("Не удалось загрузить зоны");
    }
}

function drawZones() {
    zoneCircles.forEach(circle => map.geoObjects.remove(circle));
    zoneCircles = [];

    zones.forEach(zone => {
        const isSelected = String(zone.id) === String(selectedZoneId);

        const circle = new ymaps.Circle(
            [[Number(zone.lat), Number(zone.lon)], Number(zone.radius)],
            {
                balloonContent: `
                    <strong>${escapeHtml(zone.ingredient)}</strong><br>
                    Lat: ${zone.lat}<br>
                    Lon: ${zone.lon}<br>
                    Радиус: ${zone.radius} м
                `
            },
            {
                fillColor: isSelected ? "#4e73df55" : "#00c85355",
                strokeColor: isSelected ? "#1c3faa" : "#1e88e5",
                strokeWidth: isSelected ? 4 : 2
            }
        );

        circle.events.add("click", function () {
            selectZone(zone.id);
        });

        map.geoObjects.add(circle);
        zoneCircles.push(circle);
    });
}

function renderTable() {
    const table = document.getElementById("zones-table");
    table.innerHTML = "";

    if (!zones.length) {
        table.innerHTML = `
            <tr>
                <td colspan="5" class="text-center text-muted">
                    Зоны пока не добавлены
                </td>
            </tr>
        `;
        return;
    }

    zones.forEach(zone => {
        const row = document.createElement("tr");
        row.className = "zone-row";
        row.dataset.zoneId = zone.id;

        if (String(zone.id) === String(selectedZoneId)) {
            row.classList.add("selected");
        }

        row.innerHTML = `
            <td>${escapeHtml(zone.ingredient)}</td>
            <td>${Number(zone.lat).toFixed(6)}</td>
            <td>${Number(zone.lon).toFixed(6)}</td>
            <td>${zone.radius}</td>
            <td>
                <span class="badge-soft ${zone.active ? "active" : "inactive"}">
                    ${zone.active ? "Да" : "Нет"}
                </span>
            </td>
        `;

        row.addEventListener("click", function () {
            selectZone(zone.id);
            focusZone(zone);
        });

        table.appendChild(row);
    });
}

function selectZone(zoneId) {
    selectedZoneId = zoneId;

    const zone = zones.find(item => String(item.id) === String(zoneId));

    drawZones();
    renderTable();
    updateSelectedZoneBox(zone);
    updateDeleteButtonState();
}

function updateSelectedZoneBox(zone) {
    const box = document.getElementById("selected-zone-box");

    if (!zone) {
        box.innerHTML = `Выбранная зона: <strong>не выбрана</strong>`;
        return;
    }

    box.innerHTML = `
        Выбранная зона: <strong>${escapeHtml(zone.ingredient)}</strong><br>
        Lat: ${Number(zone.lat).toFixed(6)}<br>
        Lon: ${Number(zone.lon).toFixed(6)}<br>
        Радиус: ${zone.radius} м
    `;
}

function updateDeleteButtonState() {
    const deleteZoneBtn = document.getElementById("delete-zone-btn");
    deleteZoneBtn.disabled = !selectedZoneId;
}

function focusZone(zone) {
    if (!zone) return;

    map.setCenter([Number(zone.lat), Number(zone.lon)], 15, {
        checkZoomRange: true,
        duration: 300
    });
}

async function onAddZoneSubmit(event) {
    event.preventDefault();

    const ingredient = document.getElementById("ingredient").value.trim();
    const lat = Number(document.getElementById("lat").value);
    const lon = Number(document.getElementById("lon").value);
    const radius = Number(document.getElementById("radius").value);

    if (!ingredient || Number.isNaN(lat) || Number.isNaN(lon) || Number.isNaN(radius)) {
        setStatus("Заполните все поля корректно");
        return;
    }

    try {
        const response = await fetch(ZONES_API, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                name: ingredient,
                ingredient: ingredient,
                lat: lat,
                lon: lon,
                radius: radius
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Ошибка создания зоны: ${response.status} ${errorText}`);
        }

        setStatus(`Зона "${ingredient}" добавлена`);
        document.getElementById("add-zone-form").reset();

        await loadZones();

        const createdZone = findBestMatchingZone({ ingredient, lat, lon, radius });
        if (createdZone) {
            selectZone(createdZone.id);
            focusZone(createdZone);
        }
    } catch (error) {
        console.error(error);
        setStatus("Не удалось добавить точку");
    }
}

async function onDeleteZoneClick() {
    if (!selectedZoneId) {
        setStatus("Сначала выберите зону");
        return;
    }

    const zone = zones.find(item => String(item.id) === String(selectedZoneId));
    const zoneName = zone ? zone.ingredient : "выбранную зону";

    const isConfirmed = window.confirm(`Удалить зону "${zoneName}"?`);
    if (!isConfirmed) {
        return;
    }

    try {
        const response = await fetch(`${ZONES_API}/${selectedZoneId}`, {
            method: "DELETE"
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Ошибка удаления зоны: ${response.status} ${errorText}`);
        }

        setStatus(`Зона "${zoneName}" удалена`);
        selectedZoneId = null;
        updateSelectedZoneBox(null);
        updateDeleteButtonState();

        await loadZones();
    } catch (error) {
        console.error(error);
        setStatus("Не удалось удалить зону");
    }
}

async function loadTelemetry() {
    try {
        const response = await fetch(TELEMETRY_API);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Ошибка телеметрии: ${response.status} ${errorText}`);
        }

        const data = await response.json();
        lastTelemetry = data;
        updateDeviceMarker(data);
    } catch (error) {
        console.error(error);
        setStatus("Не удалось получить текущую точку");
    }
}

function updateDeviceMarker(data) {
    if (!data || data.lat == null || data.lon == null) {
        return;
    }

    const coords = [Number(data.lat), Number(data.lon)];

    if (deviceMarker === null) {
        deviceMarker = new ymaps.Placemark(
            coords,
            {
                balloonContent: "Текущая точка кормораздатчика"
            },
            {
                preset: "islands#redIcon"
            }
        );

        map.geoObjects.add(deviceMarker);
    } else {
        deviceMarker.geometry.setCoordinates(coords);
    }
}

function goToCurrentPoint() {
    if (!lastTelemetry || lastTelemetry.lat == null || lastTelemetry.lon == null) {
        setStatus("Текущая точка пока недоступна");
        return;
    }

    map.setCenter([Number(lastTelemetry.lat), Number(lastTelemetry.lon)], 16, {
        checkZoomRange: true,
        duration: 300
    });

    setStatus("Карта перемещена к текущей точке");
}

function restoreSelectionAfterReload() {
    if (!selectedZoneId) {
        updateSelectedZoneBox(null);
        updateDeleteButtonState();
        return;
    }

    const zone = zones.find(item => String(item.id) === String(selectedZoneId));

    if (!zone) {
        selectedZoneId = null;
        updateSelectedZoneBox(null);
        updateDeleteButtonState();
        drawZones();
        renderTable();
        return;
    }

    updateSelectedZoneBox(zone);
    updateDeleteButtonState();
    drawZones();
    renderTable();
}

function findBestMatchingZone(newZone) {
    return zones.find(zone =>
        zone.ingredient === newZone.ingredient &&
        Number(zone.lat) === Number(newZone.lat) &&
        Number(zone.lon) === Number(newZone.lon) &&
        Number(zone.radius) === Number(newZone.radius)
    );
}

function setStatus(message) {
    const statusBox = document.getElementById("status-box");
    statusBox.textContent = message;
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}