import requests
import json
import time
import os
from datetime import datetime

# НАСТРОЙКИ
INPUT_FILE = "test_data.txt"
OUTPUT_FILE = "test_result.txt"
BASE_URL = "http://127.0.0.1:3000"

def main():
    print(f"🚛 Запуск тестирования из файла {INPUT_FILE}...")
    
    if not os.path.exists(INPUT_FILE):
        print(f"❌ КРИТИЧЕСКАЯ ОШИБКА: Файл '{INPUT_FILE}' не найден!")
        return

    try:
        with open(INPUT_FILE, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        
        if not lines:
            print(f"❌ КРИТИЧЕСКАЯ ОШИБКА: Файл '{INPUT_FILE}' пуст!")
            return
            
        print(f"✅ Файл прочитан. Строк найдено: {len(lines)}")

    except Exception as e:
        print(f"❌ Ошибка чтения файла: {e}")
        return

    try:
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as res_file:
            res_file.write(f"=== ОТЧЕТ ПО ТЕСТУ ===\n")
            res_file.write(f"Время запуска: {datetime.now().isoformat()}\n")
            res_file.write(f"Источник: {INPUT_FILE}\n")
            res_file.write("=" * 50 + "\n\n")

            prev_timestamp = None
            processed_count = 0

            for line_num, line in enumerate(lines, 1):
                line = line.strip()
                if not line or line.startswith('#'):
                    continue

                parts = line.split(',')
                if len(parts) != 4:
                    msg = f"❌ Строка {line_num}: Неверный формат.\n"
                    res_file.write(msg)
                    continue

                try:
                    lat = float(parts[0])
                    lon = float(parts[1])
                    weight = float(parts[2])
                    timestamp_str = parts[3].strip()
                    current_timestamp = datetime.fromisoformat(timestamp_str)
                except ValueError as e:
                    msg = f"❌ Строка {line_num}: Ошибка данных ({e})\n"
                    res_file.write(msg)
                    continue

                # Эмуляция времени
                if prev_timestamp:
                    delay = (current_timestamp - prev_timestamp).total_seconds()
                    if delay > 0:
                        wait_time = delay / 10.0 if delay > 60 else delay
                        if wait_time > 0.05:
                            print(f"⏳ Строка {line_num}: Пауза {wait_time:.2f} сек...")
                            time.sleep(wait_time)

                prev_timestamp = current_timestamp

                payload = {
                    "latitude": lat,
                    "longitude": lon,
                    "weight": weight,
                    "timestamp": timestamp_str
                }

                print(f"📡 Строка {line_num}: Отправка [W={weight}]...")
                
                log_entry = f"--- Строка {line_num} ---\n"
                log_entry += f"Входные данные: {json.dumps(payload, ensure_ascii=False)}\n"
                
                try:
                    # 1. Отправляем телеметрию
                    resp_post = requests.post(f"{BASE_URL}/telemetry", json=payload, timeout=5)
                    
                    log_entry += f"\n[Ответ сервера на /telemetry]\n"
                    if resp_post.status_code == 200:
                        telemetry_data = resp_post.json()
                        log_entry += f"Статус HTTP: {resp_post.status_code}\n"
                        log_entry += f"Тело ответа: {json.dumps(telemetry_data, indent=2, ensure_ascii=False)}\n"
                        
                        status_val = telemetry_data.get('status', '')
                        if status_val in ['batch_started', 'batch_completed']:
                            print(f"   ✅ Событие: {status_val}")
                    else:
                        log_entry += f"Статус HTTP: {resp_post.status_code}\n"
                        log_entry += f"Ошибка: {resp_post.text}\n"

                    # 2. ЗАПРОС СТАТУСА (Чтобы получить violations из getCurrentStatus)
                    log_entry += f"\n[Текущий статус Batch (/batch/status)]\n"
                    resp_status = requests.get(f"{BASE_URL}/batch/status", timeout=5)
                    
                    if resp_status.status_code == 200:
                        status_data = resp_status.json()
                        log_entry += f"Статус HTTP: {resp_status.status_code}\n"
                        # Записываем ПОЛНЫЙ ответ функции getCurrentStatus()
                        log_entry += f"Полный объект статуса: {json.dumps(status_data, indent=2, ensure_ascii=False)}\n"
                        
                        # Вывод нарушений в консоль для наглядности
                        violations = status_data.get('violations', [])
                        if violations:
                            print(f"   ⚠️ Нарушения: {violations}")
                        else:
                            print(f"   ✨ Нарушений нет.")
                            
                    elif resp_status.status_code == 404:
                        log_entry += f"Статус HTTP: 404\n"
                        log_entry += f"Сообщение: Нет активного батча\n"
                        print(f"   ⚪ Активного батча нет.")
                    else:
                        log_entry += f"Статус HTTP: {resp_status.status_code}\n"
                        log_entry += f"Ошибка: {resp_status.text}\n"

                except requests.exceptions.RequestException as e:
                    log_entry += f"Ошибка сети: {e}\n"
                    print(f"   ❌ Ошибка сети: {e}")
                except Exception as e:
                    log_entry += f"Неизвестная ошибка: {e}\n"
                    print(f"   ❌ Ошибка: {e}")

                res_file.write(log_entry + "\n" + "="*30 + "\n\n")
                processed_count += 1
            
            res_file.write("\n=== ТЕСТ ЗАВЕРШЕН ===\n")
            res_file.write(f"Обработано строк: {processed_count}\n")
            res_file.write(f"Время окончания: {datetime.now().isoformat()}\n")

        print(f"\n✅ Тестирование завершено. Обработано строк: {processed_count}")
        print(f"Результаты сохранены в {OUTPUT_FILE}")

    except Exception as e:
        print(f"❌ Критическая ошибка при записи результата: {e}")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n👋 Тест прерван пользователем.")