import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getOwnSubmission } from "@/lib/writing/service";
import { apiError, handleApiError } from "@/lib/utils/api";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireSession();
    // Ownership enforced inside the query — users can only read their own.
    const submission = await getOwnSubmission(session.userId, params.id);
    if (!submission) {
      return apiError(404, "not_found");
    }
    return NextResponse.json({ submission });
  } catch (error) {
    return handleApiError(error);
  }
}
