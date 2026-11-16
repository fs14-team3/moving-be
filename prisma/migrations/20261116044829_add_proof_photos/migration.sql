-- CreateTable
CREATE TABLE "proof_photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quote_id" UUID NOT NULL,
    "image_key" TEXT NOT NULL,
    "thumbnail_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proof_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "proof_photos_image_key_key" ON "proof_photos"("image_key");

-- CreateIndex
CREATE INDEX "proof_photos_quote_id_created_at_id_idx" ON "proof_photos"("quote_id", "created_at", "id");

-- AddForeignKey
ALTER TABLE "proof_photos" ADD CONSTRAINT "proof_photos_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

