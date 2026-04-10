  import express from 'express'
  import cors from 'cors'
  import path from 'path'
  import { fileURLToPath } from 'url'
  import jwt from 'jsonwebtoken'
  import telemetryRouter from './modules/telemetry/telemetry.routes.js'
  import storageZonesRouter from './modules/storage-zones/storage-zones.routes.js'
  import eventsRouter from './modules/events/events.routes.js'
  import { authenticate, requireAdmin, requireDirectorOrAdmin, requireReadAccess, requireWriteAccess } from './middleware/auth.js'
  import authRouter from './modules/auth/auth.routes.js'
  import rationsRouter from './modules/rations/rations.routes.js'
  import prisma from './database.js'
  import batchesRoutes from './modules/batches/batches.routes.js'
  import usersRoutes from './modules/users/users.routes.js';

  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)

  const app = express()
  const PORT = process.env.PORT || 3000

  const SECRET_KEY = process.env.JWT_SECRET || 'super_secret_farm_key_123'

  app.use(cors({
    origin: true, // Разрешает запросы с любых адресов (для разработки самое то)
    credentials: true // Обязательно, чтобы пропускать токены и куки (у тебя там res.cookie)
  }));

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

  // Телеметрия: POST открыт для всех, GET защищен
  app.use('/api/telemetry/host', telemetryRouter)

  // Зоны: разделяем доступ по ролям
  app.use('/api/telemetry/zones', authenticate, storageZonesRouter)

  // События: только админ
  app.use('/api/events', authenticate, requireAdmin, eventsRouter)

  // Рационы: разделяем доступ по ролям
  app.use('/api/rations', authenticate, rationsRouter)

  // Замесы: доступно всем авторизованным (гость может только смотреть, админ/директор - управлять)
  app.use('/api/batches', authenticate, requireReadAccess, batchesRoutes)

  app.use('/api/users', authenticate, requireAdmin, usersRoutes);

  // Static Frontend
  const frontendPath = path.resolve(__dirname, '../../frontend')

  // Middleware для защиты telemetry.html (должен быть ДО express.static)
  app.use('/telemetry.html', (req, res, next) => {
    // Проверяем авторизацию через заголовки
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).send('Доступ запрещен: требуется авторизация');
    }

    const token = authHeader.split(' ')[1];
    
    try {
      const decoded = jwt.verify(token, SECRET_KEY);
      // Проверяем, что пользователь ADMIN
      if (decoded.role !== 'ADMIN') {
        return res.status(403).send('Доступ запрещен: только для администраторов');
      }
      next();
    } catch (error) {
      return res.status(403).send('Неверный или просроченный токен');
    }
  });

  // Статические файлы (после middleware защиты)
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