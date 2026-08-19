CREATE TYPE "public"."enrichment_status" AS ENUM('pending', 'complete', 'failed');--> statement-breakpoint
CREATE TABLE "annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"rect_x" double precision NOT NULL,
	"rect_y" double precision NOT NULL,
	"rect_width" double precision NOT NULL,
	"rect_height" double precision NOT NULL,
	"user_comment" text DEFAULT '' NOT NULL,
	"extracted_passage" text,
	"extracted_context" text,
	"enrichment_status" "enrichment_status" DEFAULT 'pending' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"enrichment_error" text,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(user_comment, '')), 'A') || setweight(to_tsvector('english', coalesce(extracted_passage, '')), 'B') || setweight(to_tsvector('english', coalesce(extracted_context, '')), 'C')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "annotations_rect_x_normalized" CHECK ("annotations"."rect_x" >= 0 AND "annotations"."rect_x" <= 1),
	CONSTRAINT "annotations_rect_y_normalized" CHECK ("annotations"."rect_y" >= 0 AND "annotations"."rect_y" <= 1),
	CONSTRAINT "annotations_rect_width_normalized" CHECK ("annotations"."rect_width" > 0 AND "annotations"."rect_width" <= 1),
	CONSTRAINT "annotations_rect_height_normalized" CHECK ("annotations"."rect_height" > 0 AND "annotations"."rect_height" <= 1),
	CONSTRAINT "annotations_retry_count_positive" CHECK ("annotations"."retry_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "annotations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"author" text NOT NULL,
	"series" text,
	"series_index" integer,
	"cover_url" text,
	"open_library_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "books" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"storage_key" text NOT NULL,
	"image_width" integer NOT NULL,
	"image_height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pages_book_id_page_number_key" UNIQUE("book_id","page_number"),
	CONSTRAINT "pages_image_width_positive" CHECK ("pages"."image_width" > 0),
	CONSTRAINT "pages_image_height_positive" CHECK ("pages"."image_height" > 0)
);
--> statement-breakpoint
ALTER TABLE "pages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "annotations_user_id_idx" ON "annotations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "annotations_page_id_idx" ON "annotations" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "annotations_search_vector_idx" ON "annotations" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "books_user_id_idx" ON "books" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "pages_user_id_idx" ON "pages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "pages_book_id_idx" ON "pages" USING btree ("book_id");