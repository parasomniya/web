// emulator.js
// Запускать командой: node emulator.js

const SERVER_URL = 'http://127.0.0.1:3000/api/telemetry/host';
const DEVICE_ID = 'host_emulator_99';

// ⚠️ ВАЖНО: Убедись, что эти координаты совпадают с твоими зонами в БД
const COORDS = {
    SILOS: { lat: 52.529477, lon: 85.129503 }, // Координаты кургана (Силос)
    SENO:  { lat: 52.526860, lon: 85.124611 }, // Координаты сена
    FIELD: { lat: 52.529582, lon: 85.118646 }  // Координаты вне зон (поле/коровник)
};

// ХИТРЫЙ СЦЕНАРИЙ ПОЕЗДКИ
const scenario = [
    { ...COORDS.FIELD, weight: 10,   msg: "🚜 1. Трактор запущен в поле (Вес: 10 кг)" },
    
    // Обычная загрузка
    { ...COORDS.SILOS, weight: 15,   msg: "📍 2. Заехали в 'Силос'" },
    { ...COORDS.SILOS, weight: 1000, msg: "⏳ 3. Грузим силос... (Вес: 1000 кг)" },
    { ...COORDS.SILOS, weight: 1500, msg: "✅ 4. Закончили с силосом (Вес: 1500 кг)" },
    
    // Выехали из зоны и грузим добавки ВНЕ ЗОНЫ (Проверка новой фичи)
    { ...COORDS.FIELD, weight: 1500, msg: "🚜 5. Выехали в чистое поле..." },
    { ...COORDS.FIELD, weight: 2000, msg: "⚠️ 6. Закинули премиксы ВНЕ ЗОНЫ лопатой! (Вес: 2000 кг)" },
    
    // Заехали в Сено (Тут сервер должен сохранить "Вне зоны: 500 кг")
    { ...COORDS.SENO,  weight: 2000, msg: "📍 7. Заехали в 'Сено'" },
    { ...COORDS.SENO,  weight: 3000, msg: "✅ 8. Загрузили сено (Вес: 3000 кг)" },
    
    // Едем на выгрузку
    { ...COORDS.FIELD, weight: 3000, msg: "🚜 9. Едем в коровник на выгрузку... (Пик: 3000 кг)" },
    
    // ЧАСТИЧНАЯ ВЫГРУЗКА
    { ...COORDS.FIELD, weight: 2000, msg: "📉 10. Скинули 1000 кг коровам..." },
    { ...COORDS.FIELD, weight: 1500, msg: "📉 11. Скинули еще 500 кг... (Остаток: 1500 кг)" },
    
    // ВНЕЗАПНЫЙ ВОЗВРАТ НА ЗАГРУЗКУ С ОСТАТКОМ (Проверка защиты от "недовыгрузки")
    { ...COORDS.SILOS, weight: 1500, msg: "🔄 12. Тракторист передумал и поехал обратно в 'Силос' с остатком!" },
    { ...COORDS.SILOS, weight: 1700, msg: "🚨 13. Начал грузить... (Тут сервер должен закрыть старый замес и начать новый)" },
    { ...COORDS.SILOS, weight: 2500, msg: "✅ 14. Догрузил силос поверх остатка (Вес: 2500 кг)" },
    
    // ФИНАЛЬНАЯ ПОЛНАЯ ВЫГРУЗКА
    { ...COORDS.FIELD, weight: 2500, msg: "🚜 15. Снова едем в коровник..." },
    { ...COORDS.FIELD, weight: 1000, msg: "📉 16. Выгружаем..." },
    { ...COORDS.FIELD, weight: 45,   msg: "🏁 17. Полная выгрузка завершена! (Кузов пуст)" }
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runEmulator() {
    console.log(`\n🚀 Запуск эмулятора трактора (${DEVICE_ID})...\n`);
    
    for (const step of scenario) {
        console.log(step.msg);
        
        try {
            const response = await fetch(SERVER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    device_id: DEVICE_ID,
                    timestamp: new Date().toISOString(),
                    lat: step.lat,
                    lon: step.lon,
                    weight: step.weight,
                    gps_valid: true,
                    gps_satellites: 12,
                    gps_quality: 3,
                    weight_valid: true,
                    events_reader_ok: true
                })
            });
            
            if (!response.ok) {
                console.error("❌ Ошибка сервера:", await response.text());
            }
        } catch (error) {
            console.error("❌ Ошибка отправки:", error.message);
        }

        // Ждем 3 секунды, чтобы ты успевал смотреть в консоль сервера
        await sleep(3000); 
    }
    
    console.log("\n🛑 Эмуляция завершена.");
}

runEmulator();