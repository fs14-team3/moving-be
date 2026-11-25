-- CreateTable
CREATE TABLE "review_keyword_recoveries" (
    "review_id" UUID NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ,
    "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_keyword_recoveries_pkey" PRIMARY KEY ("review_id")
);

-- AddForeignKey
ALTER TABLE "review_keyword_recoveries" ADD CONSTRAINT "review_keyword_recoveries_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
