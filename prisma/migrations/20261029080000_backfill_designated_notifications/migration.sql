
-- 기존 지정알림이 일반 알람으로 오는 부분 변경

UPDATE "notifications" AS n
SET
  "type" = 'NEW_DESIGNATED_REQUEST'::notification_type,
  "payload" = n."payload" || jsonb_build_object(
    'customerName',
      COALESCE(
        NULLIF(u."name", ''),
        split_part(n."message", ' 고객님이 지정 견적을 요청했어요.', 1)
      ),
    'moveType', r."move_type",
    'moveDate', to_char(r."move_date", 'YYYY-MM-DD'),
    'fromRegion', r."from_region",
    'toRegion', r."to_region"
  )
FROM "move_requests" AS r
JOIN "users" AS u
  ON u."id" = r."customer_id"
JOIN "designated_requests" AS d
  ON d."move_request_id" = r."id"
WHERE n."move_request_id" = r."id"
  AND n."user_id" = d."mover_id"
  AND n."type" = 'NEW_REQUEST'::notification_type
  AND n."message" LIKE '% 고객님이 지정 견적을 요청했어요.';
