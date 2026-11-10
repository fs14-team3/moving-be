/*
  Warnings:

  - A unique constraint covering the columns `[quote_id]` on the table `reviews` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "reviews_quote_id_key" ON "reviews"("quote_id");
