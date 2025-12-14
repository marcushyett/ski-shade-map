-- AlterTable
ALTER TABLE "Lift" ADD COLUMN     "subRegionId" TEXT;

-- AlterTable
ALTER TABLE "Run" ADD COLUMN     "subRegionId" TEXT;

-- CreateTable
CREATE TABLE "SubRegion" (
    "id" TEXT NOT NULL,
    "osmId" TEXT,
    "name" TEXT NOT NULL,
    "geometry" JSONB,
    "bounds" JSONB,
    "centroid" JSONB,
    "skiAreaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubRegion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkiAreaConnection" (
    "id" TEXT NOT NULL,
    "fromAreaId" TEXT NOT NULL,
    "toAreaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkiAreaConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubRegion_osmId_key" ON "SubRegion"("osmId");

-- CreateIndex
CREATE INDEX "SubRegion_skiAreaId_idx" ON "SubRegion"("skiAreaId");

-- CreateIndex
CREATE INDEX "SubRegion_name_idx" ON "SubRegion"("name");

-- CreateIndex
CREATE INDEX "SkiAreaConnection_fromAreaId_idx" ON "SkiAreaConnection"("fromAreaId");

-- CreateIndex
CREATE INDEX "SkiAreaConnection_toAreaId_idx" ON "SkiAreaConnection"("toAreaId");

-- CreateIndex
CREATE UNIQUE INDEX "SkiAreaConnection_fromAreaId_toAreaId_key" ON "SkiAreaConnection"("fromAreaId", "toAreaId");

-- CreateIndex
CREATE INDEX "Lift_subRegionId_idx" ON "Lift"("subRegionId");

-- CreateIndex
CREATE INDEX "Run_subRegionId_idx" ON "Run"("subRegionId");

-- AddForeignKey
ALTER TABLE "SubRegion" ADD CONSTRAINT "SubRegion_skiAreaId_fkey" FOREIGN KEY ("skiAreaId") REFERENCES "SkiArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkiAreaConnection" ADD CONSTRAINT "SkiAreaConnection_fromAreaId_fkey" FOREIGN KEY ("fromAreaId") REFERENCES "SkiArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkiAreaConnection" ADD CONSTRAINT "SkiAreaConnection_toAreaId_fkey" FOREIGN KEY ("toAreaId") REFERENCES "SkiArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_subRegionId_fkey" FOREIGN KEY ("subRegionId") REFERENCES "SubRegion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lift" ADD CONSTRAINT "Lift_subRegionId_fkey" FOREIGN KEY ("subRegionId") REFERENCES "SubRegion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
