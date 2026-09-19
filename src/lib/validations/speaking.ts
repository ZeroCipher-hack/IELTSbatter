import { z } from "zod";

/** Recording formats produced by browsers' MediaRecorder (plus safe extras). */
export const ALLOWED_AUDIO_MIME_TYPES = [
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
] as const;

export const createSpeakingSubmissionSchema = z.object({
  testId: z.string().min(1).max(64),
  promptId: z.string().min(1).max(64).optional(),
});

export const evaluateSpeakingSchema = z.object({
  locale: z.enum(["uz", "ru"]).optional(),
});

/** Strip codec parameters ("audio/webm;codecs=opus") before comparing. */
export function baseMimeType(mimeType: string): string {
  return mimeType.split(";")[0].trim().toLowerCase();
}

export function isAllowedAudioMimeType(mimeType: string): boolean {
  return (ALLOWED_AUDIO_MIME_TYPES as readonly string[]).includes(baseMimeType(mimeType));
}
