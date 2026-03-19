// src/index.js
import express from 'express'
import cors from 'cors'
import telemetryRouter from './modules/telemetry/telemetry.routes.js'
import storageZonesRouter from './modules/storage-zones/storage-zones.routes.js'

const app = express()
const PORT = process.env.PORT || 3000

// Middleware
app.use(cors())
app.use(express.json())

// Роуты телеметрии
app.use('/api/telemetry/host', telemetryRouter)

// Роуты зон (для фронтенда)
app.use('/api/telemetry/zones', storageZonesRouter)

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'Farm Server is running 🚀' })
})

// Запуск
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
  console.log(`http://localhost:${PORT}`)
  console.log(`POST: http://localhost:${PORT}/api/telemetry/host`)
  console.log(`GET:  http://localhost:${PORT}/api/telemetry/host/latest`)
  console.log(`GET:  http://localhost:${PORT}/api/telemetry/host/history`)
  console.log(`GET:  http://localhost:${PORT}/api/telemetry/zones`)
})