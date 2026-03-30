const API_BASE = "/api/telemetry/host";
const ZONES_API = "/api/telemetry/zones";
const HISTORY_API = `${API_BASE}/recent?limit=100000`;
const CLEAR_HISTORY_API = `${API_BASE}/admin/truncate`;
const TEST_SECRET = "kill_all_telemetry_123";
const DEFAULT_COORDS = [54.84, 83.09];
const LATEST_POLL_INTERVAL_MS = 1000;
const OFFLINE_THRESHOLD_MS = 5000;

let map;
let placemark;
let routePolyline = null;
let latestTelemetry = null;
let storageZones = [];
let zoneCircles = [];
let hasLiveCoordinates = false;
let isPlacemarkVisible = false;

function isAdmin() {
    return Boolean(window.AppAuth?.isAdmin && window.AppAuth.isAdmin());
}

function getHeaders() {
    const token = localStorage.getItem("token");
    const headers = {
        "Content-Type": "application/json",
    };

    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    return headers;
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

function updateMapPosition(data, isOnline) {
    if (!hasValidCoordinates(data?.lat, data?.lon)) {
        hidePlacemark();
        hasLiveCoordinates = false;
        return;
    }

    const newCoords = [Number(data.lat), Number(data.lon)];
    ensurePlacemarkVisible();
    updatePlacemarkStatus(isOnline);

    if (!hasLiveCoordinates) {
        placemark.geometry.setCoordinates(newCoords);
        map.setCenter(newCoords);
        hasLiveCoordinates = true;
        return;
    }

    smoothMove(newCoords);
}

function renderDashboard(data) {
    if (!data) {
        setVehicleStatus(false);
        setText("dashboardCurrentZone", "--");
        setText("dashboardCurrentSpeed", "--");
        setText("dashboardCurrentWeight", "--");
        setText("dashboardLastPacketTime", "--");
        hidePlacemark();
        hasLiveCoordinates = false;
        return;
    }

    const isOnline = isPacketOnline(data.timestamp);
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

    zoneCircles = storageZones.map((zone) => {
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

    if (!isAdmin()) {
        return;
    }

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
        const response = await fetch(`${API_BASE}/current`, { headers: getHeaders() });
        if (!response.ok) {
            renderDashboard(latestTelemetry);
            return;
        }

        latestTelemetry = await response.json();
        showBanner(latestTelemetry.banner || null);
        renderDashboard(latestTelemetry);
    } catch (error) {
        console.error("Error fetching latest:", error);
        renderDashboard(latestTelemetry);
    }
}

async function fetchHistory() {
    if (!isAdmin()) {
        clearRoutePolyline();
        return;
    }

    try {
        const response = await fetch(HISTORY_API, { headers: getHeaders() });
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

async function clearTelemetryHistory() {
    if (!isAdmin()) {
        return;
    }

    const button = document.getElementById("clearTelemetryButton");
    if (button) {
        button.disabled = true;
    }

    try {
        const response = await fetch(CLEAR_HISTORY_API, {
            method: "DELETE",
            headers: {
                ...getHeaders(),
                "x-test-secret": TEST_SECRET,
            },
        });

        if (!response.ok) {
            let errorMessage = "Не удалось очистить телеметрию.";

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

        latestTelemetry = null;
        showBanner(null);
        clearRoutePolyline();
        renderDashboard(null);
        window.AppAuth?.showAlert?.("История телеметрии очищена.", "success");
    } catch (error) {
        console.error("Error clearing telemetry history:", error);
        window.AppAuth?.showAlert?.(error.message || "Не удалось очистить телеметрию.", "danger");
    } finally {
        if (button) {
            button.disabled = false;
        }
    }
}

async function fetchZones() {
    try {
        const response = await fetch(ZONES_API, { headers: getHeaders() });
        if (!response.ok) return;

        storageZones = await response.json();
        renderZones();
        renderDashboard(latestTelemetry);
    } catch (error) {
        console.error("Error fetching zones:", error);
    }
}

let lastShownZone = null;
let currentBannerElement = null;

function showBanner(banner) {
    if (!banner) {
        if (currentBannerElement) {
            currentBannerElement.style.animation = "bannerOutFinal 0.5s ease-in forwards";
            const elementToRemove = currentBannerElement;
            setTimeout(() => {
                if (elementToRemove) {
                    elementToRemove.remove();
                }
            }, 500);
            currentBannerElement = null;
        }
        lastShownZone = null;
        return;
    }

    const zoneName = banner.zoneName || banner.name || "";
    const bannerText = zoneName ? `Въезд в зону: ${zoneName}` : (banner.message || "Новое уведомление");
    if (lastShownZone === bannerText) return;

    if (currentBannerElement) {
        currentBannerElement.remove();
    }

    lastShownZone = bannerText;

    let container = document.getElementById("banner-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "banner-container";
        container.style.cssText = "position: fixed; top: 15px; right: 20px; z-index: 99999; display: flex; flex-direction: column; gap: 8px; align-items: flex-end;";
        document.body.appendChild(container);
    }

    if (!document.getElementById("banner-styles-final")) {
        const style = document.createElement("style");
        style.id = "banner-styles-final";
        style.innerHTML = `
            @keyframes bannerInFinal { from { opacity: 0; transform: translateY(-15px); } to { opacity: 1; transform: translateY(0); } }
            @keyframes bannerOutFinal { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(0.9); } }
        `;
        document.head.appendChild(style);
    }

    const alert = document.createElement("div");
    alert.style.cssText = "background-color: #1a6b3d; color: white; padding: 10px 18px; border-radius: 20px; box-shadow: 0 5px 12px rgba(0,50,0,0.35); font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif; font-size: 14px; font-weight: 500; opacity: 0; animation: bannerInFinal 0.4s ease-out forwards; cursor: default;";
    alert.textContent = bannerText;

    container.appendChild(alert);
    currentBannerElement = alert;
}

function init() {
    map = new ymaps.Map("map", {
        center: DEFAULT_COORDS,
        zoom: 12,
        controls: ["zoomControl", "fullscreenControl"],
    });

    placemark = new ymaps.Placemark(DEFAULT_COORDS, {}, {
        preset: getPlacemarkPreset(false),
    });

    renderDashboard(null);
    fetchZones();
    fetchLatest();
    setInterval(fetchLatest, LATEST_POLL_INTERVAL_MS);

    if (isAdmin()) {
        fetchHistory();
        setInterval(fetchHistory, LATEST_POLL_INTERVAL_MS);
    }

    const clearTelemetryButton = document.getElementById("clearTelemetryButton");
    if (clearTelemetryButton) {
        clearTelemetryButton.addEventListener("click", clearTelemetryHistory);
    }
}

ymaps.ready(init);
