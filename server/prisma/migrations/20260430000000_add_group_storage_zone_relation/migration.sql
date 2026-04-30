ALTER TABLE "LivestockGroup" ADD COLUMN "storageZoneId" INTEGER;

CREATE INDEX "LivestockGroup_storageZoneId_idx" ON "LivestockGroup"("storageZoneId");
