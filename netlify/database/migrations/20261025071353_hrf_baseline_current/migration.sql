ALTER TABLE "hrf_baselines" ADD COLUMN "is_current" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "hrf_baselines_current_idx" ON "hrf_baselines" ("project_id") WHERE "is_current" AND "deleted_at" IS NULL;--> statement-breakpoint
-- Istniejące dane: najnowszy plan bazowy projektu staje się obowiązującym.
UPDATE "hrf_baselines" b SET "is_current" = true
WHERE b."deleted_at" IS NULL AND b."id" = (
  SELECT x."id" FROM "hrf_baselines" x
  WHERE x."project_id" = b."project_id" AND x."deleted_at" IS NULL
  ORDER BY x."created_at" DESC LIMIT 1
);
