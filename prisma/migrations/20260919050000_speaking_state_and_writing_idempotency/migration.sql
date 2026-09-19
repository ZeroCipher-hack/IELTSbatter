CREATE TYPE "SpeakingInterviewState" AS ENUM (
  'PREPARING', 'PART_1', 'PART_2', 'PART_3', 'UPLOADING',
  'TRANSCRIBING', 'EVALUATING', 'COMPLETED', 'FAILED'
);

ALTER TABLE "Submission"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "requestFingerprint" TEXT;

CREATE UNIQUE INDEX "Submission_userId_idempotencyKey_key"
  ON "Submission"("userId", "idempotencyKey");

ALTER TABLE "AudioAsset" ADD COLUMN "speakingPart" INTEGER;
DROP INDEX IF EXISTS "AudioAsset_submissionId_key";
UPDATE "AudioAsset" SET "speakingPart" = 1
  WHERE "submissionId" IS NOT NULL AND "kind" = 'SPEAKING_RECORDING';
CREATE UNIQUE INDEX "AudioAsset_submissionId_speakingPart_key"
  ON "AudioAsset"("submissionId", "speakingPart");

CREATE TABLE "SpeakingInterview" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "testId" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "state" "SpeakingInterviewState" NOT NULL DEFAULT 'PREPARING',
  "currentPart" INTEGER NOT NULL DEFAULT 1,
  "currentPromptId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "stateStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SpeakingInterview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SpeakingInterview_submissionId_key" ON "SpeakingInterview"("submissionId");
CREATE INDEX "SpeakingInterview_userId_testId_createdAt_idx" ON "SpeakingInterview"("userId", "testId", "createdAt");
CREATE INDEX "SpeakingInterview_state_stateStartedAt_idx" ON "SpeakingInterview"("state", "stateStartedAt");
CREATE UNIQUE INDEX "SpeakingInterview_one_active_per_user_test"
  ON "SpeakingInterview"("userId", "testId")
  WHERE "state" NOT IN ('COMPLETED', 'FAILED');

ALTER TABLE "SpeakingInterview" ADD CONSTRAINT "SpeakingInterview_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SpeakingInterview" ADD CONSTRAINT "SpeakingInterview_testId_fkey"
  FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SpeakingInterview" ADD CONSTRAINT "SpeakingInterview_submissionId_fkey"
  FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
