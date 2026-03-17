import requests
import time
from datetime import datetime

SERVER = "http://localhost:3000/api/telemetry/host"

# Маршрут: НГУ → Заправка → Дом
ROUTE = [
    {"lat": 54.843243, "lon": 83.088801, "label": "НГУ"},
    {"lat": 54.840000, "lon": 83.085000, "label": "В пути"},
    {"lat": 54.837000, "lon": 83.082000, "label": "В пути"},
    {"lat": 54.834000, "lon": 83.079000, "label": "Заправка"},
    {"lat": 54.831000, "lon": 83.076000, "label": "В пути"},
    {"lat": 54.828000, "lon": 83.073000, "label": "В пути"},
    {"lat": 54.825000, "lon": 83.070000, "label": "Дом"},
]

print("Запуск эмулятора...")
print(f"Сервер: {SERVER}\n")
print("Частота: 2 раза в секунду (500 мс)\n")

for point in ROUTE:
    payload = {
        "lat": point["lat"],
        "lon": point["lon"],
        "weight": 0,
        "timestamp": datetime.now().isoformat(),
        "deviceId": "host_01"
    }
    
    try:
        resp = requests.post(SERVER, json=payload, timeout=5)
        result = resp.json()
        
        print(f"{point['label']}", end="")
        
        if result.get('banner'):
            print(f" → {result['banner']['message']}")
        else:
            print(" → ok")
            
    except Exception as e:
        print(f"{point['label']} → {e}")
    
    time.sleep(0.5)  # ← 0.5 секунды = 2 раза в секунду

print("\nЭмуляция завершена!")