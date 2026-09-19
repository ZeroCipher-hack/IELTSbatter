-- Prevent concurrent provider calls and make interrupted evaluations recoverable.
ALTER TYPE "SubmissionStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TABLE "Submission" ADD COLUMN "processingStartedAt" TIMESTAMP(3);

-- Preserve the newest resumable attempt and close pre-existing duplicates
-- before enforcing one active attempt per learner/test.
WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "userId", "testId" ORDER BY "startedAt" DESC, "id" DESC
  ) AS row_number
  FROM "TestAttempt"
  WHERE "status" = 'IN_PROGRESS'
)
UPDATE "TestAttempt"
SET "status" = 'FAILED'
WHERE "id" IN (SELECT "id" FROM ranked WHERE row_number > 1);

CREATE UNIQUE INDEX "TestAttempt_one_in_progress_per_user_test_key"
ON "TestAttempt"("userId", "testId") WHERE "status" = 'IN_PROGRESS';

-- Speaking recordings must not survive their submission as orphan metadata.
ALTER TABLE "AudioAsset" DROP CONSTRAINT "AudioAsset_submissionId_fkey";
ALTER TABLE "AudioAsset" ADD CONSTRAINT "AudioAsset_submissionId_fkey"
FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A speaking submission owns at most one recording. Preserve the newest
-- metadata row if legacy data already contains duplicates, then enforce the
-- invariant at the database boundary to close concurrent upload races.
WITH ranked_audio AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "submissionId" ORDER BY "createdAt" DESC, "id" DESC
  ) AS row_number
  FROM "AudioAsset"
  WHERE "submissionId" IS NOT NULL
)
DELETE FROM "AudioAsset"
WHERE "id" IN (SELECT "id" FROM ranked_audio WHERE row_number > 1);

CREATE UNIQUE INDEX "AudioAsset_submissionId_key" ON "AudioAsset"("submissionId");
