// src/database.js
import "dotenv/config"
import { PrismaClient } from '@prisma/client'  // ← из пакета, не из generated/
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || "file:./dev.db",
})

const prisma = new PrismaClient({ adapter })

export default prisma