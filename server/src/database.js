// src/database.js
import "dotenv/config"
import { PrismaClient } from './generated/client.ts' 
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || "file:./dev.db",
})

const prisma = new PrismaClient({ adapter })

// 🔥 Функция конвертации в UTC+7
export function toUTC7(date) {
  const d = new Date(date)
  const utcMs = d.getTime() + (d.getTimezoneOffset() * 60 * 1000)
  return new Date(utcMs + 7 * 60 * 60 * 1000)
}

export default prisma