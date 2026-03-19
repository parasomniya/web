import pkg from '@prisma/client'
const { PrismaClient } = pkg

// Стандартная инициализация. Prisma сама возьмет DATABASE_URL из .env
const prisma = new PrismaClient()

// Проверка связи
prisma.$connect()
  .then(() => console.log('✅ Prisma connected to SQLite directly'))
  .catch(err => console.error('❌ Prisma connection error:', err))

export default prisma
