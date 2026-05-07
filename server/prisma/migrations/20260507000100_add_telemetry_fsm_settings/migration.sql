ALTER TABLE "TelemetrySettings"
ADD COLUMN "unloadWeightBufferKg" INTEGER NOT NULL DEFAULT 50;

ALTER TABLE "TelemetrySettings"
ADD COLUMN "emptyVehicleThresholdKg" INTEGER NOT NULL DEFAULT 50;

ALTER TABLE "TelemetrySettings"
ADD COLUMN "loadingZoneStickySeconds" INTEGER NOT NULL DEFAULT 180;

ALTER TABLE "TelemetrySettings"
ADD COLUMN "zoneChangeDebounceMs" INTEGER NOT NULL DEFAULT 3000;

ALTER TABLE "TelemetrySettings"
ADD COLUMN "autoCloseZeroWeightKg" INTEGER NOT NULL DEFAULT 10;

ALTER TABLE "TelemetrySettings"
ADD COLUMN "autoCloseEmptyStreak" INTEGER NOT NULL DEFAULT 5;

ALTER TABLE "TelemetrySettings"
ADD COLUMN "autoCloseNegativeStreak" INTEGER NOT NULL DEFAULT 3;

ALTER TABLE "TelemetrySettings"
ADD COLUMN "modeUnloadDropHintKg" INTEGER NOT NULL DEFAULT 30;

ALTER TABLE "TelemetrySettings"
ADD COLUMN "modeLoadingDeltaHintKg" INTEGER NOT NULL DEFAULT 5;
