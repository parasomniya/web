-- Telemetry settings singleton
CREATE TABLE "TelemetrySettings" (
    "id" INTEGER NOT NULL PRIMARY KEY,
    "batchStartThresholdKg" INTEGER NOT NULL DEFAULT 30,
    "leftoverThresholdKg" INTEGER NOT NULL DEFAULT 50,
    "unloadDropThresholdKg" INTEGER NOT NULL DEFAULT 200,
    "unloadMinPeakKg" INTEGER NOT NULL DEFAULT 400,
    "unloadUpdateDeltaKg" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "TelemetrySettings" (
    "id",
    "batchStartThresholdKg",
    "leftoverThresholdKg",
    "unloadDropThresholdKg",
    "unloadMinPeakKg",
    "unloadUpdateDeltaKg",
    "updatedAt"
) VALUES (
    1,
    30,
    50,
    200,
    400,
    1,
    CURRENT_TIMESTAMP
);

-- Violation journal
CREATE TABLE "Violation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "batchId" INTEGER,
    "deviceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "componentKey" TEXT NOT NULL DEFAULT '',
    "componentName" TEXT,
    "message" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'BUSINESS',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "source" TEXT NOT NULL DEFAULT 'system',
    "planWeight" REAL,
    "actualWeight" REAL,
    "deviation" REAL,
    "deviationPercent" REAL,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "comment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Violation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Violation_batchId_code_componentKey_key" ON "Violation"("batchId", "code", "componentKey");
CREATE INDEX "Violation_deviceId_detectedAt_idx" ON "Violation"("deviceId", "detectedAt");
CREATE INDEX "Violation_status_detectedAt_idx" ON "Violation"("status", "detectedAt");

-- Technical warning journal
CREATE TABLE "TechnicalWarning" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "scopeKey" TEXT NOT NULL,
    "deviceId" TEXT,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "detailsJson" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "TechnicalWarning_scopeKey_code_key" ON "TechnicalWarning"("scopeKey", "code");
CREATE INDEX "TechnicalWarning_status_lastSeenAt_idx" ON "TechnicalWarning"("status", "lastSeenAt");

-- Telemetry indexes
CREATE INDEX "Telemetry_deviceId_timestamp_idx" ON "Telemetry"("deviceId", "timestamp");
CREATE INDEX "Telemetry_timestamp_idx" ON "Telemetry"("timestamp");
CREATE INDEX "RtkTelemetry_deviceId_timestamp_idx" ON "RtkTelemetry"("deviceId", "timestamp");
CREATE INDEX "RtkTelemetry_timestamp_idx" ON "RtkTelemetry"("timestamp");
