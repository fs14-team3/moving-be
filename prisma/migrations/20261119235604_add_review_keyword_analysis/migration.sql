-- CreateTable
CREATE TABLE "review_keyword_analyses" (
    "review_id" UUID NOT NULL,
    "review_updated_at" TIMESTAMPTZ NOT NULL,
    "analyzed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_keyword_analyses_pkey" PRIMARY KEY ("review_id")
);

-- AddForeignKey
ALTER TABLE "review_keyword_analyses" ADD CONSTRAINT "review_keyword_analyses_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
