-- CreateTable
CREATE TABLE "Telemetry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "timestamp" DATETIME NOT NULL,
    "weight" REAL NOT NULL,
    "lat" REAL NOT NULL,
    "lon" REAL NOT NULL
);
