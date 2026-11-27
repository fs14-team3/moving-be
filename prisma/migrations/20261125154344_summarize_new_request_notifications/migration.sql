BEGIN;

-- AlterTable
ALTER TABLE "mover_profiles" ADD COLUMN "new_requests_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "mover_profiles" AS mp
SET "new_requests_seen_at" = COALESCE(
  oldest."created_at" - INTERVAL '1 millisecond',
  (SELECT max("created_at") FROM "move_requests"),
  mp."new_requests_seen_at"
)
FROM "mover_profiles" AS self
LEFT JOIN (
  SELECT n."user_id", min(mr."created_at") AS "created_at"
  FROM "notifications" AS n
  JOIN "move_requests" AS mr ON mr."id" = n."move_request_id"
  WHERE n."type" = 'NEW_REQUEST'
    AND n."read_at" IS NULL
  GROUP BY n."user_id"
) AS oldest ON oldest."user_id" = self."user_id"
WHERE self."user_id" = mp."user_id";

DELETE FROM "notifications" WHERE "type" = 'NEW_REQUEST';

DROP INDEX "notifications_request_event_once_uq";
DROP INDEX "notifications_quote_event_once_uq";

-- AlterEnum
CREATE TYPE "notification_type_new" AS ENUM ('NEW_DESIGNATED_REQUEST', 'NEW_QUOTE', 'QUOTE_CONFIRMED', 'MOVE_DAY');
ALTER TABLE "notifications" ALTER COLUMN "type" TYPE "notification_type_new" USING ("type"::text::"notification_type_new");
ALTER TYPE "notification_type" RENAME TO "notification_type_old";
ALTER TYPE "notification_type_new" RENAME TO "notification_type";
DROP TYPE "notification_type_old";

-- CreateIndex
CREATE UNIQUE INDEX "notifications_request_event_once_uq"
ON "notifications" ("user_id", "type", "move_request_id")
WHERE "move_request_id" IS NOT NULL
  AND "type" IN (
    'NEW_DESIGNATED_REQUEST'::notification_type,
    'MOVE_DAY'::notification_type
  );

-- CreateIndex
CREATE UNIQUE INDEX "notifications_quote_event_once_uq"
ON "notifications" ("user_id", "type", "quote_id")
WHERE "quote_id" IS NOT NULL
  AND "type" IN (
    'NEW_QUOTE'::notification_type,
    'QUOTE_CONFIRMED'::notification_type
  );

-- CreateIndex
CREATE INDEX "move_requests_from_region_created_at_idx" ON "move_requests"("from_region", "created_at");

-- CreateIndex
CREATE INDEX "move_requests_to_region_created_at_idx" ON "move_requests"("to_region", "created_at");

COMMIT;
