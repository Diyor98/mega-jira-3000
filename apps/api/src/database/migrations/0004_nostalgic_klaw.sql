CREATE TYPE "public"."link_type" AS ENUM('related', 'blocks', 'created_from');--> statement-breakpoint
CREATE TABLE "issue_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_issue_id" uuid NOT NULL,
	"target_issue_id" uuid NOT NULL,
	"link_type" "link_type" NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_issue_links_source_target_type" UNIQUE("source_issue_id","target_issue_id","link_type")
);
--> statement-breakpoint
ALTER TABLE "issue_links" ADD CONSTRAINT "issue_links_source_issue_id_issues_id_fk" FOREIGN KEY ("source_issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_links" ADD CONSTRAINT "issue_links_target_issue_id_issues_id_fk" FOREIGN KEY ("target_issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_links" ADD CONSTRAINT "issue_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_issue_links_source" ON "issue_links" USING btree ("source_issue_id");--> statement-breakpoint
CREATE INDEX "idx_issue_links_target" ON "issue_links" USING btree ("target_issue_id");