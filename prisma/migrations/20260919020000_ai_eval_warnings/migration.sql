-- Non-fatal operator warnings attached to an AI evaluation.
-- Additive only: existing rows default to an empty array.
ALTER TABLE "AiEvaluation"
  ADD COLUMN IF NOT EXISTS "warnings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
