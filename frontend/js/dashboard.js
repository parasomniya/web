const API_BASE = window.AppAuth?.getApiUrl?.("/api/telemetry/host") || "/api/telemetry/host";
const ZONES_API = window.AppAuth?.getApiUrl?.("/api/telemetry/zones") || "/api/telemetry/zones";
const CLEAR_HISTORY_API = `${API_BASE}/admin/truncate`;
const HISTORY_LIMIT = 100000;
const TEST_SECRET = "kill_all_telemetry_123";
const DEFAULT_COORDS = [54.84, 83.09];
const LATEST_POLL_INTERVAL_MS = 1000;
const ZONES_POLL_INTERVAL_MS = 10000;
const OFFLINE_THRESHOLD_MS = 30000;
const DEFAULT_MAP_TYPE = "yandex#map";
const ZONE_BANNER_DISPLAY_MS = 4500;

let map;
let placemark;
let routePolyline = null;
let latestTelemetry = null;
let storageZones = [];
let zoneCircles = [];
let hasLiveCoordinates = false;
let isPlacemarkVisible = false;
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
    return isAdmin() ? `${API_BASE}/admin/latest` : `${API_BASE}/current`;
}

function getHistoryApiUrl() {
    return isAdmin()
        ? `${API_BASE}/admin/history?limit=${HISTORY_LIMIT}`
        : `${API_BASE}/recent?limit=${HISTORY_LIMIT}`;
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

function isPacketOnline(timestamp) {
    if (!timestamp) return false;

    const packetTime = new Date(timestamp).getTime();
    if (Number.isNaN(packetTime)) return false;

    return (Date.now() - packetTime) < OFFLINE_THRESHOLD_MS;
}

function isRecentTelemetryActivity() {
    return lastTelemetryChangeAt > 0 && (Date.now() - lastTelemetryChangeAt) < OFFLINE_THRESHOLD_MS;
}

function isTelemetryOnline(data) {
    return isPacketOnline(data?.timestamp) || isRecentTelemetryActivity();
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
        return null;
    }

    return [Number(latestTelemetry.lat), Number(latestTelemetry.lon)];
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

    const coords = getCurrentMarkerCoords();
    if (!coords) {
        return false;
    }

    if (!options.force && isMapCenteredOnCoords(coords)) {
        return true;
    }

    return moveMapCenterToCoords(coords, options);
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
        return;
    }

    smoothMove(newCoords);

    if (isMarkerTrackingEnabled) {
        centerMapOnMarker({ duration: 220 });
    }
}

function renderDashboard(data) {
    if (isEmptyTelemetry(data)) {
        resetTelemetryActivity();
        setVehicleStatus(false);
        setText("dashboardCurrentZone", "--");
        setText("dashboardCurrentSpeed", "--");
        setText("dashboardCurrentWeight", "--");
        setText("dashboardLastPacketTime", "--");
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
    setText("dashboardCurrentSpeed", data.speed != null ? `${formatMetric(data.speed, 1)} км/ч` : "--");
    setText("dashboardCurrentWeight", data.weight != null ? `${formatMetric(data.weight, 1)} кг` : "--");
    setText("dashboardLastPacketTime", formatDateTime(data.timestamp));

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

function renderRoute(historyRows) {
    if (!map) return;

    clearRoutePolyline();

    if (!Array.isArray(historyRows)) {
        return;
    }

    const routeCoords = historyRows
        .filter((row) => hasValidCoordinates(row?.lat, row?.lon))
        .slice()
        .reverse()
        .map((row) => [Number(row.lat), Number(row.lon)]);

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

async function fetchLatest() {
    try {
        const response = await fetch(getLatestApiUrl(), { headers: getHeaders() });
        if (!response.ok) {
            renderDashboard(latestTelemetry);
            return;
        }

        latestTelemetry = await response.json();
        noteTelemetryActivity(latestTelemetry);
        if (latestTelemetry.banner) {
            showBanner(latestTelemetry.banner);
        } else if (currentBannerType && currentBannerType !== "zone_enter") {
            showBanner(null);
        }
        renderDashboard(latestTelemetry);
    } catch (error) {
        console.error("Error fetching latest:", error);
        renderDashboard(latestTelemetry);
    }
}

async function fetchHistory() {
    try {
        const response = await fetch(getHistoryApiUrl(), { headers: getHeaders() });
        if (!response.ok) {
            clearRoutePolyline();
            return;
        }

        const historyRows = await response.json();
        renderRoute(historyRows);
    } catch (error) {
        console.error("Error fetching history:", error);
        clearRoutePolyline();
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
