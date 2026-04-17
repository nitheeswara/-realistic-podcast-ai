import { FieldValue } from "firebase-admin/firestore";

import { generateVideoRequestSchema } from "@/lib/podcast/schemas";
import { ApiAuthError, jsonError, requireUserFromRequest } from "@/lib/server/auth";
import { adminDb } from "@/lib/server/firebase-admin";
import { createInitialStages, runVideoGenerationPipeline } from "@/workers/video.worker";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await requireUserFromRequest(request);
    const body: unknown = await request.json();
    const parsedBody = generateVideoRequestSchema.safeParse(body);

    if (!parsedBody.success) {
      return jsonError("Invalid video generation request.", 400);
    }

    const podcastRef = adminDb.collection("podcasts").doc(parsedBody.data.podcastId);
    const podcastSnapshot = await podcastRef.get();

    if (!podcastSnapshot.exists) {
      return jsonError("Podcast not found.", 404);
    }

    if (podcastSnapshot.get("ownerId") !== user.uid) {
      return jsonError("Forbidden.", 403);
    }

    const jobRef = adminDb.collection("jobs").doc();
    const now = new Date().toISOString();

    await jobRef.set({
      id: jobRef.id,
      userId: user.uid,
      podcastId: parsedBody.data.podcastId,
      status: "queued",
      stage: "audio",
      stages: createInitialStages(),
      progress: 0,
      createdAt: now,
      updatedAt: now,
      ...(parsedBody.data.retryJobId ? { retryJobId: parsedBody.data.retryJobId } : {}),
    });

    await podcastRef.update({
      status: "queued",
      currentJobId: jobRef.id,
      updatedAt: FieldValue.serverTimestamp(),
    });

    void runVideoGenerationPipeline({
      jobId: jobRef.id,
      podcastId: parsedBody.data.podcastId,
      userId: user.uid,
    });

    return Response.json({ jobId: jobRef.id });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return jsonError(error.message, 401);
    }

    const message = error instanceof Error ? error.message : "Video generation failed.";
    return jsonError(message, 500);
  }
}
