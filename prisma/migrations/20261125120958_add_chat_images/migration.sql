-- CreateTable
CREATE TABLE "chat_images" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "message_id" UUID NOT NULL,
    "uploader_id" UUID NOT NULL,
    "upload_id" UUID NOT NULL,
    "image_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_images_upload_id_key" ON "chat_images"("upload_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_images_image_key_key" ON "chat_images"("image_key");

-- CreateIndex
CREATE INDEX "chat_images_message_id_created_at_id_idx" ON "chat_images"("message_id", "created_at", "id");

-- AddForeignKey
ALTER TABLE "chat_images" ADD CONSTRAINT "chat_images_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_images" ADD CONSTRAINT "chat_images_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
