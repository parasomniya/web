/*
  Warnings:

  - Added the required column `deviceId` to the `Telemetry` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Telemetry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "timestamp" DATETIME NOT NULL,
    "deviceId" TEXT NOT NULL,
    "weight" REAL NOT NULL,
    "lat" REAL NOT NULL,
    "lon" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Telemetry" ("id", "lat", "lon", "timestamp", "weight") SELECT "id", "lat", "lon", "timestamp", "weight" FROM "Telemetry";
DROP TABLE "Telemetry";
ALTER TABLE "new_Telemetry" RENAME TO "Telemetry";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
