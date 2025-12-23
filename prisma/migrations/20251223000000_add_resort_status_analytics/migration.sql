-- CreateTable
CREATE TABLE "ResortStatusAnalytics" (
    "id" TEXT NOT NULL,
    "resortId" TEXT NOT NULL,
    "resortName" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "statusInfo" JSONB NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResortStatusAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResortStatusAnalytics_resortId_idx" ON "ResortStatusAnalytics"("resortId");

-- CreateIndex
CREATE INDEX "ResortStatusAnalytics_assetType_idx" ON "ResortStatusAnalytics"("assetType");

-- CreateIndex
CREATE INDEX "ResortStatusAnalytics_collectedAt_idx" ON "ResortStatusAnalytics"("collectedAt");

-- CreateIndex
CREATE INDEX "ResortStatusAnalytics_resortId_assetType_collectedAt_idx" ON "ResortStatusAnalytics"("resortId", "assetType", "collectedAt");
