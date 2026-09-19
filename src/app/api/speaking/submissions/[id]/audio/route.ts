import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { attachRecording } from "@/lib/speaking/service";
import { baseMimeType, isAllowedAudioMimeType } from "@/lib/validations/speaking";
import { env } from "@/lib/env";
import { apiError, handleApiError, clientIp } from "@/lib/utils/api";
import { rateLimit } from "@/lib/utils/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Upload a recording for the caller's own submission.
 *
 * The bytes go to private storage; the database only keeps a reference
 * (AudioAsset). The recording is never embedded in the database.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireSession();

    if (
      !rateLimit(`speaking-upload:user:${session.userId}`, { limit: 10, windowMs: 60_000 }) ||
      !rateLimit(`speaking-upload:ip:${clientIp(request)}`, { limit: 20, windowMs: 60_000 })
    ) {
      return apiError(429, "rate_limited");
    }

    const form = await request.formData().catch(() => null);
    if (!form) return apiError(400, "invalid_form_data");

    const file = form.get("audio");
    if (!(file instanceof File)) return apiError(400, "audio_file_required");

    const mimeType = baseMimeType(file.type || "audio/webm");
    if (!isAllowedAudioMimeType(mimeType)) {
      return apiError(415, "unsupported_audio_type", `Unsupported audio type: ${mimeType}`);
    }

    const maxBytes = env.speakingMaxUploadMb * 1024 * 1024;
    if (file.size <= 0) return apiError(400, "empty_audio_file");
    if (file.size > maxBytes) {
      return apiError(413, "audio_too_large", `Recording must be at most ${env.speakingMaxUploadMb} MB.`);
    }

    const durationRaw = form.get("durationSeconds");
    const durationSeconds =
      typeof durationRaw === "string" && Number.isFinite(Number(durationRaw))
        ? Math.max(0, Math.round(Number(durationRaw)))
        : null;

    if (
      durationSeconds != null &&
      durationSeconds > env.speakingMaxRecordingSeconds + 30 // small grace for encoder latency
    ) {
      return apiError(400, "recording_too_long");
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const stored = await attachRecording({
      userId: session.userId,
      submissionId: params.id,
      data: buffer,
      mimeType,
      durationSeconds,
    });
    // Unknown id or another user's submission.
    if (!stored) return apiError(404, "submission_not_found");

    return NextResponse.json({ audio: stored }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
