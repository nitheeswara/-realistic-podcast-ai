import { NextRequest, NextResponse } from "next/server";

import { adminAuth, adminDb } from "@/lib/server/firebase-admin";
import { runPodcastJob } from "@/workers/podcast.worker";

export async function POST(req: NextRequest) {
  try {
    const { podcastId } = await req.json();
    if (!podcastId) {
      return NextResponse.json({ error: "podcastId required" }, { status: 400 });
    }

    const token = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const decoded = await adminAuth.verifyIdToken(token);

    const jobRef = await adminDb.collection("jobs").add({
      podcastId,
      userId: decoded.uid,
      type: "audio_generation",
      status: "queued",
      stage: "audio",
      progress: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await adminDb.collection("podcasts").doc(podcastId).update({
      status: "generating",
      currentJobId: jobRef.id,
    });

    runPodcastJob({
      jobId: jobRef.id,
      podcastId,
      userId: decoded.uid,
    }).catch((error) => console.error("Background job error:", error));

    return NextResponse.json({ jobId: jobRef.id });
  } catch (error) {
    console.error("Generate route error:", error);
    const message = error instanceof Error ? error.message : "Podcast generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}