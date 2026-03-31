const API_HOST = "";

const ZONES_API = API_HOST + "/api/telemetry/zones";
const TELEMETRY_API = API_HOST + "/api/telemetry/host/current";

const CREATE_MODE_TITLE = "Добавление зоны";
const EDIT_MODE_TITLE = "Редактирование зоны";
const CREATE_SUBMIT_LABEL = "Добавить зону";
const EDIT_SUBMIT_LABEL = "Сохранить зону";
const DEFAULT_ZONE_RADIUS = 20;

let map;
let deviceMarker = null;

let zones = [];
let zoneCircles = [];
let selectedZoneId = null;
let lastTelemetry = null;
let suppressNextMapClick = false;

ymaps.ready(init);

function canWrite() {
    return window.AppAuth?.hasWriteAccess?.() ?? true;
}

function getHeaders(includeJson = false) {
    return window.AppAuth?.getAuthHeaders?.({ includeJson }) || {};
}

function normalizeZoneText(value) {
    if (value === null || value === undefined) {
        return "";
    }

    return String(value).trim();
}

function looksBrokenZoneText(value) {
    if (!value) {
        return true;
    }

    return /^[?]+$/.test(value) || /^[\uFFFD]+$/u.test(value);
}

function getZoneLabel(zone) {
    const ingredient = normalizeZoneText(zone?.ingredient);
    const name = normalizeZoneText(zone?.name);

    if (ingredient && !looksBrokenZoneText(ingredient)) {
        return ingredient;
    }

    if (name && !looksBrokenZoneText(name)) {
        return name;
    }

    return ingredient || name || "Без названия";
}

function getSelectedZone() {
    return zones.find((item) => String(item.id) === String(selectedZoneId)) || null;
}

function isCreateMode() {
    return !selectedZoneId;
}

function init() {
    map = new ymaps.Map("map", {
        center: [55.75, 37.57],
        zoom: 12,
    });

    bindUI();
    bindMapClick();
    resetZoneEditor();

    loadZones();
    loadTelemetry();

    setInterval(loadTelemetry, 5000);
}

function bindUI() {
    const zoneForm = document.getElementById("zone-form");
    const deleteZoneBtn = document.getElementById("delete-zone-btn");
    const goToDeviceBtn = document.getElementById("go-to-device-btn");

    if (zoneForm) {
        zoneForm.addEventListener("submit", onZoneFormSubmit);
    }

    if (deleteZoneBtn) {
        deleteZoneBtn.addEventListener("click", onDeleteZoneClick);
    }

    if (goToDeviceBtn) {
        goToDeviceBtn.addEventListener("click", goToCurrentPoint);
    }
}

function bindMapClick() {
    map.events.add("click", function (event) {
        if (suppressNextMapClick) {
            suppressNextMapClick = false;
            return;
        }

        if (!canWrite()) {
            return;
        }

        if (!isCreateMode()) {
            resetZoneEditor();
        }

        const coords = event.get("coords");
        setFormCoordinates(coords);

        setStatus(`Координаты выбраны: ${coords[0].toFixed(6)}, ${coords[1].toFixed(6)}`);
    });
}

function setFormCoordinates(coords) {
    const latInput = document.getElementById("lat");
    const lonInput = document.getElementById("lon");

    if (!latInput || !lonInput) {
        return;
    }

    latInput.value = Number(coords[0]).toFixed(6);
    lonInput.value = Number(coords[1]).toFixed(6);
}

async function loadZones() {
    try {
        const response = await fetch(ZONES_API, {
            headers: getHeaders(),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Ошибка загрузки зон: ${response.status} ${errorText}`);
        }

        zones = await response.json();
        syncSelectedZoneAfterReload();
    } catch (error) {
        console.error(error);
        setStatus("Не удалось загрузить зоны");
    }
}

function syncSelectedZoneAfterReload() {
    const zone = getSelectedZone();

    if (!zone) {
        selectedZoneId = null;
        refreshSelectionUI();
        return;
    }

    refreshSelectionUI();
    if (canWrite()) {
        fillZoneForm(zone);
    }
}

function refreshSelectionUI() {
    drawZones();
    renderTable();
    updateFormMode();
}

function drawZones() {
    zoneCircles.forEach((circle) => map.geoObjects.remove(circle));
    zoneCircles = [];

    zones.forEach((zone) => {
        const isSelected = String(zone.id) === String(selectedZoneId);

        const circle = new ymaps.Circle(
            [[Number(zone.lat), Number(zone.lon)], Number(zone.radius)],
            {
                balloonContent: `
                    <strong>${escapeHtml(getZoneLabel(zone))}</strong><br>
                    Lat: ${zone.lat}<br>
                    Lon: ${zone.lon}<br>
                    Радиус: ${zone.radius} м
                `,
            },
            {
                fillColor: isSelected ? "#f6c23e55" : "#00c85355",
                strokeColor: isSelected ? "#d18b00" : "#1e88e5",
                strokeWidth: isSelected ? 4 : 2,
            }
        );

        circle.events.add("click", function () {
            suppressNextMapClick = true;
            selectZone(zone.id, { focusMap: false });
        });

        map.geoObjects.add(circle);
        zoneCircles.push(circle);
    });
}

function renderTable() {
    const table = document.getElementById("zones-table");
    if (!table) {
        return;
    }

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

    zones.forEach((zone) => {
        const row = document.createElement("tr");
        row.className = "zone-row";
        row.dataset.zoneId = zone.id;

        if (String(zone.id) === String(selectedZoneId)) {
            row.classList.add("selected");
        }

        row.innerHTML = `
            <td>${escapeHtml(getZoneLabel(zone))}</td>
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
            selectZone(zone.id, { focusMap: true });
        });

        table.appendChild(row);
    });
}

function selectZone(zoneId, options = {}) {
    selectedZoneId = zoneId;

    const zone = getSelectedZone();
    if (!zone) {
        resetZoneEditor();
        return;
    }

    if (canWrite()) {
        fillZoneForm(zone);
    }

    refreshSelectionUI();

    if (options.focusMap) {
        focusZone(zone);
    }

    setStatus(`Выбрана зона "${getZoneLabel(zone)}"`);
}

function updateFormMode() {
    const title = document.getElementById("zone-form-title");
    const submitButton = document.getElementById("submit-zone-btn");
    const deleteButton = document.getElementById("delete-zone-btn");
    const goToDeviceButton = document.getElementById("go-to-device-btn");

    const createMode = isCreateMode();

    if (title) {
        title.textContent = createMode ? CREATE_MODE_TITLE : EDIT_MODE_TITLE;
    }

    if (submitButton) {
        submitButton.textContent = createMode ? CREATE_SUBMIT_LABEL : EDIT_SUBMIT_LABEL;
        submitButton.classList.toggle("btn-success", createMode);
        submitButton.classList.toggle("btn-primary", !createMode);
    }

    if (deleteButton) {
        deleteButton.disabled = !canWrite() || createMode;
    }

    if (goToDeviceButton) {
        goToDeviceButton.disabled = !canWrite();
    }
}

function fillZoneForm(zone) {
    const ingredientInput = document.getElementById("ingredient");
    const latInput = document.getElementById("lat");
    const lonInput = document.getElementById("lon");
    const radiusInput = document.getElementById("radius");
    const activeInput = document.getElementById("active");

    if (ingredientInput) ingredientInput.value = getZoneLabel(zone);
    if (latInput) latInput.value = Number(zone.lat).toFixed(6);
    if (lonInput) lonInput.value = Number(zone.lon).toFixed(6);
    if (radiusInput) radiusInput.value = zone.radius;
    if (activeInput) activeInput.value = String(Boolean(zone.active));
}

function resetZoneFormFields() {
    const zoneForm = document.getElementById("zone-form");
    if (zoneForm) {
        zoneForm.reset();
    }

    const radiusInput = document.getElementById("radius");
    const activeInput = document.getElementById("active");

    if (radiusInput) {
        radiusInput.value = String(DEFAULT_ZONE_RADIUS);
    }

    if (activeInput) {
        activeInput.value = "true";
    }
}

function resetZoneEditor() {
    selectedZoneId = null;

    if (canWrite()) {
        resetZoneFormFields();
    }

    refreshSelectionUI();
}

function focusZone(zone) {
    if (!zone) {
        return;
    }

    map.setCenter([Number(zone.lat), Number(zone.lon)], 15, {
        checkZoomRange: true,
        duration: 300,
    });
}

function readZoneFormValues() {
    const radiusValue = document.getElementById("radius")?.value.trim() || "";

    return {
        ingredient: document.getElementById("ingredient")?.value.trim() || "",
        lat: Number(document.getElementById("lat")?.value),
        lon: Number(document.getElementById("lon")?.value),
        radius: radiusValue ? Number(radiusValue) : DEFAULT_ZONE_RADIUS,
        active: document.getElementById("active")?.value === "true",
    };
}

function validateZoneForm(zoneData) {
    return Boolean(
        zoneData.ingredient &&
        !Number.isNaN(zoneData.lat) &&
        !Number.isNaN(zoneData.lon) &&
        !Number.isNaN(zoneData.radius) &&
        zoneData.radius > 0
    );
}

async function onZoneFormSubmit(event) {
    event.preventDefault();

    if (!canWrite()) {
        setStatus("Режим просмотра: изменение зон недоступно");
        return;
    }

    const zoneData = readZoneFormValues();
    if (!validateZoneForm(zoneData)) {
        setStatus("Заполните все поля корректно");
        return;
    }

    const submitButton = document.getElementById("submit-zone-btn");
    if (submitButton) {
        submitButton.disabled = true;
    }

    try {
        if (selectedZoneId) {
            await updateZone(zoneData);
        } else {
            await createZone(zoneData);
        }
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
        }
    }
}

async function createZone(zoneData) {
    try {
        const response = await fetch(ZONES_API, {
            method: "POST",
            headers: getHeaders(true),
            body: JSON.stringify({
                name: zoneData.ingredient,
                ingredient: zoneData.ingredient,
                lat: zoneData.lat,
                lon: zoneData.lon,
                radius: zoneData.radius,
                active: zoneData.active,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Ошибка создания зоны: ${response.status} ${errorText}`);
        }

        setStatus(`Зона "${zoneData.ingredient}" добавлена`);
        resetZoneEditor();
        await loadZones();

        const createdZone = findBestMatchingZone(zoneData);
        if (createdZone) {
            focusZone(createdZone);
        }
    } catch (error) {
        console.error(error);
        setStatus("Не удалось добавить зону");
    }
}

async function updateZone(zoneData) {
    const currentZoneId = selectedZoneId;

    try {
        const response = await fetch(`${ZONES_API}/${currentZoneId}`, {
            method: "PUT",
            headers: getHeaders(true),
            body: JSON.stringify({
                name: zoneData.ingredient,
                ingredient: zoneData.ingredient,
                lat: zoneData.lat,
                lon: zoneData.lon,
                radius: zoneData.radius,
                active: zoneData.active,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Ошибка обновления зоны: ${response.status} ${errorText}`);
        }

        setStatus(`Зона "${zoneData.ingredient}" сохранена`);
        resetZoneEditor();
        await loadZones();
    } catch (error) {
        console.error(error);
        selectedZoneId = currentZoneId;
        refreshSelectionUI();
        setStatus("Не удалось сохранить изменения зоны");
    }
}

async function onDeleteZoneClick() {
    if (!canWrite()) {
        setStatus("Режим просмотра: удаление зон недоступно");
        return;
    }

    const zone = getSelectedZone();
    if (!zone) {
        setStatus("Сначала выберите зону");
        return;
    }

    const deleteZoneBtn = document.getElementById("delete-zone-btn");
    if (deleteZoneBtn) {
        deleteZoneBtn.disabled = true;
    }

    try {
        const response = await fetch(`${ZONES_API}/${zone.id}`, {
            method: "DELETE",
            headers: getHeaders(),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Ошибка удаления зоны: ${response.status} ${errorText}`);
        }

        setStatus(`Зона "${getZoneLabel(zone)}" удалена`);
        resetZoneEditor();
        await loadZones();
    } catch (error) {
        console.error(error);
        refreshSelectionUI();
        setStatus("Не удалось удалить зону");
    }
}

async function loadTelemetry() {
    try {
        const response = await fetch(TELEMETRY_API, {
            headers: getHeaders(),
        });

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
                balloonContent: "Текущая точка кормораздатчика",
            },
            {
                preset: "islands#redIcon",
            }
        );

        map.geoObjects.add(deviceMarker);
    } else {
        deviceMarker.geometry.setCoordinates(coords);
    }
}

function goToCurrentPoint() {
    if (!canWrite()) {
        setStatus("Режим просмотра: изменение зон недоступно");
        return;
    }

    if (!isCreateMode()) {
        setStatus("К текущей точке можно перейти только при создании новой зоны");
        return;
    }

    if (!lastTelemetry || lastTelemetry.lat == null || lastTelemetry.lon == null) {
        setStatus("Текущая точка пока недоступна");
        return;
    }

    const lat = Number(lastTelemetry.lat);
    const lon = Number(lastTelemetry.lon);

    setFormCoordinates([lat, lon]);

    map.setCenter([lat, lon], 16, {
        checkZoomRange: true,
        duration: 300,
    });

    setStatus("Координаты текущей точки подставлены в форму новой зоны");
}

function findBestMatchingZone(newZone) {
    return zones.find((zone) =>
        getZoneLabel(zone) === newZone.ingredient &&
        Number(zone.lat) === Number(newZone.lat) &&
        Number(zone.lon) === Number(newZone.lon) &&
        Number(zone.radius) === Number(newZone.radius)
    );
}

function setStatus(message) {
    const statusBox = document.getElementById("status-box");
    if (statusBox) {
        statusBox.textContent = message;
    }
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
