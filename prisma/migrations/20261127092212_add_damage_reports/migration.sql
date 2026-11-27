-- AlterEnum
ALTER TYPE "notification_type" ADD VALUE 'DAMAGE_REPORTED';

-- CreateTable
CREATE TABLE "damage_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quote_id" UUID NOT NULL,
    "item_name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "damage_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "damage_photos" (
    "report_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "upload_id" UUID NOT NULL,
    "image_key" TEXT NOT NULL,
    "thumbnail_key" TEXT NOT NULL,

    CONSTRAINT "damage_photos_pkey" PRIMARY KEY ("report_id","position")
);

-- CreateIndex
CREATE INDEX "damage_reports_quote_id_created_at_id_idx" ON "damage_reports"("quote_id", "created_at", "id");

-- AddForeignKey
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_photos" ADD CONSTRAINT "damage_photos_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "damage_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
