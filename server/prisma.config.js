// prisma.config.js
import "dotenv/config"
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    provider: "sqlite",
    url: env("DATABASE_URL"),
  },
})