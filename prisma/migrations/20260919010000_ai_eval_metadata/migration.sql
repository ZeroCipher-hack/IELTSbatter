-- AI grading reliability + cost metadata, and de-duplicated error reporting.
-- Additive only: existing rows keep working (new columns are nullable/defaulted).

ALTER TABLE "EssayError"
  ADD COLUMN IF NOT EXISTS "frequency" INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "isSystematic" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "AiEvaluation"
  ADD COLUMN IF NOT EXISTS "attempts" INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "retryCount" INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "validationStatus" TEXT DEFAULT 'VALID',
  ADD COLUMN IF NOT EXISTS "inputTokens" INTEGER,
  ADD COLUMN IF NOT EXISTS "outputTokens" INTEGER;
