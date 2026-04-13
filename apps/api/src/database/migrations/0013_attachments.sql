-- Story 7.1: File Upload & Download — attachments table.

CREATE TABLE IF NOT EXISTS "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"stored_name" varchar(512) NOT NULL,
	"mime_type" varchar(128) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attachments_issue_created" ON "attachments" USING btree ("issue_id","created_at");
