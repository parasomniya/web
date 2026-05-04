ALTER TABLE "TelemetrySettings" ADD COLUMN "anomalyThresholdKg" INTEGER NOT NULL DEFAULT 200;
ALTER TABLE "TelemetrySettings" ADD COLUMN "anomalyConfirmDeltaKg" INTEGER NOT NULL DEFAULT 40;
ALTER TABLE "TelemetrySettings" ADD COLUMN "anomalyConfirmPackets" INTEGER NOT NULL DEFAULT 3;
