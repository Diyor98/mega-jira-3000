CREATE TABLE IF NOT EXISTS "workflow_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"from_status_id" uuid,
	"to_status_id" uuid NOT NULL,
	"rule_type" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_rules" ADD CONSTRAINT "workflow_rules_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_rules" ADD CONSTRAINT "workflow_rules_from_status_id_fk" FOREIGN KEY ("from_status_id") REFERENCES "public"."workflow_statuses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_rules" ADD CONSTRAINT "workflow_rules_to_status_id_fk" FOREIGN KEY ("to_status_id") REFERENCES "public"."workflow_statuses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_workflow_rules_workflow_to" ON "workflow_rules" USING btree ("workflow_id","to_status_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_workflow_rules_workflow_from_to_type" ON "workflow_rules" USING btree ("workflow_id","from_status_id","to_status_id","rule_type") NULLS NOT DISTINCT;
