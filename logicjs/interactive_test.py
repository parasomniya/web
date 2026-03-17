import requests
import json
from datetime import datetime

BASE_URL = "http://127.0.0.1:8000"

def send_and_check(lat, lon, weight):
    """Отправляет телеметрию и сразу получает статус"""
    payload = {
        "latitude": lat,
        "longitude": lon,
        "weight": weight,
        "timestamp": datetime.now().isoformat()
    }

    print(f"\n📡 Отправка: Вес={weight}, Коорд=[{lat}, {lon}]...")
    
    try:
        # 1. Отправляем телеметрию
        resp_post = requests.post(f"{BASE_URL}/telemetry", json=payload, timeout=5)
        
        if resp_post.status_code == 200:
            telemetry_result = resp_post.json()
            print("✅ Ответ на телеметрию:")
            print(json.dumps(telemetry_result, indent=2, ensure_ascii=False))
        else:
            print(f"❌ Ошибка телеметрии: {resp_post.status_code} - {resp_post.text}")
            return

        # 2. Получаем статус
        resp_status = requests.get(f"{BASE_URL}/batch/status", timeout=5)
        
        if resp_status.status_code == 200:
            status_data = resp_status.json()
            print("\n📊 Текущий статус Batch:")
            print(f"   Активен: {status_data['is_active']}")
            print(f"   Вес: {status_data['current_weight']} кг")
            if status_data['initial_weight_W0'] is not None:
                print(f"   Начальный вес (W0): {status_data['initial_weight_W0']} кг")
            
            # Вывод нарушений
            violations = status_data.get('violations', [])
            if violations:
                print("\n⚠️ НАРУШЕНИЯ:")
                for v in violations:
                    print(f"   - {v}")
            else:
                print("\n✨ Нарушений нет.")
                
        elif resp_status.status_code == 404:
            print("\n⚪ Статус: Нет активного батча (ожидание начала или завершен).")
        else:
            print(f"\n❌ Ошибка статуса: {resp_status.status_code}")

    except requests.exceptions.ConnectionError:
        print("\n❌ Ошибка подключения! Убедитесь, что сервер запущен (node main.js).")
    except Exception as e:
        print(f"\n❌ Произошла ошибка: {e}")

def main():
    print("🚛 Интерактивный тестер Feed Batch Tracker")
    print("Вводите данные в формате: <широта> <долгота> <вес>")
    print("Пример: 55.7558 37.6173 5300")
    print("Команды: 'exit' или 'logout' для выхода.\n")

    while True:
        user_input = input(">>> ").strip()
        
        if user_input.lower() in ['exit', 'logout']:
            print("👋 Завершение работы.")
            break
        
        if not user_input:
            continue

        parts = user_input.split()
        
        if len(parts) != 3:
            print("❌ Неверный формат. Нужно 3 числа: широта долгота вес")
            continue
        
        try:
            lat = float(parts[0])
            lon = float(parts[1])
            weight = float(parts[2])
            
            # Проверка диапазонов (опционально)
            if not (-90 <= lat <= 90) or not (-180 <= lon <= 180) or weight < 0:
                print("❌ Неверные значения координат или веса.")
                continue
                
            send_and_check(lat, lon, weight)
            
        except ValueError:
            print("❌ Ошибка преобразования чисел. Убедитесь, что используете точки для дробей.")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n👋 Прервано пользователем.")