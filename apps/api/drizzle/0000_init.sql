CREATE TABLE "files" (
	"file_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"pages" jsonb NOT NULL,
	"blob_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_items" (
	"job_id" text NOT NULL,
	"index" integer NOT NULL,
	"record" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"pdf_path" text,
	"error" text,
	CONSTRAINT "job_items_job_id_index_pk" PRIMARY KEY("job_id","index")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"file_id" text NOT NULL,
	"status" text NOT NULL,
	"total" integer NOT NULL,
	"done" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"error" text,
	"zip_path" text,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "layouts" (
	"file_id" text PRIMARY KEY NOT NULL,
	"slots" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "values" (
	"file_id" text PRIMARY KEY NOT NULL,
	"values" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_items" ADD CONSTRAINT "job_items_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_file_id_files_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("file_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layouts" ADD CONSTRAINT "layouts_file_id_files_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("file_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "values" ADD CONSTRAINT "values_file_id_files_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("file_id") ON DELETE cascade ON UPDATE no action;