import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import telemetryRouter from './modules/telemetry/telemetry.routes.js'
import storageZonesRouter from './modules/storage-zones/storage-zones.routes.js'
import eventsRouter from './modules/events/events.routes.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

// API
app.use('/api/telemetry/host', telemetryRouter)
app.use('/api/telemetry/zones', storageZonesRouter)
app.use('/api/events', eventsRouter)

// Static Frontend
const frontendPath = path.resolve(__dirname, '../../frontend')
app.use(express.static(frontendPath))

// Главная страница
app.get('/', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'))
})


// Для всех остальных путей (решение ошибки PathError)
app.get(/\/(.*)/, (req, res, next) => {
  if (req.url.startsWith('/api')) return next()
  res.sendFile(path.join(frontendPath, 'index.html'))
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server & Website running on http://127.0.0.1:${PORT}`)
})

// Запуск
app.listen(PORT, () => {
  // console.log(`Server is running on port ${PORT}`)
  // console.log(`http://localhost:${PORT}`)
  // console.log(`POST: http://localhost:${PORT}/api/telemetry/host`)
  // console.log(`GET:  http://localhost:${PORT}/api/telemetry/host/latest`)
  // console.log(`GET:  http://localhost:${PORT}/api/telemetry/host/history`)
  // console.log(`GET:  http://localhost:${PORT}/api/telemetry/zones`)
})
