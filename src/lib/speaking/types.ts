/**
 * Client-safe speaking types.
 *
 * Kept in a standalone module (no Prisma / no server imports) so client
 * components can reference them without pulling server code into the bundle.
 */

export interface SpeakingTestSummary {
  id: string;
  title: string;
  description: string | null;
  partCount: number;
  promptCount: number;
  estimatedMinutes: number;
}

export interface SpeakingPrompt {
  id: string;
  number: number;
  part: number;
  partTitle: string;
  prompt: string;
  instructions: string | null;
  preparationSeconds: number;
  speakingSeconds: number;
  isCueCard: boolean;
  bulletPoints: string[];
}

export interface PublicSpeakingTest {
  id: string;
  title: string;
  description: string | null;
  prompts: SpeakingPrompt[];
}

export interface SpeakingInterviewSnapshot {
  id: string;
  submissionId: string;
  testId: string;
  state: "PREPARING" | "PART_1" | "PART_2" | "PART_3" | "UPLOADING" | "TRANSCRIBING" | "EVALUATING" | "COMPLETED" | "FAILED";
  currentPart: number;
  currentPromptId: string;
  stateStartedAt: string;
  serverNow: string;
  remainingSeconds: number;
  failureReason: string | null;
}
