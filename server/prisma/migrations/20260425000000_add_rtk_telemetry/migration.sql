-- CreateTable
CREATE TABLE "RtkTelemetry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "deviceId" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "lat" REAL NOT NULL,
    "lon" REAL NOT NULL,
    "rtkQuality" TEXT,
    "rtkAge" REAL,
    "speed" REAL,
    "course" REAL,
    "supplyVoltage" REAL,
    "satellites" INTEGER,
    "fixType" TEXT,
    "rawPayload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "RtkTelemetry_deviceId_timestamp_idx" ON "RtkTelemetry"("deviceId", "timestamp");

-- CreateIndex
CREATE INDEX "RtkTelemetry_timestamp_idx" ON "RtkTelemetry"("timestamp");
