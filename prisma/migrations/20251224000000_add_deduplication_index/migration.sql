-- CreateIndex
-- This index enables efficient lookup of the latest status for each asset during deduplication
CREATE INDEX "ResortStatusAnalytics_resortId_assetType_assetId_idx" ON "ResortStatusAnalytics"("resortId", "assetType", "assetId");
