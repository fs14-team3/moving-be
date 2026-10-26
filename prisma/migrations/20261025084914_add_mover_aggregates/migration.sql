-- AlterTable
ALTER TABLE "mover_profiles" ADD COLUMN     "average_rating" DECIMAL(3,2) NOT NULL DEFAULT 0,
ADD COLUMN     "confirmed_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "review_count" INTEGER NOT NULL DEFAULT 0;
