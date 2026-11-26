-- CreateEnum
CREATE TYPE "move_progress_step" AS ENUM ('DEPARTED', 'LOADING', 'IN_TRANSIT', 'UNLOADING', 'COMPLETED');

-- CreateTable
CREATE TABLE "move_progress" (
    "quote_id" UUID NOT NULL,
    "step" "move_progress_step" NOT NULL,
    "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "move_progress_pkey" PRIMARY KEY ("quote_id","step")
);

-- AddForeignKey
ALTER TABLE "move_progress" ADD CONSTRAINT "move_progress_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
