-- CreateTable
CREATE TABLE "review_summaries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mover_id" UUID NOT NULL,
    "review_count" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "aspects" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "review_summaries_mover_id_key" ON "review_summaries"("mover_id");

-- AddForeignKey
ALTER TABLE "review_summaries" ADD CONSTRAINT "review_summaries_mover_id_fkey" FOREIGN KEY ("mover_id") REFERENCES "mover_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
