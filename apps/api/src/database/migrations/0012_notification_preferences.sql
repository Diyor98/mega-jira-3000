-- Story 6.4: Notification Preferences — per-user type toggles.

CREATE TABLE IF NOT EXISTS "notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"mentioned" boolean NOT NULL DEFAULT true,
	"assigned" boolean NOT NULL DEFAULT true,
	"status_changed" boolean NOT NULL DEFAULT true,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
