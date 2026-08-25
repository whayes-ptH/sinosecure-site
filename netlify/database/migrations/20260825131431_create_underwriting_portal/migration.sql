CREATE TABLE "underwriting_documents" (
	"id" serial PRIMARY KEY,
	"project_id" integer NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"chunk_total" integer DEFAULT 1 NOT NULL,
	"chunks_received" integer DEFAULT 0 NOT NULL,
	"checksum" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"uploaded_by" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "underwriting_events" (
	"id" serial PRIMARY KEY,
	"project_id" integer,
	"type" text NOT NULL,
	"actor" text NOT NULL,
	"detail" text,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "underwriting_projects" (
	"id" serial PRIMARY KEY,
	"reference" text NOT NULL UNIQUE,
	"access_code_hash" text NOT NULL UNIQUE,
	"organisation" text,
	"contact_name" text,
	"contact_email" text,
	"coverage_interest" text,
	"matter_summary" text,
	"status" text DEFAULT 'open' NOT NULL,
	"origin" text DEFAULT 'client' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_access_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "underwriting_documents_project_idx" ON "underwriting_documents" ("project_id");--> statement-breakpoint
CREATE INDEX "underwriting_events_project_idx" ON "underwriting_events" ("project_id");--> statement-breakpoint
CREATE INDEX "underwriting_events_created_idx" ON "underwriting_events" ("created_at");--> statement-breakpoint
ALTER TABLE "underwriting_documents" ADD CONSTRAINT "underwriting_documents_project_id_underwriting_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "underwriting_projects"("id");--> statement-breakpoint
ALTER TABLE "underwriting_events" ADD CONSTRAINT "underwriting_events_project_id_underwriting_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "underwriting_projects"("id");