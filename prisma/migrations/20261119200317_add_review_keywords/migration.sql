-- CreateEnum
CREATE TYPE "review_keyword_base_key" AS ENUM ('PUNCTUALITY', 'PACKING', 'HANDLING', 'EFFICIENCY', 'COMMUNICATION', 'PRICE', 'PROFESSIONALISM');

-- CreateEnum
CREATE TYPE "review_keyword_sentiment" AS ENUM ('POSITIVE', 'NEGATIVE', 'UNCLEAR');

-- CreateTable
CREATE TABLE "review_keywords" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "base_key" "review_keyword_base_key",
    "parent_base_key" "review_keyword_base_key",
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_keyword_mentions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "review_id" UUID NOT NULL,
    "keyword_id" UUID NOT NULL,
    "sentiment" "review_keyword_sentiment" NOT NULL,
    "evidence" TEXT NOT NULL,
    "start" INTEGER NOT NULL,
    "end" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_keyword_mentions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "review_keywords_name_key" ON "review_keywords"("name");

-- CreateIndex
CREATE UNIQUE INDEX "review_keywords_base_key_key" ON "review_keywords"("base_key");

-- CreateIndex
CREATE INDEX "review_keyword_mentions_keyword_id_review_id_idx" ON "review_keyword_mentions"("keyword_id", "review_id");

-- CreateIndex
CREATE UNIQUE INDEX "review_keyword_mentions_review_id_keyword_id_key" ON "review_keyword_mentions"("review_id", "keyword_id");

-- AddForeignKey
ALTER TABLE "review_keyword_mentions" ADD CONSTRAINT "review_keyword_mentions_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_keyword_mentions" ADD CONSTRAINT "review_keyword_mentions_keyword_id_fkey" FOREIGN KEY ("keyword_id") REFERENCES "review_keywords"("id") ON DELETE CASCADE ON UPDATE CASCADE;
