const API_BASE = '/api/telemetry/host'; // Путь из твоего роутера

function getHeaders() {
    const token = localStorage.getItem("token");
    return {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json"
    };
}

let map, placemark;

ymaps.ready(init);

function init() {
    // Создаем карту. Если координат нет, ставим дефолт (например, Новосибирск)
    map = new ymaps.Map("map", {
        center: [54.84, 83.09], 
        zoom: 12,
        controls: ['zoomControl', 'fullscreenControl']
    });
    
    // Создаем метку (машинку)
    placemark = new ymaps.Placemark(map.getCenter(), {}, {
        preset: 'islands#blueAutoIcon'
    });
    
    map.geoObjects.add(placemark);
    
    // Запускаем циклы обновления
    fetchLatest();
    fetchHistory();
    fetchZones();
    fetchZones();
    setInterval(fetchLatest, 1000); // Опрос последней точки
    setInterval(fetchHistory, 5000); // Опрос таблицы раз в 5 сек
}

// Функция для ПЛАВНОГО движения метки
function smoothMove(newCoords) {
    const startCoords = placemark.geometry.getCoordinates();
    const duration = 1000; // 1 секунда на движение
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

async function fetchLatest() {
    try {
        const response = await fetch(`${API_BASE}/latest`, { headers: getHeaders() });
        if (!response.ok) return;
        const data = await response.json();
        if (data && typeof data === "object" && !Array.isArray(data)) showBanner(data.banner || null);
        
        if (data.lat && data.lon) {
            const newCoords = [Number(data.lat), Number(data.lon)];
            smoothMove(newCoords); // Едем плавно
        }
    } catch (e) { console.error("Error fetching latest:", e); }
}

async function fetchHistory() {
    try {
        const response = await fetch(`${API_BASE}/history?limit=10`, { headers: getHeaders() });
        if (!response.ok) return;
        const data = await response.json();
        if (data && typeof data === "object" && !Array.isArray(data)) showBanner(data.banner || null);
        updateTable(data);
    } catch (e) { console.error("Error fetching history:", e); }
}

function updateTable(data) {
    const tableBody = document.querySelector("table tbody"); 
    if (!tableBody) return;

    tableBody.innerHTML = data.map(row => `
        <tr>
            <td>${row.id}</td>
            <td>${new Date(row.timestamp).toLocaleString('ru-RU')}</td>
            <td>${row.deviceId || 'host_01'}</td>
            <td>${row.weight || 0} кг</td>
        </tr>
    `).join('');
}

async function fetchZones() {
    try {
        const response = await fetch('/api/telemetry/zones', { headers: getHeaders() });
        if (!response.ok) return;
        const zones = await response.json();
        
        zones.forEach(zone => {
            const circle = new ymaps.Circle([
                [Number(zone.lat), Number(zone.lon)], 
                zone.radius || 50
            ], {
                balloonContent: `Зона: ${zone.name}`
            }, {
                fillColor: 'rgba(0, 150, 255, 0.3)',
                strokeColor: '#0066ff',
                strokeOpacity: 0.8,
                strokeWidth: 2
            });
            map.geoObjects.add(circle);
        });
    } catch (e) { console.error("Error fetching zones:", e); }
}

// --- Отрисовка зон ---
async function fetchZones() {
    try {
        const response = await fetch('/api/telemetry/zones', { headers: getHeaders() });
        if (!response.ok) return;
        const zones = await response.json();
        
        zones.forEach(zone => {
            const circle = new ymaps.Circle([
                [Number(zone.lat), Number(zone.lon)], 
                zone.radius || 50
            ], {
                balloonContent: `Зона: ${zone.name}`
            }, {
                fillColor: 'rgba(0, 150, 255, 0.3)',
                strokeColor: '#0066ff',
                strokeOpacity: 0.8,
                strokeWidth: 2
            });
            map.geoObjects.add(circle);
        });
    } catch (e) { console.error("Error fetching zones:", e); }
}

// --- Постоянный баннер ---
let lastShownZone = null;
let currentBannerElement = null;

function showBanner(banner) {
    if (!banner) {
        if (currentBannerElement) {
            currentBannerElement.style.animation = 'bannerOutFinal 0.5s ease-in forwards';
            const elToRemove = currentBannerElement;
            setTimeout(() => { if (elToRemove) elToRemove.remove(); }, 500);
            currentBannerElement = null;
        }
        lastShownZone = null;
        return;
    }

    const zoneName = banner.zoneName || banner.name || '';
    if (lastShownZone === zoneName) return; 

    if (currentBannerElement) {
        currentBannerElement.remove();
    }

    lastShownZone = zoneName;

    let container = document.getElementById('banner-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'banner-container';
        container.style.cssText = 'position: fixed; top: 15px; right: 20px; z-index: 99999; display: flex; flex-direction: column; gap: 8px; align-items: flex-end;';
        document.body.appendChild(container);
    }

    if (!document.getElementById('banner-styles-final')) {
        const style = document.createElement('style');
        style.id = 'banner-styles-final';
        style.innerHTML = `
            @keyframes bannerInFinal { from { opacity: 0; transform: translateY(-15px); } to { opacity: 1; transform: translateY(0); } }
            @keyframes bannerOutFinal { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(0.9); } }
        `;
        document.head.appendChild(style);
    }

    const alert = document.createElement('div');
    alert.style.cssText = 'background-color: #1a6b3d; color: white; padding: 10px 18px; border-radius: 20px; box-shadow: 0 5px 12px rgba(0,50,0,0.35); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 14px; font-weight: 500; opacity: 0; animation: bannerInFinal 0.4s ease-out forwards; cursor: default;';
    alert.textContent = `Въезд в зону: ${zoneName}`;
    
    container.appendChild(alert);
    currentBannerElement = alert;
}
