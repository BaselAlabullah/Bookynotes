ALTER TABLE "pages" ADD COLUMN "transcript" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "transcript_status" "enrichment_status";--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "transcript_error" text;