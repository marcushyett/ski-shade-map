-- CreateTable
CREATE TABLE "SkiArea" (
    "id" TEXT NOT NULL,
    "osmId" TEXT,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "region" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "bounds" JSONB,
    "geometry" JSONB,
    "properties" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkiArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "osmId" TEXT,
    "name" TEXT,
    "difficulty" TEXT,
    "status" TEXT,
    "geometry" JSONB NOT NULL,
    "properties" JSONB,
    "skiAreaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lift" (
    "id" TEXT NOT NULL,
    "osmId" TEXT,
    "name" TEXT,
    "liftType" TEXT,
    "status" TEXT,
    "capacity" INTEGER,
    "geometry" JSONB NOT NULL,
    "properties" JSONB,
    "skiAreaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSync" (
    "id" TEXT NOT NULL,
    "dataType" TEXT NOT NULL,
    "lastSync" TIMESTAMP(3) NOT NULL,
    "recordCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SkiArea_osmId_key" ON "SkiArea"("osmId");

-- CreateIndex
CREATE INDEX "SkiArea_country_idx" ON "SkiArea"("country");

-- CreateIndex
CREATE INDEX "SkiArea_name_idx" ON "SkiArea"("name");

-- CreateIndex
CREATE INDEX "SkiArea_latitude_longitude_idx" ON "SkiArea"("latitude", "longitude");

-- CreateIndex
CREATE UNIQUE INDEX "Run_osmId_key" ON "Run"("osmId");

-- CreateIndex
CREATE INDEX "Run_skiAreaId_idx" ON "Run"("skiAreaId");

-- CreateIndex
CREATE INDEX "Run_difficulty_idx" ON "Run"("difficulty");

-- CreateIndex
CREATE UNIQUE INDEX "Lift_osmId_key" ON "Lift"("osmId");

-- CreateIndex
CREATE INDEX "Lift_skiAreaId_idx" ON "Lift"("skiAreaId");

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_skiAreaId_fkey" FOREIGN KEY ("skiAreaId") REFERENCES "SkiArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lift" ADD CONSTRAINT "Lift_skiAreaId_fkey" FOREIGN KEY ("skiAreaId") REFERENCES "SkiArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
