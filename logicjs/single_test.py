import requests
import json
from datetime import datetime

# Настройки
BASE_URL = "http://127.0.0.1:8000"

# Данные для отправки (можно менять под свои нужды)
# Пример: Грузовик в зоне кукурузы, вес 5300 кг (должно вызвать нарушение)
payload = {
    "latitude": 55.7558,   # Координаты зоны CORN
    "longitude": 37.6173,
    "weight": 5300.0,      # Вес
    "timestamp": datetime.now().isoformat()
}

def main():
    print(f"📡 Отправка данных на {BASE_URL}/telemetry ...")
    print(f"Данные: {json.dumps(payload, ensure_ascii=False)}")
    
    try:
        # 1. Отправляем телеметрию
        resp_post = requests.post(f"{BASE_URL}/telemetry", json=payload)
        
        if resp_post.status_code == 200:
            print("\n✅ Ответ сервера на телеметрию:")
            print(json.dumps(resp_post.json(), indent=2, ensure_ascii=False))
        else:
            print(f"\n❌ Ошибка при отправке телеметрии: {resp_post.status_code}")
            print(resp_post.text)
            return

        # 2. Запрашиваем статус
        print("\n📊 Запрос статуса на {BASE_URL}/batch/status ...")
        resp_get = requests.get(f"{BASE_URL}/batch/status")
        
        if resp_get.status_code == 200:
            status_data = resp_get.json()
            print("\n✅ Текущий статус Batch:")
            print(json.dumps(status_data, indent=2, ensure_ascii=False))
            
            # Красивый вывод нарушений, если они есть
            if status_data.get('violations'):
                print("\n⚠️ ОБНАРУЖЕНЫ НАРУШЕНИЯ:")
                for v in status_data['violations']:
                    print(f"   - {v}")
            else:
                print("\n✨ Нарушений нет.")
                
        elif resp_get.status_code == 404:
            print("\n⚪ Активного батча нет (статус 404). Возможно, вес еще ниже порога или батч завершен.")
        else:
            print(f"\n❌ Ошибка при получении статуса: {resp_get.status_code}")
            print(resp_get.text)

    except requests.exceptions.ConnectionError:
        print("\n❌ Не удалось подключиться к серверу. Убедитесь, что запущен 'node main.js'")
    except Exception as e:
        print(f"\n❌ Произошла ошибка: {e}")

if __name__ == "__main__":
    main()