/*
  Warnings:

  - You are about to drop the column `createdAt` on the `Telemetry` table. All the data in the column will be lost.
  - You are about to drop the column `passwordHash` on the `User` table. All the data in the column will be lost.
  - Added the required column `password` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "DeviceEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "deviceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "fromNumber" TEXT NOT NULL,
    "text" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Ration" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RationIngredient" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "rationId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "plannedWeight" REAL NOT NULL,
    "dryMatterWeight" REAL NOT NULL,
    CONSTRAINT "RationIngredient_rationId_fkey" FOREIGN KEY ("rationId") REFERENCES "Ration" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Telemetry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "deviceId" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "lat" REAL NOT NULL,
    "lon" REAL NOT NULL,
    "gpsValid" BOOLEAN NOT NULL DEFAULT false,
    "gpsSatellites" INTEGER NOT NULL DEFAULT 0,
    "weight" REAL NOT NULL,
    "weightValid" BOOLEAN NOT NULL DEFAULT false,
    "gpsQuality" INTEGER NOT NULL DEFAULT 0,
    "wifiClients" TEXT,
    "cpuTempC" REAL,
    "lteRssiDbm" INTEGER,
    "lteAccessTech" TEXT,
    "eventsReaderOk" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_Telemetry" ("deviceId", "id", "lat", "lon", "timestamp", "weight") SELECT "deviceId", "id", "lat", "lon", "timestamp", "weight" FROM "Telemetry";
DROP TABLE "Telemetry";
ALTER TABLE "new_Telemetry" RENAME TO "Telemetry";
CREATE TABLE "new_User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'GUEST',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("createdAt", "id", "role", "username") SELECT "createdAt", "id", "role", "username" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
