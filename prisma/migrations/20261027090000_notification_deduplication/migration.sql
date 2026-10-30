-- 이사 요청 관련 알림 중복 방지
CREATE UNIQUE INDEX "notifications_request_event_once_uq"
ON "notifications" ("user_id", "type", "move_request_id")
WHERE "move_request_id" IS NOT NULL
  AND "type" IN (
    'NEW_REQUEST'::notification_type,
    'NEW_DESIGNATED_REQUEST'::notification_type,
    'MOVE_DAY'::notification_type
  );

-- 견적 관련 알림 중복 방지
CREATE UNIQUE INDEX "notifications_quote_event_once_uq"
ON "notifications" ("user_id", "type", "quote_id")
WHERE "quote_id" IS NOT NULL
  AND "type" IN (
    'NEW_QUOTE'::notification_type,
    'QUOTE_CONFIRMED'::notification_type
  );