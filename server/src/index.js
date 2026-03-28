import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import telemetryRouter from './modules/telemetry/telemetry.routes.js'
import storageZonesRouter from './modules/storage-zones/storage-zones.routes.js'
import eventsRouter from './modules/events/events.routes.js'
import { authenticate, requireAdmin, requireDirectorOrAdmin } from './middleware/auth.js'
import authRouter from './modules/auth/auth.routes.js'
import rationsRouter from './modules/rations/rations.routes.js'
import prisma from './database.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

// Healthcheck - быстрая проверка статуса
app.get('/api/health', async (req, res) => {
  try {
    // Делаем легкий запрос к базе, чтобы убедиться, что Prisma жива
    await prisma.$queryRaw`SELECT 1`;
    
    // Формируем красивый ответ
    res.json({
      status: 'ok',
      message: 'Сервер работает нормально',
      uptime: Math.floor(process.uptime()) + ' секунд',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Healthcheck Error]: База данных недоступна', error);
    res.status(503).json({ 
      status: 'error', 
      message: 'Сервер работает, но отвалилась база данных' 
    });
  }
});

// API
app.use('/api/auth', authRouter)
app.use('/api/telemetry/host', telemetryRouter) //любой 
app.use('/api/telemetry/zones', authenticate, requireDirectorOrAdmin, storageZonesRouter) // Директор и выше
app.use('/api/events', authenticate, requireAdmin, eventsRouter) // Только админ
app.use('/api/rations', authenticate, requireDirectorOrAdmin, rationsRouter)

// Static Frontend
const frontendPath = path.resolve(__dirname, '../../frontend')
app.use(express.static(frontendPath))

// Главная страница
app.get('/', (req, res) => { //любой
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
//app.listen(PORT, () => {
  // console.log(`Server is running on port ${PORT}`)
  // console.log(`http://localhost:${PORT}`)
  // console.log(`POST: http://localhost:${PORT}/api/telemetry/host`)
  // console.log(`GET:  http://localhost:${PORT}/api/telemetry/host/latest`)
  // console.log(`GET:  http://localhost:${PORT}/api/telemetry/host/history`)
  // console.log(`GET:  http://localhost:${PORT}/api/telemetry/zones`)
//})
