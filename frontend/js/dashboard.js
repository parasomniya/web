const API_BASE = window.AppAuth?.getApiUrl?.("/api/telemetry/host") || "/api/telemetry/host";
const RTK_API_BASE = window.AppAuth?.getApiUrl?.("/api/telemetry/rtk") || "/api/telemetry/rtk";
const ZONES_API = window.AppAuth?.getApiUrl?.("/api/telemetry/zones") || "/api/telemetry/zones";
const CLEAR_HISTORY_API = `${API_BASE}/admin/truncate`;
const HISTORY_LIMIT = 100000;
const TEST_SECRET = "kill_all_telemetry_123";
const DEFAULT_COORDS = [54.84, 83.09];
const LATEST_POLL_INTERVAL_MS = 1000;
const ZONES_POLL_INTERVAL_MS = 10000;
const OFFLINE_THRESHOLD_MS = 15000;
const DEFAULT_MAP_TYPE = "yandex#map";
const ZONE_BANNER_DISPLAY_MS = 4500;

let map;
let placemark;
let rtkPlacemark = null;
let routePolyline = null;
let rtkRoutePolyline = null;
let latestTelemetry = null;
let latestRtkTelemetry = null;
let storageZones = [];
let zoneCircles = [];
let hasLiveCoordinates = false;
let isPlacemarkVisible = false;
let isRtkPlacemarkVisible = false;
let isFetchingZones = false;
let mapTypeButtons = [];
let idleCursorAccessor = null;
let dragCursorAccessor = null;
let lastShownZone = null;
let currentBannerElement = null;
let currentBannerType = null;
let bannerDismissTimerId = null;
let pendingTelemetryUndo = null;
let currentUndoAlert = null;
let undoAlertTimerId = null;
let lastTelemetryChangeAt = 0;
let lastTelemetrySnapshotKey = null;
let isMarkerTrackingEnabled = false;
let mapTrackToggleButton = null;
let mapCenterOnMarkerButton = null;
let mapFullscreenButton = null;
let mapWrapElement = null;
let hasTelemetryAutoFocus = false;

function isAdmin() {
    return Boolean(window.AppAuth?.isAdmin && window.AppAuth.isAdmin());
}

function hasWriteAccess() {
    return Boolean(window.AppAuth?.hasWriteAccess && window.AppAuth.hasWriteAccess());
}

function isEmptyTelemetry(data) {
    return !data || (
        data.id == null &&
        data.timestamp == null &&
        data.lat == null &&
        data.lon == null
    );
}

function getLatestApiUrl() {
    return `${API_BASE}/current`;
}

function getRtkLatestApiUrl() {
    return `${RTK_API_BASE}/current`;
}

function getHistoryApiUrl() {
    return isAdmin()
        ? `${API_BASE}/admin/history?limit=${HISTORY_LIMIT}`
        : `${API_BASE}/recent?limit=${HISTORY_LIMIT}`;
}

function getRtkHistoryApiUrl() {
    return isAdmin()
        ? `${RTK_API_BASE}/admin/history?limit=${HISTORY_LIMIT}`
        : `${RTK_API_BASE}/history?limit=${HISTORY_LIMIT}`;
}

function getHeaders() {
    return window.AppAuth?.getAuthHeaders?.({ includeJson: true }) || {
        "Content-Type": "application/json",
    };
}

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = value;
    }
}

function formatDateTime(value) {
    if (!value) return "--";

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "--" : date.toLocaleString("ru-RU");
}

function formatMetric(value, digits = 1) {
    if (value === null || value === undefined || value === "") return "--";

    const number = Number(value);
    return Number.isNaN(number) ? "--" : number.toFixed(digits);
}

function parseNumber(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }

    const parsed = Number.parseFloat(String(value).replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
}

function formatSignedPercent(value, digits = 1) {
    const number = parseNumber(value);
    if (number === null) return "--";

    const sign = number > 0 ? "+" : "";
    return `${sign}${number.toFixed(digits)}%`;
}

function formatSignedMetric(value, unit = "", digits = 1) {
    const number = parseNumber(value);
    if (number === null) return "--";

    const sign = number > 0 ? "+" : "";
    const suffix = unit ? ` ${unit}` : "";
    return `${sign}${number.toFixed(digits)}${suffix}`;
}

function asBoolean(value) {
    if (typeof value === "boolean") {
        return value;
    }

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "да";
    }

    return Boolean(value);
}

function setSectionVisible(id, isVisible) {
    const element = document.getElementById(id);
    if (!element) {
        return;
    }

    element.classList.toggle("d-none", !isVisible);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

const latestFetchState = {
    hasLoadedAtLeastOnce: false,
    status: "loading",
    errorMessage: "",
};

function setCurrentStateNotice(tone, message) {
    const element = document.getElementById("dashboardCurrentStateNotice");
    if (!element) {
        return;
    }

    if (!tone || !message) {
        element.textContent = "";
        element.className = "dashboard-inline-state d-none";
        return;
    }

    element.textContent = message;
    element.className = `dashboard-inline-state dashboard-inline-state--${tone}`;
}

function updateCurrentStateNotice(data) {
    if (latestFetchState.status === "loading" && !latestFetchState.hasLoadedAtLeastOnce) {
        setCurrentStateNotice("info", "Загрузка текущего состояния...");
        return;
    }

    if (latestFetchState.status === "error") {
        setCurrentStateNotice(
            "danger",
            latestFetchState.errorMessage || "Не удалось загрузить текущее состояние."
        );
        return;
    }

    if (latestFetchState.status === "stale" && !isEmptyTelemetry(data)) {
        const packetTime = formatDateTime(data?.timestamp);
        const packetInfo = packetTime !== "--" ? ` Последний пакет: ${packetTime}.` : "";
        setCurrentStateNotice(
            "warning",
            `Данные временно не обновляются. Показано последнее доступное состояние.${packetInfo}`
        );
        return;
    }

    if (isEmptyTelemetry(data)) {
        setCurrentStateNotice("info", "Телеметрия ещё не поступила.");
        return;
    }

    setCurrentStateNotice("", "");
}

function getModeLabel(mode) {
    return (typeof mode === "string" && mode.trim()) ? mode.trim() : "Ожидание";
}

function normalizeModeKey(mode) {
    const normalized = getModeLabel(mode).toLowerCase();

    if (normalized.includes("выгруз") || normalized.includes("unload")) {
        return "unloading";
    }

    if (
        normalized.includes("загруз") ||
        normalized.includes("смеш") ||
        normalized.includes("микс") ||
        normalized.includes("load") ||
        normalized.includes("mix")
    ) {
        return "loading";
    }

    if (
        normalized.includes("ожид") ||
        normalized.includes("простой") ||
        normalized.includes("пауза") ||
        normalized.includes("idle") ||
        normalized.includes("wait")
    ) {
        return "idle";
    }

    return "unknown";
}

function renderModeBadge(mode) {
    const element = document.getElementById("dashboardCurrentMode");
    if (!element) {
        return;
    }

    const modeKey = normalizeModeKey(mode);
    element.textContent = getModeLabel(mode);
    element.classList.remove(
        "dashboard-mode-badge--idle",
        "dashboard-mode-badge--loading",
        "dashboard-mode-badge--unloading",
        "dashboard-mode-badge--unknown",
        "is-stale"
    );
    element.classList.add("dashboard-mode-badge", `dashboard-mode-badge--${modeKey}`);
    element.classList.toggle("is-stale", latestFetchState.status === "stale");
}

function isUnloadMode(mode) {
    return normalizeModeKey(mode) === "unloading";
}

function renderUnloadProgress(mode, unloadProgress) {
    const isVisible = getModeLabel(mode) === "Выгрузка";
    const bar = document.getElementById("dashboardUnloadProgressBar");
    const targetValue = parseNumber(unloadProgress?.target_weight);
    const factValue = parseNumber(unloadProgress?.unloaded_fact);
    const hasProgressData = targetValue !== null || factValue !== null;

    setSectionVisible("dashboardUnloadProgressCard", Boolean(isVisible));

    if (!bar) {
        return;
    }

    if (!isVisible) {
        bar.style.width = "0%";
        bar.classList.remove("is-over");
        setText("dashboardUnloadProgressMeta", "--");
        return;
    }

    if (!hasProgressData) {
        bar.style.width = "0%";
        bar.classList.remove("is-over");
        setText("dashboardUnloadProgressMeta", "--");
        return;
    }

    const target = Math.max(targetValue ?? 0, 0);
    const fact = Math.max(factValue ?? 0, 0);
    const progress = target > 0 ? (fact / target) * 100 : 0;
    const fillPercent = Math.max(Math.min(progress, 100), 0);

    bar.style.width = `${fillPercent}%`;
    bar.classList.toggle("is-over", progress > 100);
    setText(
        "dashboardUnloadProgressMeta",
        `${formatMetric(fact, 1)} / ${formatMetric(target, 1)} кг (${progress.toFixed(0)}%)`
    );
}

function renderActiveBatch(batch) {
    const tbody = document.getElementById("dashboardActiveBatchTableBody");
    if (!tbody) {
        return;
    }

    const rows = Array.isArray(batch?.ingredients) ? batch.ingredients : [];
    const isVisible = rows.length > 0;

    setSectionVisible("dashboardActiveBatchCard", isVisible);

    if (!isVisible) {
        setText("dashboardActiveBatchMeta", "--");
        tbody.innerHTML = '<tr><td colspan="5" class="dashboard-mini-table-empty">--</td></tr>';
        return;
    }

    const metaParts = [];
    if (batch?.id != null) {
        metaParts.push(`Замес #${batch.id}`);
    }
    metaParts.push(`Компонентов: ${rows.length}`);
    setText("dashboardActiveBatchMeta", metaParts.join(" | "));

    tbody.innerHTML = rows.map((row) => {
        const name = escapeHtml(row?.name ?? "--");
        const plan = formatMetric(row?.plan, 1);
        const fact = formatMetric(row?.fact, 1);
        const deviation = formatSignedPercent(row?.deviation_percent, 1);
        const isViolation = asBoolean(row?.is_violation);

        return `
            <tr>
                <td>${name}</td>
                <td>${plan}</td>
                <td>${fact}</td>
                <td>${deviation}</td>
                <td>
                    <span class="dashboard-bool-badge ${isViolation ? "is-yes" : "is-no"}">
                        ${isViolation ? "Да" : "Нет"}
                    </span>
                </td>
            </tr>
        `;
    }).join("");
}

function getTelemetrySnapshotKey(data) {
    if (isEmptyTelemetry(data)) {
        return null;
    }

    return [
        data.id ?? "",
        data.deviceId ?? "",
        data.timestamp ?? "",
        data.lat ?? "",
        data.lon ?? "",
        data.weight ?? "",
    ].join("|");
}

function noteTelemetryActivity(data) {
    const snapshotKey = getTelemetrySnapshotKey(data);
    if (!snapshotKey) {
        return;
    }

    if (snapshotKey !== lastTelemetrySnapshotKey) {
        lastTelemetrySnapshotKey = snapshotKey;
        lastTelemetryChangeAt = Date.now();
    }
}

function resetTelemetryActivity() {
    lastTelemetrySnapshotKey = null;
    lastTelemetryChangeAt = 0;
}

function setVehicleStatus(isOnline) {
    const element = document.getElementById("dashboardVehicleStatus");
    if (!element) return;

    element.textContent = isOnline ? "Онлайн" : "Оффлайн";
    element.classList.toggle("online", isOnline);
    element.classList.toggle("offline", !isOnline);
}

function getPlacemarkPreset(isOnline) {
    return isOnline ? "islands#blueAutoIcon" : "islands#grayAutoIcon";
}

function getRtkPlacemarkPreset(data) {
    if (!isPacketOnline(data?.timestamp)) {
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

    return "islands#blueCircleDotIcon";
}

function updatePlacemarkStatus(isOnline) {
    if (!placemark) return;
    placemark.options.set("preset", getPlacemarkPreset(isOnline));
}

function ensurePlacemarkVisible() {
    if (!map || !placemark || isPlacemarkVisible) {
        return;
    }

    map.geoObjects.add(placemark);
    isPlacemarkVisible = true;
}

function hidePlacemark() {
    if (!map || !placemark || !isPlacemarkVisible) {
        return;
    }

    map.geoObjects.remove(placemark);
    isPlacemarkVisible = false;
}

function ensureRtkPlacemarkVisible() {
    if (!map || !rtkPlacemark || isRtkPlacemarkVisible) {
        return;
    }

    map.geoObjects.add(rtkPlacemark);
    isRtkPlacemarkVisible = true;
}

function hideRtkPlacemark() {
    if (!map || !rtkPlacemark || !isRtkPlacemarkVisible) {
        return;
    }

    map.geoObjects.remove(rtkPlacemark);
    isRtkPlacemarkVisible = false;
}

function isPacketOnline(timestamp) {
    if (!timestamp) return false;

    const packetTime = new Date(timestamp).getTime();
    if (Number.isNaN(packetTime)) return false;

    return (Date.now() - packetTime) < OFFLINE_THRESHOLD_MS;
}

function isTelemetryOnline(data) {
    return isPacketOnline(data?.timestamp);
}

function hasValidCoordinates(lat, lon) {
    const parsedLat = Number(lat);
    const parsedLon = Number(lon);

    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLon)) {
        return false;
    }

    return parsedLat !== 0 && parsedLon !== 0;
}

function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
    const earthRadius = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return earthRadius * c;
}

function getCurrentZoneName(lat, lon) {
    for (const zone of storageZones) {
        if (!zone?.active) {
            continue;
        }

        const zoneLat = Number(zone.lat);
        const zoneLon = Number(zone.lon);
        const zoneRadius = Number(zone.radius) || 50;

        if (!Number.isFinite(zoneLat) || !Number.isFinite(zoneLon)) {
            continue;
        }

        const distance = getDistanceFromLatLonInMeters(lat, lon, zoneLat, zoneLon);
        if (distance <= zoneRadius) {
            return zone.name;
        }
    }

    return null;
}

function smoothMove(newCoords) {
    const startCoords = placemark.geometry.getCoordinates();
    const duration = 1000;
    const startTime = performance.now();

    function animate(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        const currentLat = startCoords[0] + (newCoords[0] - startCoords[0]) * progress;
        const currentLon = startCoords[1] + (newCoords[1] - startCoords[1]) * progress;

        placemark.geometry.setCoordinates([currentLat, currentLon]);

        if (progress < 1) {
            requestAnimationFrame(animate);
        }
    }

    requestAnimationFrame(animate);
}

function getCurrentMarkerCoords() {
    if (!hasValidCoordinates(latestTelemetry?.lat, latestTelemetry?.lon)) {
        if (hasValidCoordinates(latestRtkTelemetry?.lat, latestRtkTelemetry?.lon)) {
            return [Number(latestRtkTelemetry.lat), Number(latestRtkTelemetry.lon)];
        }

        return null;
    }

    return [Number(latestTelemetry.lat), Number(latestTelemetry.lon)];
}

function getVisibleTelemetryCoords() {
    const coords = [];

    if (hasValidCoordinates(latestTelemetry?.lat, latestTelemetry?.lon)) {
        coords.push([Number(latestTelemetry.lat), Number(latestTelemetry.lon)]);
    }

    if (hasValidCoordinates(latestRtkTelemetry?.lat, latestRtkTelemetry?.lon)) {
        coords.push([Number(latestRtkTelemetry.lat), Number(latestRtkTelemetry.lon)]);
    }

    return coords;
}

function isMapCenteredOnCoords(coords, toleranceMeters = 4) {
    if (!map || !Array.isArray(coords)) {
        return false;
    }

    const currentCenter = map.getCenter();
    if (!Array.isArray(currentCenter) || currentCenter.length < 2) {
        return false;
    }

    return getDistanceFromLatLonInMeters(
        Number(currentCenter[0]),
        Number(currentCenter[1]),
        Number(coords[0]),
        Number(coords[1])
    ) <= toleranceMeters;
}

function moveMapCenterToCoords(coords, options = {}) {
    if (!map || !Array.isArray(coords)) {
        return false;
    }

    const targetZoom = map.getZoom();

    map.setCenter(coords, targetZoom, {
        checkZoomRange: true,
        duration: options.duration ?? 250,
    });

    return true;
}

function centerMapOnMarker(options = {}) {
    if (!map) {
        return false;
    }

    const coordsList = getVisibleTelemetryCoords();
    if (!coordsList.length) {
        return false;
    }

    if (coordsList.length === 1) {
        const coords = coordsList[0];

        if (!options.force && isMapCenteredOnCoords(coords)) {
            return true;
        }

        return moveMapCenterToCoords(coords, options);
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
            duration: options.duration ?? 280,
        }
    );

    return true;
}

function syncMapActionButtons() {
    const hasMarkerCoords = Boolean(getCurrentMarkerCoords());

    if (mapTrackToggleButton) {
        mapTrackToggleButton.disabled = !hasMarkerCoords;
        mapTrackToggleButton.classList.toggle("is-active", isMarkerTrackingEnabled);
        mapTrackToggleButton.setAttribute("aria-pressed", String(isMarkerTrackingEnabled));
    }

    if (mapCenterOnMarkerButton) {
        mapCenterOnMarkerButton.disabled = !hasMarkerCoords;
    }

    if (mapFullscreenButton) {
        const isFullscreen = document.fullscreenElement === mapWrapElement;
        const icon = mapFullscreenButton.querySelector("i");
        mapFullscreenButton.classList.toggle("is-active", isFullscreen);
        mapFullscreenButton.setAttribute("aria-pressed", String(isFullscreen));

        if (icon) {
            icon.className = isFullscreen ? "fas fa-compress-arrows-alt" : "fas fa-expand-arrows-alt";
        }
    }
}

function setMarkerTrackingEnabled(isEnabled) {
    isMarkerTrackingEnabled = Boolean(isEnabled);
    syncMapActionButtons();

    if (isMarkerTrackingEnabled) {
        centerMapOnMarker({ force: true, duration: 300 });
    }
}

function toggleMarkerTracking() {
    if (!getCurrentMarkerCoords()) {
        return;
    }

    setMarkerTrackingEnabled(!isMarkerTrackingEnabled);
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

    if (isMarkerTrackingEnabled) {
        centerMapOnMarker({ duration: 220 });
    }
}

function initMapActionControls() {
    mapWrapElement = document.querySelector(".dashboard-map-wrap");
    mapTrackToggleButton = document.getElementById("mapTrackToggleButton");
    mapCenterOnMarkerButton = document.getElementById("mapCenterOnMarkerButton");
    mapFullscreenButton = document.getElementById("mapFullscreenButton");

    if (mapTrackToggleButton) {
        mapTrackToggleButton.addEventListener("click", toggleMarkerTracking);
    }

    if (mapCenterOnMarkerButton) {
        mapCenterOnMarkerButton.addEventListener("click", () => {
            centerMapOnMarker({ force: true, duration: 280 });
        });
    }

    if (mapFullscreenButton) {
        mapFullscreenButton.addEventListener("click", toggleMapFullscreen);
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    syncMapActionButtons();
}

function updateMapPosition(data, isOnline) {
    if (!hasValidCoordinates(data?.lat, data?.lon)) {
        hidePlacemark();
        hasLiveCoordinates = false;
        syncMapActionButtons();
        return;
    }

    const newCoords = [Number(data.lat), Number(data.lon)];
    ensurePlacemarkVisible();
    updatePlacemarkStatus(isOnline);
    syncMapActionButtons();

    if (!hasLiveCoordinates) {
        placemark.geometry.setCoordinates(newCoords);
        hasLiveCoordinates = true;
        if (!hasTelemetryAutoFocus) {
            centerMapOnMarker({ force: true, duration: 300 });
            hasTelemetryAutoFocus = true;
        }
        return;
    }

    smoothMove(newCoords);

    if (isMarkerTrackingEnabled) {
        centerMapOnMarker({ duration: 220 });
    }
}

function getRtkQualityLabel(data) {
    if (!data) {
        return "--";
    }

    return data.qualityLabel || data.rtkQuality || (data.quality != null ? `Q${data.quality}` : "--");
}

function updateRtkMapPosition(data) {
    if (!hasValidCoordinates(data?.lat, data?.lon)) {
        hideRtkPlacemark();
        return;
    }

    const coords = [Number(data.lat), Number(data.lon)];
    const qualityLabel = getRtkQualityLabel(data);
    const zoneName = getCurrentZoneName(coords[0], coords[1]) || data?.zone?.name || "Вне зоны";
    const isOnline = isPacketOnline(data?.timestamp);
    const balloonContent = `
        <strong>RTK</strong><br>
        Устройство: ${escapeHtml(data?.deviceId || "--")}<br>
        Статус: ${isOnline ? "Свежий пакет" : "Нет свежих пакетов"}<br>
        Quality: ${escapeHtml(qualityLabel)}<br>
        Координаты: ${coords[0].toFixed(6)}, ${coords[1].toFixed(6)}<br>
        Зона: ${escapeHtml(zoneName)}
    `;

    if (!rtkPlacemark) {
        rtkPlacemark = new ymaps.Placemark(
            coords,
            {
                balloonContent,
                hintContent: `RTK • ${qualityLabel}`,
            },
            {
                preset: getRtkPlacemarkPreset(data),
            }
        );
    } else {
        rtkPlacemark.geometry.setCoordinates(coords);
        rtkPlacemark.properties.set({
            balloonContent,
            hintContent: `RTK • ${qualityLabel}`,
        });
        rtkPlacemark.options.set("preset", getRtkPlacemarkPreset(data));
    }

    ensureRtkPlacemarkVisible();

    if (!hasTelemetryAutoFocus) {
        centerMapOnMarker({ force: true, duration: 300 });
        hasTelemetryAutoFocus = true;
    }
}

function renderDashboard(data) {
    if (isEmptyTelemetry(data)) {
        resetTelemetryActivity();
        setVehicleStatus(false);
        setText("dashboardCurrentZone", "--");
        setText("dashboardCurrentMode", data?.mode || "Ожидание");
        setText("dashboardCurrentWeight", "--");
        setText("dashboardLastPacketTime", "--");
        renderUnloadProgress(data?.mode, data?.unload_progress);
        renderActiveBatch(data?.active_batch);
        hidePlacemark();
        hasLiveCoordinates = false;
        syncMapActionButtons();
        return;
    }

    const isOnline = isTelemetryOnline(data);
    const hasCoordinates = hasValidCoordinates(data.lat, data.lon);
    const parsedLat = Number(data.lat);
    const parsedLon = Number(data.lon);
    const zoneName = hasCoordinates
        ? (getCurrentZoneName(parsedLat, parsedLon) || data?.banner?.zoneName || "Вне зоны")
        : "--";

    setVehicleStatus(isOnline);
    setText("dashboardCurrentZone", zoneName);
    setText("dashboardCurrentMode", data?.mode || "Ожидание");
    setText("dashboardCurrentWeight", data.weight != null ? `${formatMetric(data.weight, 1)} кг` : "--");
    setText("dashboardLastPacketTime", formatDateTime(data.timestamp));
    renderUnloadProgress(data?.mode, data?.unload_progress);
    renderActiveBatch(data?.active_batch);

    updateMapPosition(data, isOnline);
}

function clearZoneCircles() {
    zoneCircles.forEach((circle) => map.geoObjects.remove(circle));
    zoneCircles = [];
}

function renderZones() {
    if (!map) return;

    clearZoneCircles();

    zoneCircles = storageZones.filter((zone) => Boolean(zone.active)).map((zone) => {
        const circle = new ymaps.Circle([
            [Number(zone.lat), Number(zone.lon)],
            Number(zone.radius) || 50,
        ], {
            balloonContent: `Зона: ${zone.name}`,
        }, {
            fillColor: "rgba(0, 150, 255, 0.3)",
            strokeColor: "#0066ff",
            strokeOpacity: 0.8,
            strokeWidth: 2,
        });

        map.geoObjects.add(circle);
        return circle;
    });
}

function clearRoutePolyline() {
    if (!routePolyline) return;

    map.geoObjects.remove(routePolyline);
    routePolyline = null;
}

function clearRtkRoutePolyline() {
    if (!rtkRoutePolyline) return;

    map.geoObjects.remove(rtkRoutePolyline);
    rtkRoutePolyline = null;
}

function buildRouteCoords(historyRows) {
    if (!Array.isArray(historyRows)) {
        return [];
    }

    return historyRows
        .filter((row) => hasValidCoordinates(row?.lat, row?.lon))
        .slice()
        .reverse()
        .map((row) => [Number(row.lat), Number(row.lon)]);
}

function renderRoute(historyRows) {
    if (!map) return;

    clearRoutePolyline();
    const routeCoords = buildRouteCoords(historyRows);

    if (routeCoords.length < 2) {
        return;
    }

    routePolyline = new ymaps.Polyline(routeCoords, {
        balloonContent: "Маршрут техники",
    }, {
        strokeColor: "#2e59d9",
        strokeWidth: 4,
        strokeOpacity: 0.75,
    });

    map.geoObjects.add(routePolyline);
}

function renderRtkRoute(historyRows) {
    if (!map) return;

    clearRtkRoutePolyline();
    const routeCoords = buildRouteCoords(historyRows);

    if (routeCoords.length < 2) {
        return;
    }

    rtkRoutePolyline = new ymaps.Polyline(routeCoords, {
        balloonContent: "RTK маршрут",
    }, {
        strokeColor: "#1cc88a",
        strokeWidth: 4,
        strokeOpacity: 0.8,
    });

    map.geoObjects.add(rtkRoutePolyline);
}

async function fetchLatest() {
    try {
        const [hostResponse, rtkResponse] = await Promise.all([
            fetch(getLatestApiUrl(), { headers: getHeaders() }),
            fetch(getRtkLatestApiUrl(), { headers: getHeaders() }).catch(() => null),
        ]);

        if (!hostResponse.ok) {
            renderDashboard(latestTelemetry);
            return;
        }

        latestTelemetry = await hostResponse.json();
        noteTelemetryActivity(latestTelemetry);
        if (latestTelemetry.banner) {
            showBanner(latestTelemetry.banner);
        } else if (currentBannerType && currentBannerType !== "zone_enter") {
            showBanner(null);
        }

        if (rtkResponse && rtkResponse.ok) {
            latestRtkTelemetry = await rtkResponse.json();
        } else if (rtkResponse && rtkResponse.status === 404) {
            latestRtkTelemetry = null;
            hideRtkPlacemark();
        }

        renderDashboard(latestTelemetry);
        updateRtkMapPosition(latestRtkTelemetry);
    } catch (error) {
        console.error("Error fetching latest:", error);
        renderDashboard(latestTelemetry);
    }
}

async function fetchHistory() {
    try {
        const [hostResponse, rtkResponse] = await Promise.all([
            fetch(getHistoryApiUrl(), { headers: getHeaders() }),
            fetch(getRtkHistoryApiUrl(), { headers: getHeaders() }).catch(() => null),
        ]);

        if (!hostResponse.ok) {
            clearRoutePolyline();
            clearRtkRoutePolyline();
            return;
        }

        const hostHistoryRows = await hostResponse.json();
        renderRoute(hostHistoryRows);

        if (rtkResponse && rtkResponse.ok) {
            const rtkHistoryRows = await rtkResponse.json();
            renderRtkRoute(rtkHistoryRows);
        } else {
            clearRtkRoutePolyline();
        }
    } catch (error) {
        console.error("Error fetching history:", error);
        clearRoutePolyline();
        clearRtkRoutePolyline();
    }
}

function parseWifiClients(value) {
    if (Array.isArray(value)) {
        return value;
    }

    if (typeof value === "string" && value.trim()) {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            return [];
        }
    }

    return [];
}

function buildTelemetryRestorePayload(row) {
    return {
        device_id: row.deviceId || "host_01",
        timestamp: row.timestamp,
        lat: row.lat == null ? 0 : Number(row.lat),
        lon: row.lon == null ? 0 : Number(row.lon),
        gps_valid: Boolean(row.gpsValid),
        gps_satellites: Number(row.gpsSatellites) || 0,
        weight: row.weight == null ? 0 : Number(row.weight),
        weight_valid: Boolean(row.weightValid),
        gps_quality: Number(row.gpsQuality) || 0,
        wifi_clients: parseWifiClients(row.wifiClients),
        cpu_temp_c: row.cpuTempC ?? null,
        lte_rssi_dbm: row.lteRssiDbm ?? null,
        lte_access_tech: row.lteAccessTech ?? null,
        events_reader_ok: Boolean(row.eventsReaderOk),
    };
}

async function fetchTelemetrySnapshot() {
    const response = await fetch(getHistoryApiUrl(), { headers: getHeaders() });
    if (!response.ok) {
        let errorMessage = "Не удалось получить историю телеметрии перед очисткой";

        try {
            const payload = await response.json();
            if (payload?.error) {
                errorMessage = payload.error;
            }
        } catch (error) {
            // keep generic message when response body is not JSON
        }

        throw new Error(errorMessage);
    }

    const historyRows = await response.json();
    return Array.isArray(historyRows) ? historyRows : [];
}

async function restoreTelemetryHistory(context) {
    if (!pendingTelemetryUndo) {
        return;
    }

    const snapshot = pendingTelemetryUndo;
    const alertElement = context?.alert || currentUndoAlert || null;
    const actionButton = context?.button || null;

    if (actionButton) {
        actionButton.disabled = true;
        actionButton.textContent = "Восстановление...";
    }

    if (undoAlertTimerId) {
        clearTimeout(undoAlertTimerId);
        undoAlertTimerId = null;
    }

    pendingTelemetryUndo = null;

    try {
        const rowsToRestore = Array.isArray(snapshot.rows) ? snapshot.rows.slice().reverse() : [];

        if (!rowsToRestore.length) {
            removeUndoAlert();
            window.AppAuth?.showAlert?.("История уже была пустой", "warning");
            return;
        }

        for (const row of rowsToRestore) {
            const response = await fetch(API_BASE, {
                method: "POST",
                headers: getHeaders(),
                body: JSON.stringify(buildTelemetryRestorePayload(row)),
            });

            if (!response.ok) {
                let errorMessage = "Не удалось отменить очистку трека";

                try {
                    const payload = await response.json();
                    if (payload?.error) {
                        errorMessage = payload.error;
                    }
                } catch (error) {
                    // keep generic message when response body is not JSON
                }

                throw new Error(errorMessage);
            }
        }

        removeUndoAlert();

        await Promise.all([fetchLatest(), fetchHistory(), fetchZones()]);
        window.AppAuth?.showAlert?.("Очистка трека отменена", "success");
    } catch (error) {
        pendingTelemetryUndo = snapshot;

        if (actionButton) {
            actionButton.disabled = false;
            actionButton.textContent = "Отменить";
        }

        window.AppAuth?.showAlert?.(error.message || "Не удалось отменить очистку трека", "danger");
    }
}

function resolveAlertHost() {
    return (
        document.querySelector("[data-page-alerts]") ||
        document.querySelector(".container-fluid") ||
        document.querySelector(".page-wrapper") ||
        document.querySelector(".container") ||
        document.body
    );
}

function removeUndoAlert() {
    if (undoAlertTimerId) {
        clearTimeout(undoAlertTimerId);
        undoAlertTimerId = null;
    }

    if (currentUndoAlert?.isConnected) {
        currentUndoAlert.remove();
    }

    currentUndoAlert = null;
}

function showTelemetryUndoAlert() {
    removeUndoAlert();
    const alert = window.AppAuth?.showAlert?.("История телеметрии очищена", "success", {
        actionLabel: "Отменить",
        actionClassName: "btn btn-sm font-weight-bold mt-2 mt-sm-0 px-3 flex-shrink-0",
        onAction: ({ alert: alertElement, button, text }) => {
            restoreTelemetryHistory({ alert: alertElement, button, text });
        },
    });

    const actionButton = alert?.querySelector("button");
    if (actionButton) {
        actionButton.style.backgroundColor = "#ffffff";
        actionButton.style.color = "#157347";
        actionButton.style.border = "1px solid #157347";
    }

    currentUndoAlert = alert || null;
    undoAlertTimerId = window.setTimeout(() => {
        removeUndoAlert();
    }, 10000);
}

async function clearTelemetryHistory() {
    if (!hasWriteAccess()) {
        return;
    }

    pendingTelemetryUndo = null;

    const button = document.getElementById("clearTelemetryButton");
    if (button) {
        button.disabled = true;
    }

    try {
        const snapshotRows = await fetchTelemetrySnapshot();
        const response = await fetch(CLEAR_HISTORY_API, {
            method: "DELETE",
            headers: {
                ...getHeaders(),
                "x-test-secret": TEST_SECRET,
            },
        });

        if (!response.ok) {
            let errorMessage = "Не удалось очистить телеметрию";

            try {
                const payload = await response.json();
                if (payload?.error) {
                    errorMessage = payload.error;
                }
            } catch (error) {
                // keep generic message when response body is not JSON
            }

            throw new Error(errorMessage);
        }

        showBanner(null);
        clearRoutePolyline();
        clearRtkRoutePolyline();
        latestTelemetry = null;
        renderDashboard(null);
        pendingTelemetryUndo = { rows: snapshotRows };
        showTelemetryUndoAlert();
    } catch (error) {
        console.error("Error clearing telemetry history:", error);
        window.AppAuth?.showAlert?.(error.message || "Не удалось очистить телеметрию", "danger");
    } finally {
        if (button) {
            button.disabled = false;
        }
    }
}

async function fetchZones() {
    if (isFetchingZones) {
        return;
    }

    isFetchingZones = true;

    try {
        const response = await fetch(ZONES_API, {
            headers: getHeaders(),
            cache: "no-store",
        });
        if (!response.ok) return;

        storageZones = await response.json();
        renderZones();
        renderDashboard(latestTelemetry);
    } catch (error) {
        console.error("Error fetching zones:", error);
    } finally {
        isFetchingZones = false;
    }

    fetchZones();
    fetchLatest();
}

function handleVisibilityChange() {
    if (document.visibilityState !== "visible") {
        return;
    }

    fetchZones();
    fetchLatest();
    fetchHistory();
}

function getBannerOffsetTop() {
    const topbar = document.querySelector(".topbar");
    if (!topbar) {
        return 15;
    }

    const topbarRect = topbar.getBoundingClientRect();
    return Math.max(15, Math.round(topbarRect.bottom + 12));
}

function updateBannerContainerPosition(container) {
    if (!container) {
        return;
    }

    container.style.top = `${getBannerOffsetTop()}px`;
}

function ensureBannerStyles() {
    if (document.getElementById("dashboardBannerStyles")) {
        return;
    }

    const style = document.createElement("style");
    style.id = "dashboardBannerStyles";
    style.textContent = `
        @keyframes bannerInFinal { from { opacity: 0; transform: translateY(-15px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes bannerOutFinal { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(0.9); } }
        @media (max-width: 576px) {
            #banner-container {
                left: 16px;
                right: 16px !important;
                width: auto !important;
                align-items: stretch !important;
            }
        }
    `;
    document.head.appendChild(style);
}

function clearBannerDismissTimer() {
    if (!bannerDismissTimerId) {
        return;
    }

    window.clearTimeout(bannerDismissTimerId);
    bannerDismissTimerId = null;
}

function scheduleZoneBannerDismiss() {
    clearBannerDismissTimer();
    bannerDismissTimerId = window.setTimeout(() => {
        dismissCurrentBanner();
    }, ZONE_BANNER_DISPLAY_MS);
}

function dismissCurrentBanner() {
    clearBannerDismissTimer();

    if (!currentBannerElement) {
        currentBannerType = null;
        lastShownZone = null;
        return;
    }

    currentBannerElement.style.animation = "bannerOutFinal 0.5s ease-in forwards";
    const elementToRemove = currentBannerElement;

    setTimeout(() => {
        if (elementToRemove?.isConnected) {
            elementToRemove.remove();
        }
    }, 500);

    currentBannerElement = null;
    currentBannerType = null;
    lastShownZone = null;
}

function showBanner(banner) {
    if (!banner) {
        dismissCurrentBanner();
        return;
    }

    const bannerType = typeof banner.type === "string" ? banner.type : "info";
    const zoneName = banner.zoneName || banner.name || "";
    const bannerText = zoneName ? `Въезд в зону: ${zoneName}` : (banner.message || "Новое уведомление");

    let container = document.getElementById("banner-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "banner-container";
        container.style.cssText = "position: fixed; right: 20px; z-index: 99999; display: flex; flex-direction: column; gap: 8px; align-items: flex-end; width: min(420px, calc(100vw - 32px)); pointer-events: none;";
        document.body.appendChild(container);
    }

    ensureBannerStyles();
    updateBannerContainerPosition(container);

    if (lastShownZone === bannerText && currentBannerType === bannerType) {
        return;
    }

    clearBannerDismissTimer();
    removeUndoAlert();

    if (currentBannerElement) {
        currentBannerElement.remove();
    }

    lastShownZone = bannerText;
    currentBannerType = bannerType;

    const alert = document.createElement("div");
    alert.style.cssText = "background-color: #1a6b3d; color: white; padding: 10px 18px; border-radius: 20px; box-shadow: 0 5px 12px rgba(0,50,0,0.35); font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif; font-size: 14px; font-weight: 500; line-height: 1.4; opacity: 0; animation: bannerInFinal 0.4s ease-out forwards; cursor: default; pointer-events: none;";
    alert.textContent = bannerText;

    container.appendChild(alert);
    currentBannerElement = alert;

    if (bannerType === "zone_enter") {
        scheduleZoneBannerDismiss();
    }
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

function init() {
    map = new ymaps.Map("map", {
        center: DEFAULT_COORDS,
        zoom: 12,
        type: DEFAULT_MAP_TYPE,
        controls: ["zoomControl"],
    }, {
        geoObjectCursor: "arrow",
        suppressMapOpenBlock: true,
        yandexMapDisablePoiInteractivity: true,
    });

    placemark = new ymaps.Placemark(DEFAULT_COORDS, {}, {
        preset: getPlacemarkPreset(false),
    });

    initMapTypeSwitch();
    initMapActionControls();
    applyIdleMapCursor();
    map.events.add("actionbegin", applyDragMapCursor);
    map.events.add("actionend", handleMapActionEnd);
    map.events.add("actionbreak", handleMapActionEnd);

    renderDashboard(null);
    fetchZones();
    setInterval(fetchZones, ZONES_POLL_INTERVAL_MS);
    fetchLatest();
    setInterval(fetchLatest, LATEST_POLL_INTERVAL_MS);
    fetchHistory();
    setInterval(fetchHistory, LATEST_POLL_INTERVAL_MS);

    const clearTelemetryButton = document.getElementById("clearTelemetryButton");
    if (clearTelemetryButton) {
        clearTelemetryButton.addEventListener("click", clearTelemetryHistory);
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
}

ymaps.ready(init);
