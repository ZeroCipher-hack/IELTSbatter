import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getPrivateStorage } from "@/lib/storage";
import { apiError, handleApiError } from "@/lib/utils/api";

export const dynamic = "force-dynamic";

/**
 * Stream a stored recording.
 *
 * Ownership rules:
 *  - a user recording (SPEAKING_RECORDING) is served only to its owner;
 *  - published listening audio is public and served from /audio/... directly,
 *    but listing it here too keeps the route usable for any asset;
 *  - anonymous callers get 401, other users' recordings look like 404.
 */
export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await requireSession();

    const asset = await prisma.audioAsset.findUnique({ where: { id: params.id } });
    if (!asset) return apiError(404, "audio_not_found");

    if (asset.kind === "SPEAKING_RECORDING" && asset.userId !== session.userId) {
      // Do not reveal that the asset exists.
      return apiError(404, "audio_not_found");
    }

    const file = await getPrivateStorage().read(asset.storageKey);
    if (!file) return apiError(404, "audio_not_found");

    return new NextResponse(new Uint8Array(file.data), {
      status: 200,
      headers: {
        "Content-Type": asset.mimeType || file.mimeType,
        "Content-Length": String(file.data.byteLength),
        "Cache-Control": "private, max-age=0, no-store",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
