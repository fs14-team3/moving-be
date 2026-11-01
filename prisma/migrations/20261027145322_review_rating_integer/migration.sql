ALTER TABLE reviews ALTER COLUMN rating TYPE INTEGER USING ROUND(rating)::INTEGER;

WITH review_stats AS (
  SELECT q.mover_id, ROUND(AVG(r.rating), 2) AS average_rating
  FROM reviews r
  JOIN quotes q ON q.id = r.quote_id
  GROUP BY q.mover_id
)
UPDATE mover_profiles AS target
SET average_rating = r.average_rating
FROM review_stats r
WHERE target.user_id = r.mover_id;

ALTER TABLE reviews ADD CONSTRAINT reviews_rating_check CHECK (rating BETWEEN 1 AND 5);
