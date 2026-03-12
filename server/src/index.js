// src/index.js
import express from 'express'
import telemetryRouter from './modules/telemetry/telemetry.routes.js'

const app = express()

// Middleware для JSON
app.use(express.json())

// Подключение роутов
app.use('/api/telemetry', telemetryRouter)

// Проверка сервера
app.get("/", (req, res) => {
  res.send("Server is running")
})

app.listen(3000, () => {
  console.log("Server is running on port 3000")
})