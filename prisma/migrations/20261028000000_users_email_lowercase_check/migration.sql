UPDATE "users" SET "email" = lower("email") WHERE "email" IS NOT NULL;
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase_check"
  CHECK ("email" IS NULL OR "email" = lower("email"));