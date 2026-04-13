CREATE TABLE IF NOT EXISTS "project_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" varchar(32) NOT NULL,
  "added_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "added_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "project_members_project_user_unique" UNIQUE ("project_id", "user_id")
);
--> statement-breakpoint
-- Backfill: every existing project gains a project_admin membership row for
-- its owner so the pre-8.1 projects are not "empty-team" after this story.
INSERT INTO "project_members" ("project_id", "user_id", "role", "added_by")
SELECT "id", "owner_id", 'project_admin', "owner_id"
FROM "projects"
WHERE NOT EXISTS (
  SELECT 1 FROM "project_members" pm
  WHERE pm."project_id" = "projects"."id" AND pm."user_id" = "projects"."owner_id"
);
