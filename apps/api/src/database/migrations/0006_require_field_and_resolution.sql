-- Story 4.3: Mandatory Fields on Transitions
-- Adds resolution + status_changed_at to issues, required_field to workflow_rules,
-- and rebuilds the workflow_rules unique index to include required_field.

ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "resolution" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "status_changed_at" timestamp with time zone NOT NULL DEFAULT now();--> statement-breakpoint
-- Backfill: existing rows get the column value from ADD COLUMN's DEFAULT now(),
-- which is wrong for time-in-status analytics. Unconditionally reset to
-- updated_at (the best proxy we have for the last status transition).
UPDATE "issues" SET "status_changed_at" = "updated_at";--> statement-breakpoint

ALTER TABLE "workflow_rules" ADD COLUMN IF NOT EXISTS "required_field" varchar(100);--> statement-breakpoint

DROP INDEX IF EXISTS "uq_workflow_rules_workflow_from_to_type";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_workflow_rules_workflow_from_to_type_field" ON "workflow_rules" USING btree ("workflow_id","from_status_id","to_status_id","rule_type","required_field") NULLS NOT DISTINCT;
