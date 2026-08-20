CREATE TYPE "public"."annotation_anchor" AS ENUM('region', 'text');--> statement-breakpoint
ALTER TABLE "annotations" ALTER COLUMN "rect_x" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "annotations" ALTER COLUMN "rect_y" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "annotations" ALTER COLUMN "rect_width" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "annotations" ALTER COLUMN "rect_height" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "annotations" ADD COLUMN "anchor" "annotation_anchor" DEFAULT 'region' NOT NULL;--> statement-breakpoint
ALTER TABLE "annotations" ADD COLUMN "text_start" integer;--> statement-breakpoint
ALTER TABLE "annotations" ADD COLUMN "text_end" integer;--> statement-breakpoint
ALTER TABLE "annotations" ADD COLUMN "quoted_text" text;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_exactly_one_anchor" CHECK ((
        "annotations"."anchor" = 'region'
        AND "annotations"."rect_x" IS NOT NULL AND "annotations"."rect_y" IS NOT NULL
        AND "annotations"."rect_width" IS NOT NULL AND "annotations"."rect_height" IS NOT NULL
        AND "annotations"."text_start" IS NULL AND "annotations"."text_end" IS NULL
      ) OR (
        "annotations"."anchor" = 'text'
        AND "annotations"."text_start" IS NOT NULL AND "annotations"."text_end" IS NOT NULL
        AND "annotations"."text_end" > "annotations"."text_start"
        AND "annotations"."quoted_text" IS NOT NULL
        AND "annotations"."rect_x" IS NULL AND "annotations"."rect_y" IS NULL
        AND "annotations"."rect_width" IS NULL AND "annotations"."rect_height" IS NULL
      ));