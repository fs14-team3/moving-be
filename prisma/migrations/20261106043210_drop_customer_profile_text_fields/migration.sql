/*
  Warnings:

  - You are about to drop the column `career_years` on the `customer_profiles` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `customer_profiles` table. All the data in the column will be lost.
  - You are about to drop the column `intro` on the `customer_profiles` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "customer_profiles" DROP COLUMN "career_years",
DROP COLUMN "description",
DROP COLUMN "intro";