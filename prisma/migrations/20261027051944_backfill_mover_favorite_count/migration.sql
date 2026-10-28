UPDATE mover_profiles
SET favorite_count = (
  SELECT COUNT(*)
  FROM favorites
  WHERE favorites.mover_id = mover_profiles.user_id
);
