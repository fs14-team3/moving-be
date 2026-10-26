WITH review_stats AS (
  SELECT q.mover_id, COUNT(*) AS review_count, ROUND(AVG(r.rating), 2) AS average_rating
  FROM reviews r
  JOIN quotes q ON q.id = r.quote_id
  GROUP BY q.mover_id
), confirmed_stats AS (
  SELECT mover_id, COUNT(*) AS confirmed_count
  FROM quotes
  WHERE status = 'CONFIRMED'
  GROUP BY mover_id
)
UPDATE mover_profiles AS target
SET review_count = COALESCE(r.review_count, 0),
    average_rating = COALESCE(r.average_rating, 0),
    confirmed_count = COALESCE(c.confirmed_count, 0)
FROM mover_profiles AS source
LEFT JOIN review_stats r ON r.mover_id = source.user_id
LEFT JOIN confirmed_stats c ON c.mover_id = source.user_id
WHERE target.user_id = source.user_id;
