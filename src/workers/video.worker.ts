import { spawn } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FieldValue } from "firebase-admin/firestore";
import ffmpegStatic from "ffmpeg-static";

import { serverEnv } from "@/config/env";
import { jobStages } from "@/lib/podcast/constants";
import { podcastScriptSchema, speakerConfigSchema, videoSettingsSchema } from "@/lib/podcast/schemas";
import { adminDb } from "@/lib/server/firebase-admin";
import type { GenerationJob, JobStage, JobStatus, StageProgress } from "@/types/jobs";
import type { PodcastScript } from "@/types/script";
import type { VideoSettings } from "@/types/video";
import type { SpeakerConfig } from "@/types/voice";
import { runAudioWorker } from "@/workers/audio.worker";
import { runComposeWorker } from "@/workers/compose.worker";

export interface VideoWorkerInput {
  jobId: string;
  podcastId: string;
  userId: string;
}

interface PodcastForVideo {
  title: string;
  script: PodcastScript;
  videoSettings: VideoSettings;
  speakers: SpeakerConfig[];
}

interface GenerationSource {
  title?: unknown;
  script?: unknown;
  videoSettings?: unknown;
  host?: unknown;
  guest?: unknown;
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const errorStack = (error: unknown) =>
  error instanceof Error ? error.stack : undefined;

const errorCauseMessage = (error: unknown) => {
  if (!(error instanceof Error) || typeof error.cause !== "object" || error.cause === null) {
    return "none";
  }

  return "message" in error.cause && typeof error.cause.message === "string"
    ? error.cause.message
    : "none";
};

const VIDEO_DIR = join(process.cwd(), "public", "stock-videos");
const REQUIRED_VIDEOS = [
  "male-host.mp4",
  "female-host.mp4",
  "male-guest.mp4",
  "female-guest.mp4",
] as const;

export const createInitialStages = (): Record<JobStage, StageProgress> => {
  const stages = {} as Record<JobStage, StageProgress>;
  for (const stage of jobStages) {
    stages[stage] = { status: "queued", progress: 0 };
  }
  return stages;
};

const calculateOverallProgress = (
  currentStage: JobStage,
  stageProgress: number,
  completedStages: Set<JobStage>
) => {
  const stageWeight = 100 / jobStages.length;
  const completedProgress = completedStages.size * stageWeight;
  const activeProgress = (stageProgress / 100) * stageWeight;
  const currentIndex = jobStages.indexOf(currentStage);
  const previousProgress = Math.max(0, currentIndex) * stageWeight;
  return Math.min(100, Math.max(completedProgress, previousProgress + activeProgress));
};

const updateStage = async (
  jobId: string,
  stage: JobStage,
  status: JobStatus,
  progress: number,
  completedStages: Set<JobStage>,
  errorMessage?: string
) => {
  const update: Record<string, unknown> = {
    stage,
    status: status === "failed" || status === "canceled" ? status : "running",
    progress: calculateOverallProgress(stage, progress, completedStages),
    [`stages.${stage}`]: {
      status,
      progress,
      ...(errorMessage ? { errorMessage } : {}),
    },
    updatedAt: new Date().toISOString(),
  };
  await adminDb.collection("jobs").doc(jobId).update(update);
};

const markStageCompleted = async (
  jobId: string,
  stage: JobStage,
  completedStages: Set<JobStage>
) => {
  completedStages.add(stage);
  await updateStage(jobId, stage, "completed", 100, completedStages);
};

const assertNotCanceled = async (jobId: string) => {
  const snapshot = await adminDb.collection("jobs").doc(jobId).get();
  const status = snapshot.get("status");
  if (status === "canceled") {
    throw new Error("Video generation was canceled.");
  }
};

const loadPodcastForVideo = async (
  podcastId: string,
  userId: string
): Promise<PodcastForVideo> => {
  const snapshot = await adminDb.collection("podcasts").doc(podcastId).get();

  if (!snapshot.exists) {
    throw new Error("Podcast not found.");
  }

  if (snapshot.get("ownerId") !== userId) {
    throw new Error("Forbidden.");
  }

  const source = snapshot.data() as GenerationSource;

  // ── Parse with detailed error logging ──────────────────────────
  let script: PodcastScript;
  try {
    script = podcastScriptSchema.parse(source.script);
  } catch (e: unknown) {
    console.error("Script schema parse failed:", JSON.stringify(source.script)?.slice(0, 300));
    throw new Error(`Script schema invalid: ${errorMessage(e)}`);
  }

  let videoSettings: VideoSettings;
  try {
    videoSettings = videoSettingsSchema.parse(source.videoSettings);
  } catch (e: unknown) {
    console.warn("VideoSettings parse failed, using defaults:", errorMessage(e));
    videoSettings = videoSettingsSchema.parse({});
  }

  let host: SpeakerConfig;
  let guest: SpeakerConfig;
  try {
    host = speakerConfigSchema.parse(source.host);
    guest = speakerConfigSchema.parse(source.guest);
  } catch (e: unknown) {
    console.error("Speaker config parse failed:", errorMessage(e));
    console.error("host data:", JSON.stringify(source.host)?.slice(0, 200));
    console.error("guest data:", JSON.stringify(source.guest)?.slice(0, 200));
    throw new Error(`Speaker config invalid: ${errorMessage(e)}`);
  }

  return {
    title: typeof source.title === "string" ? source.title : script.title,
    script,
    videoSettings,
    speakers: [host, guest],
  };
};

const resolveFfmpegPath = () => serverEnv.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";

const runFfmpeg = async (command: string[]) => {
  const [binary, ...args] = command;
  if (!binary) throw new Error("FFmpeg binary could not be resolved.");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"] });
    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) { resolve(); return; }
      reject(new Error(Buffer.concat(stderr).toString("utf8") || "FFmpeg failed."));
    });
  });
};

async function createStockVideoFromAvatar(filename: string, videoDir: string): Promise<void> {
  const parts = filename.replace(".mp4", "").split("-");
  const gender = parts[0];
  const role = parts[1];
  const imagePath = join(process.cwd(), "public", "avatars", "default", `${gender}-${role}.jpg`);
  const outputPath = join(videoDir, filename);

  if (!existsSync(imagePath)) {
    console.error(`Avatar image not found: ${imagePath}`);
    // Create a solid color video as last resort
    await runFfmpeg([
      resolveFfmpegPath(), "-y",
      "-f", "lavfi",
      "-i", `color=c=0x1a1a2e:size=720x1280:rate=25`,
      "-c:v", "libx264", "-b:v", "500k", "-pix_fmt", "yuv420p",
      "-t", "60",
      outputPath,
    ]);
    console.log(`Created solid color fallback for: ${filename}`);
    return;
  }

  await runFfmpeg([
    resolveFfmpegPath(), "-y",
    "-loop", "1", "-i", imagePath,
    "-vf", "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1",
    "-c:v", "libx264", "-b:v", "1500k", "-pix_fmt", "yuv420p",
    "-t", "60", "-r", "25",
    outputPath,
  ]);
  console.log(`Created stock video: ${filename}`);
}

const ensureRequiredStockVideos = async () => {
  mkdirSync(VIDEO_DIR, { recursive: true });
  for (const filename of REQUIRED_VIDEOS) {
    const fullPath = join(VIDEO_DIR, filename);
    const exists = existsSync(fullPath);
    const size = exists ? statSync(fullPath).size : 0;
    if (!exists || size < 100_000) {
      console.log(`Stock video missing or too small (${size} bytes): ${filename}`);
      await createStockVideoFromAvatar(filename, VIDEO_DIR);
    } else {
      console.log(`Stock video OK: ${filename} (${Math.round(size / 1024)}KB)`);
    }
  }
};

const updateJobStatus = async (
  jobId: string,
  status: JobStatus,
  errorMessage?: string,
  failedStage?: JobStage
) => {
  const update: Record<string, unknown> = {
    status,
    updatedAt: new Date().toISOString(),
  };
  if (errorMessage) update.errorMessage = errorMessage;
  if (failedStage) {
    update.stage = failedStage;
    update[`stages.${failedStage}`] = {
      status,
      progress: 0,
      ...(errorMessage ? { errorMessage } : {}),
    };
  }
  await adminDb.collection("jobs").doc(jobId).update(update);
};

function isRealAudioUrl(url: string): boolean {
  return typeof url === "string" && (
    url.startsWith("http://") || url.startsWith("https://")
  );
}

export async function runVideoGenerationPipeline({
  jobId,
  podcastId,
  userId,
}: VideoWorkerInput) {
  const completedStages = new Set<JobStage>();
  const jobRef = adminDb.collection("jobs").doc(jobId);
  const podcastRef = adminDb.collection("podcasts").doc(podcastId);
  let tempDir: string | null = null;
  let currentStage: JobStage = "audio";

  try {
    tempDir = await mkdtemp(join(tmpdir(), "podcast-video-"));
    console.log("=== Video pipeline started ===");
    console.log("PodcastId:", podcastId);
    console.log("TempDir:", tempDir);

    await jobRef.update({
      status: "running",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // ── Ensure stock videos exist ──────────────────────────────────
    console.log("Checking stock videos...");
    await ensureRequiredStockVideos();

    // ── Load podcast data ──────────────────────────────────────────
    console.log("Loading podcast data...");
    const podcast = await loadPodcastForVideo(podcastId, userId);
    const totalTurns = podcast.script.segments.flatMap(s => s.turns).length;
    console.log("Turns:", totalTurns);
    console.log("Speakers:", podcast.speakers.map(s => `${s.role}/${s.gender}`).join(", "));

    // ── Stage: Audio ───────────────────────────────────────────────
    await assertNotCanceled(jobId);
    currentStage = "audio";
    await updateStage(jobId, "audio", "running", 5, completedStages);

    console.log("Starting audio generation...");
    let audioResult;
    try {
      audioResult = await runAudioWorker(
        { jobId, podcastId, script: podcast.script, speakers: podcast.speakers },
        async (completed, total) => {
          const pct = Math.round((completed / total) * 90);
          console.log(`Audio progress: ${completed}/${total} turns (${pct}%)`);
          await updateStage(jobId, "audio", "running", pct, completedStages);
        }
      );
    } catch (audioErr: unknown) {
      console.error("AUDIO WORKER EXCEPTION:");
      console.error("  Message:", errorMessage(audioErr));
      console.error("  Cause:", errorCauseMessage(audioErr));
      console.error("  Stack:", errorStack(audioErr)?.split("\n").slice(0, 8).join("\n"));
      throw new Error(`Audio generation failed: ${errorMessage(audioErr)}`);
    }

    console.log(`Audio complete: ${audioResult.assets.length} assets`);
    await markStageCompleted(jobId, "audio", completedStages);

    const renderableAudioAssets = audioResult.assets.filter(asset => {
      const valid = isRealAudioUrl(asset.audioUrl);
      if (!valid) {
        console.log(`Skipping turn ${asset.turnId}: URL not renderable (${asset.audioUrl?.slice(0, 50)})`);
      }
      return valid;
    });

    console.log(`Renderable audio assets: ${renderableAudioAssets.length}/${audioResult.assets.length}`);

    if (renderableAudioAssets.length === 0) {
      throw new Error(
        "No turns have real audio. Check GEMINI_API_KEY and Cloudinary config. " +
        "All audio providers failed."
      );
    }

    // ── Stage: Compose (lipsync + movement + compose) ─────────────
    await assertNotCanceled(jobId);
    currentStage = "lipsync";
    await updateStage(jobId, "lipsync", "running", 5, completedStages);

    console.log("Starting compose worker...");
    let composeResult;
    try {
      composeResult = await runComposeWorker({
        jobId,
        podcastId,
        audioAssets: renderableAudioAssets,
        speakers: podcast.speakers,
        script: podcast.script,
        videoSettings: podcast.videoSettings,
        onTurnComplete: async (completed, total) => {
          const progress = total > 0 ? Math.max(5, Math.round((completed / total) * 92)) : 92;
          console.log(`Compose progress: ${completed}/${total} turns`);
          await updateStage(jobId, "lipsync", "running", progress, completedStages);
        },
        onConcatenating: async () => {
          await assertNotCanceled(jobId);
          if (!completedStages.has("lipsync")) await markStageCompleted(jobId, "lipsync", completedStages);
          if (!completedStages.has("movement")) {
            await updateStage(jobId, "movement", "running", 100, completedStages);
            await markStageCompleted(jobId, "movement", completedStages);
          }
          currentStage = "compose";
          await updateStage(jobId, "compose", "running", 35, completedStages);
          console.log("Concatenating turn videos...");
        },
        onFinalizing: async () => {
          await assertNotCanceled(jobId);
          currentStage = "compose";
          await updateStage(jobId, "compose", "running", 82, completedStages);
          console.log("Finalizing video...");
        },
      });
    } catch (composeErr: unknown) {
      console.error("COMPOSE WORKER EXCEPTION:");
      console.error("  Message:", errorMessage(composeErr));
      console.error("  Stack:", errorStack(composeErr)?.split("\n").slice(0, 8).join("\n"));
      throw new Error(`Video compose failed: ${errorMessage(composeErr)}`);
    }

    if (!completedStages.has("lipsync")) await markStageCompleted(jobId, "lipsync", completedStages);
    if (!completedStages.has("movement")) {
      await updateStage(jobId, "movement", "running", 100, completedStages);
      await markStageCompleted(jobId, "movement", completedStages);
    }
    currentStage = "compose";
    await markStageCompleted(jobId, "compose", completedStages);

    // ── Stage: Export ──────────────────────────────────────────────
    await assertNotCanceled(jobId);
    currentStage = "export";
    await updateStage(jobId, "export", "running", 40, completedStages);

    console.log("Saving output URLs to Firestore...");
    console.log("Output URL:", composeResult.outputUrl?.slice(0, 80));

    await jobRef.update({
      outputUrl: composeResult.outputUrl,
      outputStoragePath: composeResult.outputStoragePath,
      posterUrl: composeResult.posterUrl,
      durationSeconds: composeResult.durationSeconds,
      updatedAt: new Date().toISOString(),
    });
    await markStageCompleted(jobId, "export", completedStages);

    await jobRef.update({
      status: "completed",
      progress: 100,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } satisfies Partial<GenerationJob>);

    await podcastRef.update({
      status: "completed",
      currentJobId: jobId,
      videoUrl: composeResult.outputUrl,
      posterUrl: composeResult.posterUrl,
      durationSeconds: composeResult.durationSeconds,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await adminDb.collection("users").doc(userId).set(
      {
        videosGenerated: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    console.log("=== Video pipeline completed successfully ===");

  } catch (error) {
    const message = error instanceof Error ? error.message : "Video generation failed.";
    const canceled = message.toLowerCase().includes("canceled");

    console.error("=== Video pipeline FAILED ===");
    console.error("Stage:", currentStage);
    console.error("Error:", message);
    if (error instanceof Error) {
      console.error("Stack:", error.stack?.split("\n").slice(0, 6).join("\n"));
    }

    await updateJobStatus(jobId, canceled ? "canceled" : "failed", message, currentStage);
    await podcastRef.update({
      status: canceled ? "canceled" : "failed",
      updatedAt: FieldValue.serverTimestamp(),
    });

  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
        .catch(e => console.warn("Cleanup failed:", e));
    }
  }
}
