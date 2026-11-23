-- CreateEnum
CREATE TYPE "service_level" AS ENUM ('BASIC', 'HALF_PACKING', 'FULL_PACKING');

-- CreateEnum
CREATE TYPE "building_type" AS ENUM ('APARTMENT', 'VILLA', 'OFFICETEL', 'HOUSE', 'COMMERCIAL');

-- CreateEnum
CREATE TYPE "area_range" AS ENUM ('UNDER_10', 'TENS', 'TWENTIES', 'THIRTIES', 'OVER_40');

-- CreateEnum
CREATE TYPE "box_range" AS ENUM ('UP_TO_10', 'UP_TO_20', 'UP_TO_30', 'UP_TO_50', 'OVER_50');

-- AlterTable
ALTER TABLE "move_requests" ADD COLUMN     "area_range" "area_range",
ADD COLUMN     "box_range" "box_range",
ADD COLUMN     "from_building_type" "building_type",
ADD COLUMN     "from_can_park" BOOLEAN,
ADD COLUMN     "from_floor" INTEGER,
ADD COLUMN     "from_has_elevator" BOOLEAN,
ADD COLUMN     "memo" TEXT,
ADD COLUMN     "resident_count" INTEGER,
ADD COLUMN     "service_level" "service_level",
ADD COLUMN     "to_building_type" "building_type",
ADD COLUMN     "to_can_park" BOOLEAN,
ADD COLUMN     "to_floor" INTEGER,
ADD COLUMN     "to_has_elevator" BOOLEAN;

-- CreateTable
CREATE TABLE "move_request_items" (
    "move_request_id" UUID NOT NULL,
    "item" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "move_request_items_pkey" PRIMARY KEY ("move_request_id","item")
);

-- AddForeignKey
ALTER TABLE "move_request_items" ADD CONSTRAINT "move_request_items_move_request_id_fkey" FOREIGN KEY ("move_request_id") REFERENCES "move_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
