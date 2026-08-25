CREATE TABLE "underwriting_sessions" (
	"id" serial PRIMARY KEY,
	"token_hash" text NOT NULL UNIQUE,
	"user_id" integer NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "underwriting_users" (
	"id" serial PRIMARY KEY,
	"email" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"role" text DEFAULT 'staff' NOT NULL,
	"password_hash" text NOT NULL,
	"password_salt" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "underwriting_projects" ADD COLUMN "issued_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "underwriting_projects" ADD COLUMN "proposal_sent_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "underwriting_sessions_user_idx" ON "underwriting_sessions" ("user_id");--> statement-breakpoint
ALTER TABLE "underwriting_projects" ADD CONSTRAINT "underwriting_projects_D23NKLAmbyPd_fkey" FOREIGN KEY ("issued_by_user_id") REFERENCES "underwriting_users"("id");--> statement-breakpoint
ALTER TABLE "underwriting_sessions" ADD CONSTRAINT "underwriting_sessions_user_id_underwriting_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "underwriting_users"("id");