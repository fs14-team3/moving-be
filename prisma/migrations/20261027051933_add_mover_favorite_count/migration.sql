-- AlterTable
ALTER TABLE "mover_profiles" ADD COLUMN     "favorite_count" INTEGER NOT NULL DEFAULT 0,
ADD CONSTRAINT "mover_profiles_favorite_count_check" CHECK ("favorite_count" >= 0);
