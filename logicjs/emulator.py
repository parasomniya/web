import time
import requests
from datetime import datetime, timedelta

BASE_URL = "http://localhost:3000"  # ← порт 3000
ENDPOINT = "/api/telemetry/host"

# Координаты зон ← ЗАМЕНИТЬ НА РЕАЛЬНЫЕ
ZONES = {
    "ngu": {"lat": 55.030, "lon": 82.950},      # НГУ
    "gas": {"lat": 55.015, "lon": 82.940},      # Заправка
    "home": {"lat": 55.008, "lon": 82.935},     # Дом
}

# В функции send_telemetry ← ИСПРАВИТЬ ПОЛЯ
def send_telemetry(lat, lon, weight):
    payload = {
        "lat": lat,              # ← было "latitude"
        "lon": lon,              # ← было "longitude"
        "weight": weight,
        "timestamp": datetime.now().isoformat(),
        "deviceId": "host_01"    # ← добавить
    }
    try:
        resp = requests.post(f"{BASE_URL}{ENDPOINT}", json=payload)  # ← добавить ENDPOINT
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.RequestException as e:
        print(f"Ошибка отправки: {e}")
        return None

def get_status():
    """Получает текущий статус"""
    try:
        resp = requests.get(f"{BASE_URL}/batch/status")
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.RequestException:
        return None

def print_step(step_name, data):
    print(f"\n--- {step_name} ---")
    if isinstance(data, dict):
        for k, v in data.items():
            if isinstance(v, float):
                print(f"  {k}: {v:.2f}")
            else:
                print(f"  {k}: {v}")
    else:
        print(f"  Результат: {data}")

def wait_seconds(seconds, description="Ожидание"):
    """Имитация ожидания (в реальном времени для демонстрации)"""
    print(f"\n⏳ {description} ({seconds} сек)...")
    # Для быстрой проверки можно уменьшить множитель, но оставим 1:1 для честности теста
    # Если хотите ускорить тест в 10 раз, раскомментируйте строку ниже:
    # seconds = seconds / 10 
    time.sleep(seconds)

def main():
    print("🚛 Запуск эмулятора Feed Batch Tracker...")
    
    # Сброс (опционально: можно добавить эндпоинт сброса, если нужно тестировать много раз подряд)
    # Сейчас просто начинаем новый цикл
    
    current_weight = 2000.0 # Вес пустого грузовика (Tare weight)
    current_lat, current_lon = ZONES["road"]["lat"], ZONES["road"]["lon"]
    
    # 1. Начало: Грузовик стоит на дороге, вес стабильный (ниже порога 100кг прироста от предыдущего, но общий > 0)
    # Чтобы начать батч, вес должен стать > 100 (порог WEIGHT_THRESHOLD_W). 
    # Допустим, tare weight уже 2000, значит батч начнется, когда мы начнем грузить.
    
    print("\n[ЭТАП 1] Подъезд к зоне КУКУРУЗЫ и начало загрузки")
    current_lat, current_lon = ZONES["corn"]["lat"], ZONES["corn"]["lon"]
    
    # Имитация загрузки кукурузы: с 2000 до 5300 кг (Идеал 5000 + 300 превышение > 5%)
    # 5% от 5000 = 250 кг. Превышение 300 кг -> должно быть нарушение.
    target_corn_weight = 5300.0
    step = 100.0
    
    while current_weight < target_corn_weight:
        current_weight += step
        res = send_telemetry(current_lat, current_lon, current_weight)
        if res and res.get('status') == 'batch_started':
            print(f"✅ BATCH STARTED! W0: {res.get('W0')}")
        elif res and res.get('status') == 'loading':
            pass # Шумим меньше при загрузке
        time.sleep(0.1) # Небольшая пауза между запросами

    print_step("Статус после загрузки кукурузы", get_status())

    print("\n[ЭТАП 2] Переезд в зону ПШЕНИЦЫ и дозагрузка")
    current_lat, current_lon = ZONES["wheat"]["lat"], ZONES["wheat"]["lon"]
    
    # Дозагрузка пшеницы: +2000 кг (Идеал 4500, текущий наберется 2000, что меньше идеала, но в рамках допустимого недогруза? 
    # Проверим: 4500 - 2000 = 2500. 5% от 4500 = 225. 2500 > 225 -> Будет нарушение "занижен")
    # Давайте загрузим 4400 (недогруз 100кг, что < 225кг -> ОК)
    target_wheat_add = 4400.0
    start_wheat_weight = current_weight
    
    while current_weight < start_wheat_weight + target_wheat_add:
        current_weight += 100.0
        send_telemetry(current_lat, current_lon, current_weight)
        time.sleep(0.05)

    status = get_status()
    print_step("Статус после загрузки пшеницы (проверьте violations)", status)
    
    if status and 'violations' in status:
        print(f"⚠️ Текущие нарушения: {status['violations']}")

    print("\n[ЭТАП 3] Поездка на выгрузку")
    current_lat, current_lon = ZONES["unload"]["lat"], ZONES["unload"]["lon"]
    send_telemetry(current_lat, current_lon, current_weight)
    print("📍 Прибыли в зону выгрузки")

    print("\n[ЭТАП 4] Выгрузка части груза")
    # Выгружаем 3000 кг
    current_weight -= 3000.0
    res = send_telemetry(current_lat, current_lon, current_weight)
    print_step("Результат выгрузки", res)

    print("\n[ЭТАП 5] Ожидание стабилизации (10 минут для закрытия батча)")
    print("💡 Примечание: Эмулятор будет ждать реальные 600 секунд (10 мин).")
    print("💡 Чтобы ускорить тест, измените время сна в коде или подождите...")
    
    # Отправляем пульсирующие сигналы с тем же весом, чтобы таймер тикал
    delay_time = 20 # секунд
    interval = 1 # отправляем данные каждые 30 сек
    steps = int(delay_time / interval)
    
    for i in range(steps):
        time.sleep(interval)
        # Отправляем тот же вес с небольшим шумом, чтобы не сработало как загрузка/выгрузка
        noise = 0.1 
        send_telemetry(current_lat, current_lon, current_weight + noise)
        remaining = (steps - i - 1) * interval
        if remaining % 60 == 0:
            print(f"   ⏳ Осталось ждать: {remaining // 60} мин...")

    print("\n[ЭТАП 6] Проверка завершения батча")
    # Последнее подтверждение
    final_res = send_telemetry(current_lat, current_lon, current_weight)
    print_step("Финальный ответ сервера", final_res)

    print("\n[ЭТАП 7] Получение истории и последнего батча")
    last_batch = requests.get(f"{BASE_URL}/batch/last").json()
    print_step("ПОЛНЫЙ ОТЧЕТ ПО БАТЧУ", last_batch)
    
    print("\n✅ Эмуляция завершена!")
    print("Проверьте поле 'violations' в отчете выше.")
    print(f"Ожидалось нарушение для CORN (превышение) и возможно для WHEAT (если недогруз большой).")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n❌ Эмуляция прервана пользователем")