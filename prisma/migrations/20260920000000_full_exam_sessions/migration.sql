CREATE TYPE "FullExamStatus" AS ENUM ('IN_PROGRESS', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TABLE "FullExamSession" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "status" "FullExamStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "listeningBand" DOUBLE PRECISION, "readingBand" DOUBLE PRECISION,
  "writingBand" DOUBLE PRECISION, "speakingBand" DOUBLE PRECISION,
  "overallBand" DOUBLE PRECISION, "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submittedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FullExamSession_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Submission" ADD COLUMN "fullExamSessionId" TEXT;
ALTER TABLE "TestAttempt" ADD COLUMN "fullExamSessionId" TEXT;
ALTER TABLE "SpeakingResult" ADD COLUMN "pronunciationSource" TEXT NOT NULL DEFAULT 'TRANSCRIPT';
CREATE INDEX "FullExamSession_userId_createdAt_idx" ON "FullExamSession"("userId", "createdAt");
CREATE INDEX "FullExamSession_status_updatedAt_idx" ON "FullExamSession"("status", "updatedAt");
CREATE UNIQUE INDEX "FullExamSession_one_active_per_user" ON "FullExamSession"("userId") WHERE "status" IN ('IN_PROGRESS', 'PROCESSING');
CREATE INDEX "Submission_fullExamSessionId_module_createdAt_idx" ON "Submission"("fullExamSessionId", "module", "createdAt");
CREATE UNIQUE INDEX "Submission_one_active_full_exam_module_key" ON "Submission"("fullExamSessionId", "module")
  WHERE "fullExamSessionId" IS NOT NULL AND "module" IN ('WRITING', 'SPEAKING') AND "status" IN ('PENDING', 'PROCESSING', 'COMPLETED');
CREATE INDEX "TestAttempt_fullExamSessionId_module_createdAt_idx" ON "TestAttempt"("fullExamSessionId", "module", "createdAt");
ALTER TABLE "FullExamSession" ADD CONSTRAINT "FullExamSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_fullExamSessionId_fkey" FOREIGN KEY ("fullExamSessionId") REFERENCES "FullExamSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TestAttempt" ADD CONSTRAINT "TestAttempt_fullExamSessionId_fkey" FOREIGN KEY ("fullExamSessionId") REFERENCES "FullExamSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
