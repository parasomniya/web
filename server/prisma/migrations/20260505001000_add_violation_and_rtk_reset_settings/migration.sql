ALTER TABLE "TelemetrySettings" ADD COLUMN "deviationPercentThreshold" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "TelemetrySettings" ADD COLUMN "deviationMinKgThreshold" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "TelemetrySettings" ADD COLUMN "rtkTrackResetTime" TEXT NOT NULL DEFAULT '03:00';
