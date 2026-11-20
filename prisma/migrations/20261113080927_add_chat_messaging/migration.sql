-- CreateTable
CREATE TABLE "chat_rooms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quote_id" UUID NOT NULL,
    "last_message_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_participants" (
    "chat_room_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "last_read_at" TIMESTAMPTZ,

    CONSTRAINT "chat_participants_pkey" PRIMARY KEY ("chat_room_id","user_id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "chat_room_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_rooms_quote_id_key" ON "chat_rooms"("quote_id");

-- CreateIndex
CREATE INDEX "chat_participants_user_id_chat_room_id_idx" ON "chat_participants"("user_id", "chat_room_id");

-- CreateIndex
CREATE INDEX "messages_chat_room_id_created_at_id_idx" ON "messages"("chat_room_id", "created_at", "id");

-- AddForeignKey
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_chat_room_id_fkey" FOREIGN KEY ("chat_room_id") REFERENCES "chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_chat_room_id_fkey" FOREIGN KEY ("chat_room_id") REFERENCES "chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- Backfill chat rooms for existing quotes.
-- Preserve the original quote creation time.
INSERT INTO "chat_rooms" ("quote_id", "created_at")
SELECT
    q."id",
    q."created_at"
FROM "quotes" q;

-- Add the customer as a chat participant.
INSERT INTO "chat_participants" ("chat_room_id", "user_id")
SELECT
    cr."id",
    mr."customer_id"
FROM "chat_rooms" cr
JOIN "quotes" q
    ON q."id" = cr."quote_id"
JOIN "move_requests" mr
    ON mr."id" = q."move_request_id";

-- Add the mover as a chat participant.
INSERT INTO "chat_participants" ("chat_room_id", "user_id")
SELECT
    cr."id",
    q."mover_id"
FROM "chat_rooms" cr
JOIN "quotes" q
    ON q."id" = cr."quote_id";
