-- Story 5.2: Saved Filter Presets — per-user, per-project saved filter configurations.

CREATE TABLE IF NOT EXISTS "filter_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"filter_config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "filter_presets" ADD CONSTRAINT "filter_presets_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filter_presets" ADD CONSTRAINT "filter_presets_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_filter_presets_user_project" ON "filter_presets" USING btree ("user_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_filter_presets_user_project_name" ON "filter_presets" USING btree ("user_id","project_id","name");
