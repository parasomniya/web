
const BASE = 'http://localhost:3000/api/telemetry/host'

async function runTests() {
  console.log('🧪 Запуск тестов API...\n')
  
  // Тест 1: POST
  console.log('1️⃣ POST /host')
  const postRes = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lat: 54.843243,
      lon: 83.088801,
      weight: 0,
      deviceId: 'test_01'
    })
  })
  const postData = await postRes.json()
  console.log(`   Статус: ${postRes.status} ${postRes.status === 201 ? '✅' : '❌'}`)
  console.log(`   Ответ: ${JSON.stringify(postData)}\n`)
  
  // Тест 2: GET /latest
  console.log('2️⃣ GET /latest')
  const latestRes = await fetch(`${BASE}/latest`)
  const latestData = await latestRes.json()
  console.log(`   Статус: ${latestRes.status} ${latestRes.status === 200 ? '✅' : '❌'}`)
  console.log(`   Ответ: ${JSON.stringify(latestData)}\n`)
  
  // Тест 3: GET /history
  console.log('3️⃣ GET /history')
  const historyRes = await fetch(`${BASE}/history?limit=5`)
  const historyData = await historyRes.json()
  console.log(`   Статус: ${historyRes.status} ${historyRes.status === 200 ? '✅' : '❌'}`)
  console.log(`   Записей: ${historyData.length}\n`)
  
  // Тест 4: GET /zones
  console.log('4️⃣ GET /zones')
  const zonesRes = await fetch('http://localhost:3000/api/telemetry/zones')
  const zonesData = await zonesRes.json()
  console.log(`   Статус: ${zonesRes.status} ${zonesRes.status === 200 ? '✅' : '❌'}`)
  console.log(`   Зон: ${zonesData.length}\n`)
  
  console.log('✅ Все тесты завершены!')
}

runTests().catch(console.error)