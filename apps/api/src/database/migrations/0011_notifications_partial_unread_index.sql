-- Story 6.3 code-review patch: replace the composite (user_id, read_at) index
-- with a partial index on unread notifications only. The hot-path query
-- `SELECT count(*) WHERE user_id=$1 AND read_at IS NULL` doesn't use the
-- composite effectively for the `IS NULL` branch; a partial index is smaller
-- and enables an index-only scan.

DROP INDEX IF EXISTS "idx_notifications_user_read";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notifications_user_unread"
  ON "notifications" USING btree ("user_id")
  WHERE "read_at" IS NULL;
