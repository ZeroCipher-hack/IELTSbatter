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

/**
 * Check the container signature, not only the browser-supplied Content-Type.
 * This rejects obvious HTML, JSON and renamed arbitrary files before storage.
 */
export function hasValidAudioSignature(data: Uint8Array, mimeType: string): boolean {
  const type = baseMimeType(mimeType);
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...Array.from(data.slice(start, end)));

  if (type === "audio/wav" || type === "audio/x-wav") {
    return data.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE";
  }
  if (type === "audio/ogg") {
    return data.length >= 4 && ascii(0, 4) === "OggS";
  }
  if (type === "audio/webm") {
    return data.length >= 4 && data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3;
  }
  if (type === "audio/mp4") {
    return data.length >= 12 && ascii(4, 8) === "ftyp";
  }
  if (type === "audio/mpeg") {
    return (
      (data.length >= 3 && ascii(0, 3) === "ID3") ||
      (data.length >= 2 && data[0] === 0xff && (data[1] & 0xe0) === 0xe0)
    );
  }
  return false;
}
