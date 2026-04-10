CREATE TYPE "public"."issue_priority" AS ENUM('P1', 'P2', 'P3', 'P4');--> statement-breakpoint
CREATE TYPE "public"."issue_type" AS ENUM('epic', 'story', 'task', 'bug');--> statement-breakpoint
CREATE TABLE "issue_sequences" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"next_sequence" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"issue_key" varchar(50) NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"type" "issue_type" NOT NULL,
	"priority" "issue_priority" DEFAULT 'P3' NOT NULL,
	"status_id" uuid NOT NULL,
	"assignee_id" uuid,
	"reporter_id" uuid NOT NULL,
	"parent_id" uuid,
	"issue_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "issues_issue_key_unique" UNIQUE("issue_key")
);
--> statement-breakpoint
DROP INDEX "idx_projects_key";--> statement-breakpoint
ALTER TABLE "issue_sequences" ADD CONSTRAINT "issue_sequences_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_status_id_workflow_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."workflow_statuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_issues_project_id" ON "issues" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_issues_project_status" ON "issues" USING btree ("project_id","status_id");--> statement-breakpoint
CREATE INDEX "idx_issues_assignee" ON "issues" USING btree ("assignee_id");