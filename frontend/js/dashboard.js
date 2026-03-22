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
