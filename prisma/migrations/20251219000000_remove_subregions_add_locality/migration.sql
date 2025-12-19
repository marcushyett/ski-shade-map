-- DropForeignKey
ALTER TABLE "Run" DROP CONSTRAINT IF EXISTS "Run_subRegionId_fkey";

-- DropForeignKey
ALTER TABLE "Lift" DROP CONSTRAINT IF EXISTS "Lift_subRegionId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "Run_subRegionId_idx";

-- DropIndex
DROP INDEX IF EXISTS "Lift_subRegionId_idx";

-- AlterTable: Add locality column to Run
ALTER TABLE "Run" ADD COLUMN "locality" TEXT;

-- AlterTable: Add locality column to Lift
ALTER TABLE "Lift" ADD COLUMN "locality" TEXT;

-- AlterTable: Drop subRegionId from Run
ALTER TABLE "Run" DROP COLUMN IF EXISTS "subRegionId";

-- AlterTable: Drop subRegionId from Lift
ALTER TABLE "Lift" DROP COLUMN IF EXISTS "subRegionId";

-- DropTable
DROP TABLE IF EXISTS "SubRegion";

-- CreateIndex
CREATE INDEX "Run_locality_idx" ON "Run"("locality");

-- CreateIndex
CREATE INDEX "Lift_locality_idx" ON "Lift"("locality");
