ALTER TABLE "StorageZone" ADD COLUMN "shapeType" TEXT NOT NULL DEFAULT 'CIRCLE';
ALTER TABLE "StorageZone" ADD COLUMN "sideMeters" REAL;
ALTER TABLE "StorageZone" ADD COLUMN "polygonCoords" TEXT;
ALTER TABLE "StorageZone" ADD COLUMN "squareMinLat" REAL;
ALTER TABLE "StorageZone" ADD COLUMN "squareMinLon" REAL;
ALTER TABLE "StorageZone" ADD COLUMN "squareMaxLat" REAL;
ALTER TABLE "StorageZone" ADD COLUMN "squareMaxLon" REAL;
