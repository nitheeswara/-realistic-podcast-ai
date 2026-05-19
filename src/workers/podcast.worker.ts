import { FieldValue } from "firebase-admin/firestore";

import { podcastScriptSchema, speakerConfigSchema } from "@/lib/podcast/schemas";
import { adminDb } from "@/lib/server/firebase-admin";
import type { AudioTurnTiming } from "@/types/jobs";
import { runAudioJob } from "@/workers/audio.worker";

const buildTurnTimings = (turns: Array<{
  turnId: string;
  speakerId: string;
  text: string;
  durationSeconds: number;
}>): AudioTurnTiming[] => {
  let cursor = 0;

  return turns.map((turn) => {
    const startSeconds = cursor;
    const durationSeconds = Math.max(0, turn.durationSeconds);
    const endSeconds = startSeconds + durationSeconds;
    cursor = endSeconds;

    return {
      turnId: turn.turnId,
      speakerId: turn.speakerId === "guest" ? "guest" : "host",
      text: turn.text,
      durationSeconds,
      startSeconds,
      endSeconds,
    };
  });
};

export async function runPodcastJob(params: {
  jobId: string;
  podcastId: string;
  userId: string;
}) {
  const { jobId, podcastId, userId } = params;
  const jobRef = adminDb.collection("jobs").doc(jobId);
  const podcastRef = adminDb.collection("podcasts").doc(podcastId);

  try {
    await jobRef.update({ status: "running", startedAt: new Date().toISOString() });
    console.log("=== Podcast audio job started ===", podcastId);

    const snap = await adminDb.collection("podcasts").doc(podcastId).get();
    if (!snap.exists) {
      throw new Error("Podcast not found");
    }
    if (snap.get("ownerId") !== userId) {
      throw new Error("Forbidden");
    }

    const data = snap.data()!;
    const script = podcastScriptSchema.parse(data.script);
    const host = speakerConfigSchema.parse(data.host);
    const guest = speakerConfigSchema.parse(data.guest);

    console.log("Script turns:", script.segments.flatMap((segment) => segment.turns).length);
    console.log("Host voice:", host.voiceId ?? "default");
    console.log("Guest voice:", guest.voiceId ?? "default");

    const result = await runAudioJob(
      {
        jobId,
        podcastId,
        script,
        speakers: [host, guest],
      },
      async (stage, pct) => {
        await jobRef.update({
          stage,
          progress: pct,
          updatedAt: new Date().toISOString(),
        });
      }
    );

    const audioTurns = buildTurnTimings(result.turns);

    await jobRef.update({
      status: "completed",
      progress: 100,
      audioUrl: result.finalAudioUrl,
      audioTurns,
      durationSeconds: result.durationSeconds,
      completedAt: new Date().toISOString(),
    });

    await podcastRef.update({
      status: "completed",
      audioUrl: result.finalAudioUrl,
      audioTurns,
      durationSeconds: result.durationSeconds,
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log("=== Podcast audio job completed ===");
    console.log("Duration:", result.durationSeconds.toFixed(1), "seconds");
    console.log("URL:", result.finalAudioUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Podcast audio job failed";
    console.error("=== Podcast audio job FAILED ===", message);
    await jobRef.update({
      status: "failed",
      errorMessage: message,
      updatedAt: new Date().toISOString(),
    });
    await podcastRef.update({
      status: "failed",
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}