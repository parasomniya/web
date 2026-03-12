// src/index.js
import express from 'express'
import telemetryRouter from './modules/telemetry/telemetry.routes.js'
import storageZonesRouter from './modules/storage-zones/storage-zones.routes.js'
import { authMiddleware } from './middleware/auth.js'

const app = express()

app.use(express.json())

// Телеметрия (POST без токена, GET с токеном)
app.use('/api/telemetry', telemetryRouter)

// Зоны (только с токеном)
app.use('/api/storage-zones', authMiddleware, storageZonesRouter)

app.get("/", (req, res) => {
  res.send("Farm Server is running 🚀")
})

app.listen(3000, () => {
  console.log("Server is running on port 3000")
})