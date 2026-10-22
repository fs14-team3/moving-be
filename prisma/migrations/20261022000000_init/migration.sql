-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('CUSTOMER', 'MOVER');

-- CreateEnum
CREATE TYPE "social_provider" AS ENUM ('GOOGLE', 'KAKAO', 'NAVER');

-- CreateEnum
CREATE TYPE "service_type" AS ENUM ('SMALL', 'HOME', 'OFFICE');

-- CreateEnum
CREATE TYPE "move_request_status" AS ENUM ('PENDING', 'CONFIRMED', 'COMPLETED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "quote_status" AS ENUM ('SUBMITTED', 'CONFIRMED', 'NOT_SELECTED');

-- CreateEnum
CREATE TYPE "notification_type" AS ENUM ('NEW_REQUEST', 'NEW_QUOTE', 'QUOTE_CONFIRMED', 'MOVE_DAY');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "role" "user_role" NOT NULL,
    "email" TEXT,
    "password_hash" TEXT,
    "name" TEXT,
    "phone" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "provider" "social_provider" NOT NULL,
    "provider_id" TEXT NOT NULL,

    CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_profiles" (
    "user_id" UUID NOT NULL,
    "image_url" TEXT,
    "nickname" TEXT,
    "career_years" INTEGER,
    "intro" TEXT,
    "description" TEXT,
    "service_types" "service_type"[],
    "regions" TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "mover_profiles" (
    "user_id" UUID NOT NULL,
    "image_url" TEXT,
    "nickname" TEXT,
    "career_years" INTEGER,
    "intro" TEXT,
    "description" TEXT,
    "service_types" "service_type"[],
    "regions" TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mover_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "move_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "move_type" "service_type" NOT NULL,
    "move_date" DATE NOT NULL,
    "from_address" TEXT NOT NULL,
    "from_zonecode" TEXT,
    "from_region" TEXT NOT NULL,
    "to_address" TEXT NOT NULL,
    "to_zonecode" TEXT,
    "to_region" TEXT NOT NULL,
    "status" "move_request_status" NOT NULL DEFAULT 'PENDING',
    "confirmed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "move_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "designated_requests" (
    "move_request_id" UUID NOT NULL,
    "mover_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "designated_requests_pkey" PRIMARY KEY ("move_request_id","mover_id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "move_request_id" UUID NOT NULL,
    "mover_id" UUID NOT NULL,
    "price" INTEGER NOT NULL,
    "is_designated" BOOLEAN NOT NULL DEFAULT false,
    "status" "quote_status" NOT NULL DEFAULT 'SUBMITTED',
    "confirmed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_rejections" (
    "move_request_id" UUID NOT NULL,
    "mover_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_rejections_pkey" PRIMARY KEY ("move_request_id","mover_id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quote_id" UUID NOT NULL,
    "rating" DECIMAL NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorites" (
    "customer_id" UUID NOT NULL,
    "mover_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("customer_id","mover_id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" "notification_type" NOT NULL,
    "message" TEXT NOT NULL,
    "move_request_id" UUID,
    "quote_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mover_profiles" ADD CONSTRAINT "mover_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "move_requests" ADD CONSTRAINT "move_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "designated_requests" ADD CONSTRAINT "designated_requests_move_request_id_fkey" FOREIGN KEY ("move_request_id") REFERENCES "move_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "designated_requests" ADD CONSTRAINT "designated_requests_mover_id_fkey" FOREIGN KEY ("mover_id") REFERENCES "mover_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_move_request_id_fkey" FOREIGN KEY ("move_request_id") REFERENCES "move_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_mover_id_fkey" FOREIGN KEY ("mover_id") REFERENCES "mover_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_rejections" ADD CONSTRAINT "request_rejections_move_request_id_fkey" FOREIGN KEY ("move_request_id") REFERENCES "move_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_rejections" ADD CONSTRAINT "request_rejections_mover_id_fkey" FOREIGN KEY ("mover_id") REFERENCES "mover_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_mover_id_fkey" FOREIGN KEY ("mover_id") REFERENCES "mover_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_move_request_id_fkey" FOREIGN KEY ("move_request_id") REFERENCES "move_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One active request per customer and one confirmed quote per request.
-- Prisma cannot represent partial unique indexes in schema.prisma.
CREATE UNIQUE INDEX "move_requests_one_active_per_customer_uq"
  ON "move_requests" ("customer_id") WHERE "status" IN ('PENDING', 'CONFIRMED');

CREATE UNIQUE INDEX "quotes_one_confirmed_per_request_uq"
  ON "quotes" ("move_request_id") WHERE "status" = 'CONFIRMED';
