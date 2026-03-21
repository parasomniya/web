const API_BASE = "https://hostnamesrostkiserver.tail0cd01d.ts.net/api/telemetry/host";
const ZONES_API = "https://hostnamesrostkiserver.tail0cd01d.ts.net/api/telemetry/zones";

let map;
let placemark;
let zoneObjects = [];
let bannerTimeout = null;

function getToken() {
    return localStorage.getItem("token");
}

function authHeaders() {
    const token = getToken();

    if (!token) {
        return {};
    }

    return {
        Authorization: "Bearer " + token
    };
}

ymaps.ready(init);

function init() {
    map = new ymaps.Map("map", {
        center: [54.843243, 83.088801],
        zoom: 15,
        controls: ["zoomControl", "fullscreenControl"]
    });

    placemark = new ymaps.Placemark(
        [54.843243, 83.088801],
        {
            hintContent: '"Хозяин" здесь',
            balloonContent: "Последнее обновление: --:--:--"
        },
        {
            preset: "islands#blueAutoIcon",
            draggable: false
        }
    );

    map.geoObjects.add(placemark);

    loadStorageZones();
    startPolling();
}

function startPolling() {
    fetchLatest();
    fetchHistory();

    setInterval(fetchLatest, 5000);
    setInterval(fetchHistory, 5000);
    setInterval(loadStorageZones, 15000);
}

async function fetchLatest() {
    try {
        const response = await fetch(`${API_BASE}/latest`, {
            headers: authHeaders()
        });

        if (!response.ok) {
            console.error("Ошибка latest:", response.status);
            return;
        }

        const data = await response.json();
    if (data.banner) { console.log("[ZONE EVENT] " + data.banner.message); }

        if (!data || data.lat == null || data.lon == null) {
            return;
        }

        const coords = [Number(data.lat), Number(data.lon)];

        placemark.geometry.setCoordinates(coords);

        placemark.properties.set(
            "hintContent",
            `Обновлено: ${data.timestamp ? new Date(data.timestamp).toLocaleTimeString("ru-RU") : "--:--:--"}`
        );

        placemark.properties.set(
            "balloonContent",
            `Вес: ${Number(data.weight || 0).toFixed(1)} кг<br>ID: ${data.deviceId || "-"}`
        );

        map.setCenter(coords, 15, { duration: 300 });

        if (data.banner && data.banner.message) {
            showBanner(data.banner.message);
            console.log("1");
        }
    } catch (error) {
        console.error("Ошибка получения latest:", error);
    }
}

async function fetchHistory() {
    try {
        const response = await fetch(`${API_BASE}/history?limit=10`, {
            headers: authHeaders()
        });

        if (!response.ok) {
            console.error("Ошибка history:", response.status);
            return;
        }

        const data = await response.json();

        const tbody = document.querySelector("#batchesTable tbody");
        if (!tbody) {
            return;
        }

        tbody.innerHTML = "";

        if (!Array.isArray(data)) {
            return;
        }

        data.slice().reverse().forEach((item) => {
            const row = document.createElement("tr");

            row.innerHTML = `
                <td>${item.id ?? "-"}</td>
                <td>${item.timestamp ? new Date(item.timestamp).toLocaleString("ru-RU") : "-"}</td>
                <td>${item.deviceId || "-"}</td>
                <td>${item.weight != null ? Number(item.weight).toFixed(1) + " кг" : "0 кг"}</td>
            `;

            tbody.appendChild(row);
        });
    } catch (error) {
        console.error("Ошибка получения history:", error);
    }
}

async function loadStorageZones() {
    try {
        const response = await fetch(ZONES_API, {
            headers: authHeaders()
        });

        if (!response.ok) {
            console.error("Ошибка зон:", response.status);
            return;
        }

        const zones = await response.json();
        drawZones(Array.isArray(zones) ? zones : []);
    } catch (error) {
        console.error("Ошибка загрузки зон:", error);
    }
}

function drawZones(zones) {
    zoneObjects.forEach((obj) => map.geoObjects.remove(obj));
    zoneObjects = [];

    zones.forEach((zone) => {
        if (zone.active === false) {
            return;
        }

        if (zone.lat == null || zone.lon == null || zone.radius == null) {
            return;
        }

        const circle = new ymaps.Circle(
            [[Number(zone.lat), Number(zone.lon)], Number(zone.radius)],
            {
                balloonContent: `
                    <strong>${escapeHtml(zone.ingredient || zone.name || "Зона")}</strong><br>
                    Радиус: ${Number(zone.radius)} м
                `
            },
            {
                fillColor: "#00c85333",
                strokeColor: "#1e88e5",
                strokeWidth: 2
            }
        );

        map.geoObjects.add(circle);
        zoneObjects.push(circle);
    });
}

function showBanner(message) {
    let banner = document.getElementById("zone-entry-banner");

    if (!banner) {
        banner = document.createElement("div");
        banner.id = "zone-entry-banner";
        banner.className = "zone-entry-banner hidden";
        document.body.appendChild(banner);
    }

    banner.textContent = message;
    banner.classList.remove("hidden");

    if (bannerTimeout) {
        clearTimeout(bannerTimeout);
    }

    bannerTimeout = setTimeout(() => {
        banner.classList.add("hidden");
    }, 3000);
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}




