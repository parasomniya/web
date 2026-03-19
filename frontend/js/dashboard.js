// Настройки
const API_BASE = 'http://localhost:3000/api/telemetry/host';
let map, placemark;
let bannerTimeout = null;

//Инициализация карты
ymaps.ready(init);

function init() {
  // Создаём карту
  map = new ymaps.Map("map", {
    center: [54.843243, 83.088801],  // НГУ (координаты эмулятора)
    zoom: 15,
    controls: ['zoomControl', 'fullscreenControl']
  });

  //Создаём маркер "Хозяин"
  placemark = new ymaps.Placemark(
    [54.843243, 83.088801],  // Начальные координаты
    { 
      hintContent: '"Хозяин" здесь',
      balloonContent: 'Последнее обновление: --:--:--'
    },
    { 
      preset: 'islands#blueAutoIcon',
      draggable: false
    }
  );
  
  // Добавляем маркер на карту
  map.geoObjects.add(placemark);
  
  console.log('Карта и метка созданы');

  // Загружаем зоны
  loadStorageZones();
  
  // Запускаем опрос сервера
  startPolling();
}

// Опрос сервера каждые 5 секунд
function startPolling() {
  // Сразу при запуске
  fetchLatest();
  fetchHistory();
  
  // ️ Карта: каждые 0.5 сек (2 раза в секунду)
  setInterval(() => {
    fetchLatest();
  }, 500);
  
  //Таблица: каждые 5 сек
  setInterval(() => {
    fetchHistory();
  }, 5000);
}

// Получить последнюю точку и обновить карту
async function fetchLatest() {
  try {
    const response = await fetch(`${API_BASE}/latest`);
    
    // Проверка что ответ OK
    if (!response.ok) {
      console.error('Server error:', response.status);
      return;
    }
    
    const data = await response.json();
    console.log('Получены данные:', data);

    if (data && data.lat && data.lon) {
      const coords = [data.lat, data.lon];
      
      // Обновляем позицию маркера
      placemark.geometry.setCoordinates(coords);
      
      // Обновляем подсказку
      placemark.properties.set('hintContent', 
        `Обновлено: ${new Date(data.timestamp).toLocaleTimeString('ru-RU')}`
      );
      placemark.properties.set('balloonContent', 
        `Вес: ${data.weight || 0} кг<br>ID: ${data.deviceId || '-'}`
      );
      
      // Центрируем карту на метке
      map.setCenter(coords, 15, { duration: 300 });
      
      console.log('Метка обновлена:', coords);

      // Показываем баннер если есть
      if (data.banner) {
        showBanner(data.banner.message);
      }
    }
  } catch (error) {
    console.error('Ошибка получения данных:', error);
  }
}

// 📋 Получить историю для таблицы
async function fetchHistory() {
  try {
    const response = await fetch(`${API_BASE}/history?limit=10`);
    const data = await response.json();

    const tbody = document.querySelector('#batchesTable tbody');
    if (!tbody) {
      console.warn('Таблица #batchesTable не найдена');
      return;
    }

    tbody.innerHTML = '';

    data.slice().reverse().forEach(item => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${item.id}</td>
        <td>${new Date(item.timestamp).toLocaleString('ru-RU')}</td>
        <td>${item.deviceId || '-'}</td>
        <td>${item.weight?.toFixed(1) || '0'} кг</td>
      `;
      tbody.appendChild(row);
    });
    
    console.log('Таблица обновлена, строк:', data.length);
  } catch (error) {
    console.error('Ошибка получения истории:', error);
  }
}

// 🗺️ Загрузить зоны хранения
async function loadStorageZones() {
  try {
    const res = await fetch('http://localhost:3000/api/telemetry/zones');
    const zones = await res.json();
    console.log('🗺️ Зоны загружены:', zones.length);
    drawZones(zones);
  } catch (err) {
    console.error('Ошибка загрузки зон:', err);
  }
}

// 🗺️ Отрисовать зоны на карте (круги)
function drawZones(zones) {
  zones.forEach((zone, index) => {
    const circle = new ymaps.Circle(
      [[zone.lat, zone.lon], zone.radius || 50],
      {
        balloonContent: `<strong>${zone.name}</strong><br>${zone.ingredient || ''}`
      },
      {
        fillColor: "#00FF0033",  // Зелёный полупрозрачный
        strokeColor: "#00FF00",  // Зелёная обводка
        strokeWidth: 2
      }
    );
    map.geoObjects.add(circle);
    console.log(`Зона ${index + 1} добавлена: ${zone.name}`);
  });
}

// 🎉 Показать баннер
function showBanner(message) {
  // Скрыть предыдущий если есть
  if (bannerTimeout) clearTimeout(bannerTimeout);

  // Проверить есть ли уже баннер
  let banner = document.getElementById('zone-banner');
  
  if (!banner) {
    // Создать баннер
    banner = document.createElement('div');
    banner.id = 'zone-banner';
    banner.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 9999;
      min-width: 300px;
      text-align: center;
      padding: 12px 20px;
      border-radius: 8px;
      background: #d4edda;
      color: #155724;
      border: 1px solid #c3e6cb;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      font-weight: 500;
      font-size: 16px;
    `;
    document.body.insertBefore(banner, document.body.firstChild);
  }

  // Показать сообщение
  banner.innerHTML = `<strong> ${message}</strong>`;
  banner.style.display = 'block';

  // Скрыть через 5 секунд
  bannerTimeout = setTimeout(() => {
    banner.style.display = 'none';
  }, 5000);
  
  console.log('Баннер показан:', message);
}