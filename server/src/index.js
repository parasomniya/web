import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import telemetryRouter from './modules/telemetry/telemetry.routes.js'
import storageZonesRouter from './modules/storage-zones/storage-zones.routes.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

// API
app.use('/api/telemetry/host', telemetryRouter)
app.use('/api/telemetry/zones', storageZonesRouter)

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
  console.log(`🚀 Server & Website running on http://100.113.151.27:${PORT}`)
})
