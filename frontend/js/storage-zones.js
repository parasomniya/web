const API_HOST = window.AppAuth?.getApiUrl?.("") || "";

const ZONES_API = API_HOST + "/api/telemetry/zones";
const TELEMETRY_API = API_HOST + "/api/telemetry/host/current";
const RTK_TELEMETRY_API = API_HOST + "/api/telemetry/rtk/current";

const CREATE_MODE_TITLE = "Добавление зоны";
const EDIT_MODE_TITLE = "Редактирование зоны";
const CREATE_SUBMIT_LABEL = "Добавить зону";
const EDIT_SUBMIT_LABEL = "Сохранить зону";
const DEFAULT_ZONE_RADIUS = 20;
const DEFAULT_STATUS_MESSAGE = "Готово к работе";
const DEFAULT_MAP_CENTER = [52.428863, 85.706438];
const DEFAULT_MAP_ZOOM = 15;
const DEFAULT_MAP_TYPE = "yandex#map";
const TELEMETRY_FRESHNESS_MS = 15000;

let map;
let deviceMarker = null;
let rtkMarker = null;

let zones = [];
let zoneCircles = [];
let selectedZoneId = null;
let lastTelemetry = null;
let lastRtkTelemetry = null;
let suppressNextMapClick = false;
let mapTypeButtons = [];
let idleCursorAccessor = null;
let dragCursorAccessor = null;
let mapFullscreenButton = null;
let mapWrapElement = null;
let hasTelemetryAutoFocus = false;

ymaps.ready(init);

function canWrite() {
    return window.AppAuth?.hasWriteAccess?.() ?? false;
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

function hasTelemetryTimestamp(value) {
    if (!value) {
        return false;
    }

    const timestamp = new Date(value).getTime();
    return !Number.isNaN(timestamp);
}

function isFreshTelemetry(value) {
    if (!hasTelemetryTimestamp(value)) {
        return false;
    }

    return (Date.now() - new Date(value).getTime()) < TELEMETRY_FRESHNESS_MS;
}

function getSelectedZone() {
    return zones.find((item) => String(item.id) === String(selectedZoneId)) || null;
}

function isCreateMode() {
    return !selectedZoneId;
}

function init() {
    map = new ymaps.Map("map", {
        center: DEFAULT_MAP_CENTER,
        zoom: DEFAULT_MAP_ZOOM,
        type: DEFAULT_MAP_TYPE,
        controls: ["zoomControl"],
    }, {
        geoObjectCursor: "arrow",
        suppressMapOpenBlock: true,
        yandexMapDisablePoiInteractivity: true,
    });

    initMapTypeSwitch();
    initMapActionControls();
    applyIdleMapCursor();
    map.events.add("actionbegin", applyDragMapCursor);
    map.events.add("actionend", handleMapActionEnd);
    map.events.add("actionbreak", handleMapActionEnd);

    bindUI();
    bindMapClick();
    bindOutsideSelectionReset();
    resetZoneEditor();

    loadZones();
    refreshTelemetryLayers();

    setInterval(refreshTelemetryLayers, 5000);
}

function updateMapTypeButtons() {
    if (!mapTypeButtons.length || !map) {
        return;
    }

    const activeType = map.getType();

    mapTypeButtons.forEach((button) => {
        const isActive = button.dataset.mapType === activeType;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
    });
}

function setMapType(mapType) {
    if (!map || !mapType || map.getType() === mapType) {
        return;
    }

    map.setType(mapType);
    updateMapTypeButtons();
}

function initMapTypeSwitch() {
    mapTypeButtons = Array.from(document.querySelectorAll(".map-view-switch__button[data-map-type]"));

    mapTypeButtons.forEach((button) => {
        button.addEventListener("click", () => {
            setMapType(button.dataset.mapType);
        });
    });

    updateMapTypeButtons();
    map.events.add("typechange", updateMapTypeButtons);
}

function removeCursorAccessor(accessor) {
    if (accessor) {
        accessor.remove();
    }

    return null;
}

function applyIdleMapCursor() {
    dragCursorAccessor = removeCursorAccessor(dragCursorAccessor);

    if (!idleCursorAccessor) {
        idleCursorAccessor = map.cursors.push("arrow");
    }
}

function applyDragMapCursor() {
    idleCursorAccessor = removeCursorAccessor(idleCursorAccessor);

    if (!dragCursorAccessor) {
        dragCursorAccessor = map.cursors.push("grabbing");
    }
}

function syncMapActionButtons() {
    if (!mapFullscreenButton) {
        return;
    }

    const isFullscreen = document.fullscreenElement === mapWrapElement;
    const icon = mapFullscreenButton.querySelector("i");
    mapFullscreenButton.classList.toggle("is-active", isFullscreen);
    mapFullscreenButton.setAttribute("aria-pressed", String(isFullscreen));

    if (icon) {
        icon.className = isFullscreen ? "fas fa-compress-arrows-alt" : "fas fa-expand-arrows-alt";
    }
}

async function toggleMapFullscreen() {
    if (!mapWrapElement) {
        return;
    }

    try {
        if (document.fullscreenElement === mapWrapElement) {
            await document.exitFullscreen();
        } else {
            await mapWrapElement.requestFullscreen();
        }
    } catch (error) {
        console.error("Error toggling fullscreen:", error);
    }
}

function handleFullscreenChange() {
    syncMapActionButtons();

    window.setTimeout(() => {
        map?.container.fitToViewport();
    }, 50);
}

function handleMapActionEnd() {
    applyIdleMapCursor();
}

function initMapActionControls() {
    mapWrapElement = document.querySelector(".dashboard-map-wrap");
    mapFullscreenButton = document.getElementById("mapFullscreenButton");

    if (mapFullscreenButton) {
        mapFullscreenButton.addEventListener("click", toggleMapFullscreen);
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    syncMapActionButtons();
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

function bindOutsideSelectionReset() {
    document.addEventListener("click", function (event) {
        if (!selectedZoneId) {
            return;
        }

        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        if (
            target.closest(".map-card") ||
            target.closest(".panel-card") ||
            target.closest(".table-card") ||
            target.closest(".ymaps-2-1-79-map")
        ) {
            return;
        }

        resetZoneEditor();
    });
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

        const coords = event.get("coords");
        setFormCoordinates(coords);

        const selectedZone = getSelectedZone();
        if (selectedZone) {
            setStatus(`Координаты зоны "${getZoneLabel(selectedZone)}" обновлены: ${coords[0].toFixed(6)}, ${coords[1].toFixed(6)}`);
            return;
        }

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

    zones.filter((zone) => Boolean(zone.active)).forEach((zone) => {
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

    const sortedZones = [...zones].sort((left, right) => {
        if (Boolean(left.active) === Boolean(right.active)) {
            return 0;
        }

        return left.active ? -1 : 1;
    });

    const hasActiveZones = sortedZones.some((zone) => Boolean(zone.active));
    const hasInactiveZones = sortedZones.some((zone) => !zone.active);
    let separatorInserted = false;

    sortedZones.forEach((zone) => {
        if (!zone.active && hasActiveZones && hasInactiveZones && !separatorInserted) {
            const separatorRow = document.createElement("tr");
            separatorRow.className = "zones-separator-row";
            separatorRow.innerHTML = `
                <td colspan="5" class="zones-separator-cell">
                    Неактивные зоны
                </td>
            `;
            table.appendChild(separatorRow);
            separatorInserted = true;
        }

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

        row.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            selectZone(zone.id, { focusMap: Boolean(zone.active) });
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

    const ingredientInput = document.getElementById("ingredient");
    const latInput = document.getElementById("lat");
    const lonInput = document.getElementById("lon");
    const radiusInput = document.getElementById("radius");
    const activeInput = document.getElementById("active");

    if (ingredientInput) {
        ingredientInput.value = "";
    }

    if (latInput) {
        latInput.value = "";
    }

    if (lonInput) {
        lonInput.value = "";
    }

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
    setStatus(DEFAULT_STATUS_MESSAGE);
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
        const [hostResponse, rtkResponse] = await Promise.allSettled([
            fetch(TELEMETRY_API, { headers: getHeaders() }),
            fetch(RTK_TELEMETRY_API, { headers: getHeaders() }),
        ]);

        await handleHostTelemetryResponse(hostResponse);
        await handleRtkTelemetryResponse(rtkResponse);
    } catch (error) {
        console.error(error);
        setStatus("Не удалось получить текущую телеметрию");
    }
}

function getVisibleTelemetryCoords() {
    const coords = [];

    if (lastTelemetry && Number.isFinite(Number(lastTelemetry.lat)) && Number.isFinite(Number(lastTelemetry.lon))) {
        coords.push([Number(lastTelemetry.lat), Number(lastTelemetry.lon)]);
    }

    if (lastRtkTelemetry && Number.isFinite(Number(lastRtkTelemetry.lat)) && Number.isFinite(Number(lastRtkTelemetry.lon))) {
        coords.push([Number(lastRtkTelemetry.lat), Number(lastRtkTelemetry.lon)]);
    }

    return coords;
}

function focusMapOnTelemetry(options = {}) {
    if (!map) {
        return false;
    }

    const coordsList = getVisibleTelemetryCoords();
    if (!coordsList.length) {
        return false;
    }

    if (coordsList.length === 1) {
        map.setCenter(coordsList[0], options.zoom ?? 15, {
            checkZoomRange: true,
            duration: options.duration ?? 300,
        });
        return true;
    }

    const lats = coordsList.map((coords) => coords[0]);
    const lons = coordsList.map((coords) => coords[1]);

    map.setBounds(
        [
            [Math.min(...lats), Math.min(...lons)],
            [Math.max(...lats), Math.max(...lons)],
        ],
        {
            checkZoomRange: true,
            zoomMargin: 60,
            duration: options.duration ?? 300,
        }
    );

    return true;
}

async function handleHostTelemetryResponse(result) {
    if (result.status !== "fulfilled") {
        console.error(result.reason);
        updateHostSummary(null);
        return;
    }

    const response = result.value;
    if (!response.ok) {
        const errorText = await response.text();
        console.error(`Ошибка host телеметрии: ${response.status} ${errorText}`);
        updateHostSummary(null);
        return;
    }

    const data = await response.json();
    lastTelemetry = data;
    updateDeviceMarker(data);
    updateHostSummary(data);
}

async function handleRtkTelemetryResponse(result) {
    if (result.status !== "fulfilled") {
        console.error(result.reason);
        updateRtkSummary(null);
        return;
    }

    const response = result.value;
    if (response.status === 404) {
        updateRtkSummary(null);
        return;
    }

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`Ошибка RTK телеметрии: ${response.status} ${errorText}`);
        updateRtkSummary(null);
        return;
    }

    const data = await response.json();
    lastRtkTelemetry = data;
    updateRtkMarker(data);
    updateRtkSummary(data);
}

async function refreshTelemetryLayers() {
    try {
        await loadTelemetry();
    } catch (error) {
        console.error(error);
        setStatus("Не удалось получить текущие точки");
    }
}

function updateDeviceMarker(data) {
    if (!data || data.lat == null || data.lon == null) {
        if (deviceMarker) {
            map.geoObjects.remove(deviceMarker);
            deviceMarker = null;
        }
        return;
    }

    const coords = [Number(data.lat), Number(data.lon)];

    if (deviceMarker === null) {
        deviceMarker = new ymaps.Placemark(
            coords,
            {
                balloonContent: `
                    <strong>Host</strong><br>
                    Режим: ${escapeHtml(data.mode || "Ожидание")}<br>
                    Координаты: ${coords[0].toFixed(6)}, ${coords[1].toFixed(6)}<br>
                    Пакет: ${isFreshTelemetry(data.timestamp) ? "свежий" : "устаревший"}
                `,
                hintContent: `Host • ${isFreshTelemetry(data.timestamp) ? "свежий пакет" : "нет свежих пакетов"}`,
            },
            {
                preset: isFreshTelemetry(data.timestamp) ? "islands#redIcon" : "islands#grayIcon",
            }
        );

        map.geoObjects.add(deviceMarker);
    } else {
        deviceMarker.geometry.setCoordinates(coords);
        deviceMarker.properties.set({
            balloonContent: `
                <strong>Host</strong><br>
                Режим: ${escapeHtml(data.mode || "Ожидание")}<br>
                Координаты: ${coords[0].toFixed(6)}, ${coords[1].toFixed(6)}<br>
                Пакет: ${isFreshTelemetry(data.timestamp) ? "свежий" : "устаревший"}
            `,
            hintContent: `Host • ${isFreshTelemetry(data.timestamp) ? "свежий пакет" : "нет свежих пакетов"}`,
        });
        deviceMarker.options.set("preset", isFreshTelemetry(data.timestamp) ? "islands#redIcon" : "islands#grayIcon");
    }

    if (!hasTelemetryAutoFocus) {
        focusMapOnTelemetry({ duration: 300 });
        hasTelemetryAutoFocus = true;
    }
}

function getRtkQualityLabel(data) {
    if (!data) {
        return "--";
    }

    return data.qualityLabel || data.rtkQuality || (data.quality != null ? `Q${data.quality}` : "--");
}

function getRtkMarkerPreset(data) {
    if (!isFreshTelemetry(data?.timestamp)) {
        return "islands#grayCircleDotIcon";
    }

    const label = String(data?.qualityLabel || data?.rtkQuality || "").toLowerCase();
    const quality = Number(data?.quality);

    if (label.includes("fixed") || quality >= 4) {
        return "islands#greenCircleDotIcon";
    }

    if (label.includes("float") || quality >= 2) {
        return "islands#yellowCircleDotIcon";
    }

    return "islands#grayCircleDotIcon";
}

function updateRtkMarker(data) {
    if (!data || data.lat == null || data.lon == null) {
        if (rtkMarker) {
            map.geoObjects.remove(rtkMarker);
            rtkMarker = null;
        }
        return;
    }

    const coords = [Number(data.lat), Number(data.lon)];
    const qualityLabel = getRtkQualityLabel(data);
    const zoneName = data?.zone?.name || "Вне зоны";
    const packetState = isFreshTelemetry(data?.timestamp) ? "свежий" : "устаревший";
    const balloonContent = `
        <strong>RTK</strong><br>
        Устройство: ${escapeHtml(data.deviceId || "--")}<br>
        Пакет: ${packetState}<br>
        Quality: ${escapeHtml(qualityLabel)}<br>
        Координаты: ${coords[0].toFixed(6)}, ${coords[1].toFixed(6)}<br>
        Зона: ${escapeHtml(zoneName)}
    `;

    if (rtkMarker === null) {
        rtkMarker = new ymaps.Placemark(
            coords,
            {
                balloonContent,
                hintContent: `RTK • ${qualityLabel} • ${packetState}`,
            },
            {
                preset: getRtkMarkerPreset(data),
            }
        );

        map.geoObjects.add(rtkMarker);
    } else {
        rtkMarker.geometry.setCoordinates(coords);
        rtkMarker.properties.set({
            balloonContent,
            hintContent: `RTK • ${qualityLabel} • ${packetState}`,
        });
        rtkMarker.options.set("preset", getRtkMarkerPreset(data));
    }

    if (!hasTelemetryAutoFocus) {
        focusMapOnTelemetry({ duration: 300 });
        hasTelemetryAutoFocus = true;
    }
}

function updateHostSummary(data) {
    const statusElement = document.getElementById("hostMapStatus");
    const metaElement = document.getElementById("hostMapMeta");

    if (!statusElement || !metaElement) {
        return;
    }

    if (!data || data.lat == null || data.lon == null) {
        statusElement.textContent = "Нет данных";
        metaElement.textContent = "Координаты: --";
        return;
    }

    const isFresh = isFreshTelemetry(data.timestamp);
    statusElement.textContent = isFresh ? "Онлайн" : "Нет свежих пакетов";
    metaElement.textContent = `${data.mode || "Ожидание"} • ${Number(data.lat).toFixed(6)}, ${Number(data.lon).toFixed(6)}`;
}

function updateRtkSummary(data) {
    const statusElement = document.getElementById("rtkMapStatus");
    const metaElement = document.getElementById("rtkMapMeta");
    const qualityElement = document.getElementById("rtkMapQuality");
    const deviceElement = document.getElementById("rtkMapDevice");
    const zoneElement = document.getElementById("rtkMapZone");
    const updatedElement = document.getElementById("rtkMapUpdated");

    if (!statusElement || !metaElement || !qualityElement || !deviceElement || !zoneElement || !updatedElement) {
        return;
    }

    if (!data || data.lat == null || data.lon == null) {
        statusElement.textContent = "Нет данных";
        metaElement.textContent = "Координаты: --";
        qualityElement.textContent = "--";
        deviceElement.textContent = "Устройство: --";
        zoneElement.textContent = "--";
        updatedElement.textContent = "Последний пакет: --";
        return;
    }

    const isFresh = isFreshTelemetry(data.timestamp);
    statusElement.textContent = !isFresh ? "Нет свежих пакетов" : (data.valid === false ? "Невалидный пакет" : "Онлайн");
    metaElement.textContent = `Координаты: ${Number(data.lat).toFixed(6)}, ${Number(data.lon).toFixed(6)}`;
    qualityElement.textContent = getRtkQualityLabel(data);
    deviceElement.textContent = `Устройство: ${data.deviceId || "--"}`;
    zoneElement.textContent = data?.zone?.name || "Вне зоны";
    updatedElement.textContent = `Последний пакет: ${formatDateTime(data.timestamp)}`;
}

function formatDateTime(value) {
    if (!value) {
        return "--";
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "--" : date.toLocaleString("ru-RU");
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
