-- AlterEnum
ALTER TYPE "notification_type"
ADD VALUE 'NEW_DESIGNATED_REQUEST';

-- AlterTable
ALTER TABLE "notifications"
ALTER COLUMN "message" DROP NOT NULL,
ADD COLUMN "payload" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "read_at" TIMESTAMPTZ;

-- Preserve existing messages
UPDATE "notifications"
SET "payload" = jsonb_build_object(
  'legacyMessage', "message"
)
WHERE "message" IS NOT NULL;

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_id_idx"
ON "notifications"("user_id", "read_at", "created_at", "id");