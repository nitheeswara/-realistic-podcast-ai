import { cloneListResponseSchema } from "@/lib/podcast/schemas";
import { ApiAuthError, jsonError, requireUserFromRequest } from "@/lib/server/auth";
import { adminDb } from "@/lib/server/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireUserFromRequest(request);
    const snapshot = await adminDb
      .collection("clones")
      .where("userId", "==", user.uid)
      .get();
    const cloneDocs: Array<Record<string, unknown> & { id: string }> = snapshot.docs.map(
      (documentSnapshot) => ({
        id: documentSnapshot.id,
        ...(documentSnapshot.data() as Record<string, unknown>),
      })
    );
    const clones = cloneDocs.sort((first, second) => {
      const firstCreated = typeof first.createdAt === "string" ? first.createdAt : "";
      const secondCreated = typeof second.createdAt === "string" ? second.createdAt : "";
      return secondCreated.localeCompare(firstCreated);
    });

    return Response.json(cloneListResponseSchema.parse({ clones }));
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return jsonError(error.message, 401);
    }

    const message = error instanceof Error ? error.message : "Could not load clones.";
    return jsonError(message, 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUserFromRequest(request);
    const url = new URL(request.url);
    const cloneId = url.searchParams.get("cloneId");

    if (!cloneId) {
      return jsonError("cloneId is required.", 400);
    }

    const cloneRef = adminDb.collection("clones").doc(cloneId);
    const snapshot = await cloneRef.get();

    if (!snapshot.exists) {
      return jsonError("Clone not found.", 404);
    }

    if (snapshot.get("userId") !== user.uid) {
      return jsonError("Forbidden.", 403);
    }

    await cloneRef.delete();

    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return jsonError(error.message, 401);
    }

    const message = error instanceof Error ? error.message : "Could not delete clone.";
    return jsonError(message, 500);
  }
}



