CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL,
  "actor_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "entity_type" varchar(64) NOT NULL,
  "entity_id" uuid NOT NULL,
  "action" varchar(64) NOT NULL,
  "before_value" jsonb,
  "after_value" jsonb,
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_log_project_created"
  ON "audit_log" ("project_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_log_entity_created"
  ON "audit_log" ("entity_type", "entity_id", "created_at" DESC);
