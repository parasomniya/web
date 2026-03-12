// src/database.js
import "dotenv/config"
import { PrismaClient } from './generated/client.ts'  // ← путь к сгенерированному клиенту
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || "file:./dev.db",
})

const prisma = new PrismaClient({ adapter })

export default prisma