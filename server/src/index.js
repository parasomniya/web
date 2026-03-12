import express from 'express'
import telemetryRouter from './modules/telemetry/telemetry.routes.js'
import { authMiddleware } from './middleware/auth.js'

const app = express()

app.use(express.json())

// Защити GET-запросы (POST оставь открытым для устройства)
app.use('/api/telemetry', authMiddleware, telemetryRouter)

// Или защити только GET:
// app.get('/api/telemetry', authMiddleware, ...)

app.get("/", (req, res) => {
  res.send("Farm Server is running 🚀")
})

app.listen(3000, () => {
  console.log("Server is running on port 3000")
})