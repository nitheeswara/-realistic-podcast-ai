import { ApiAuthError, jsonError, requireUserFromRequest } from "@/lib/server/auth";
import { adminDb } from "@/lib/server/firebase-admin";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  try {
    const user = await requireUserFromRequest(request);
    const { jobId } = await context.params;
    const snapshot = await adminDb.collection("jobs").doc(jobId).get();

    if (!snapshot.exists) {
      return jsonError("Job not found.", 404);
    }

    if (snapshot.get("userId") !== user.uid) {
      return jsonError("Forbidden.", 403);
    }

    return Response.json({ job: { id: snapshot.id, ...snapshot.data() } });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return jsonError(error.message, 401);
    }

    const message = error instanceof Error ? error.message : "Could not load job.";
    return jsonError(message, 500);
  }
}
