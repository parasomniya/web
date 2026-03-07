import express from "express";
import prisma from "./database";

const app = express();
const PORT = 3000;

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello from server");
});

app.get("/ping", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/telemetry/host", async (req, res) => {
  try {
    const { timestamp, weight, lat, lon } = req.body;

    if (
      typeof timestamp !== "string" ||
      typeof weight !== "number" ||
      typeof lat !== "number" ||
      typeof lon !== "number"
    ) {
      return res.status(400).json({ message: "Invalid payload format" });
    }

    if (weight <= 0) {
      return res.status(400).json({ message: "weight must be > 0" });
    }

    const telemetry = await prisma.telemetry.create({
      data: {
        timestamp: new Date(timestamp),
        weight,
        lat,
        lon,
      },
    });

    res.status(201).json(telemetry);
  } 
  catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Проверка: получить все записи
app.get("/api/telemetry", async (req, res) => {
    const data = await prisma.telemetry.findMany();
    res.json(data);
  });