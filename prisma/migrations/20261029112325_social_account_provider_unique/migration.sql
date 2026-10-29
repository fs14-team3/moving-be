/*
  Warnings:

  - A unique constraint covering the columns `[provider,provider_id]` on the table `social_accounts` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "social_accounts_provider_provider_id_key" ON "social_accounts"("provider", "provider_id");
