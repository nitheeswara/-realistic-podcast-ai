import { FieldValue } from "firebase-admin/firestore";

import { serverEnv } from "@/config/env";
import { callWav2Lip } from "@/lib/lipsync/wav2lip";
import { jobStages } from "@/lib/podcast/constants";
import { podcastScriptSchema, speakerConfigSchema, videoSettingsSchema } from "@/lib/podcast/schemas";
import { adminDb } from "@/lib/server/firebase-admin";
import type { GenerationJob, JobStage, JobStatus, StageProgress } from "@/types/jobs";
import type { PodcastScript } from "@/types/script";
import type { VideoSettings } from "@/types/video";
import type { SpeakerConfig } from "@/types/voice";
import type { TurnAudioAsset } from "@/workers/audio.worker";
import { runAudioWorker } from "@/workers/audio.worker";
import { runComposeWorker } from "@/workers/compose.worker";
import type { LipsyncClip } from "@/workers/lipsync.worker";
import { runLipsyncWorker } from "@/workers/lipsync.worker";

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

export const createInitialStages = (): Record<JobStage, StageProgress> => {
  const stages = {} as Record<JobStage, StageProgress>;

  for (const stage of jobStages) {
    stages[stage] = {
      status: "queued",
      progress: 0,
    };
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

const loadPodcastForVideo = async (podcastId: string, userId: string): Promise<PodcastForVideo> => {
  const snapshot = await adminDb.collection("podcasts").doc(podcastId).get();

  if (!snapshot.exists) {
    throw new Error("Podcast not found.");
  }

  if (snapshot.get("ownerId") !== userId) {
    throw new Error("Forbidden.");
  }

  const source = snapshot.data() as GenerationSource;
  const script = podcastScriptSchema.parse(source.script);
  const videoSettings = videoSettingsSchema.parse(source.videoSettings);
  const host = speakerConfigSchema.parse(source.host);
  const guest = speakerConfigSchema.parse(source.guest);

  return {
    title: typeof source.title === "string" ? source.title : script.title,
    script,
    videoSettings,
    speakers: [host, guest],
  };
};

const enhanceClipsWithWav2Lip = async ({
  audioAssets,
  clips,
  completedStages,
  jobId,
}: {
  audioAssets: TurnAudioAsset[];
  clips: LipsyncClip[];
  completedStages: Set<JobStage>;
  jobId: string;
}) => {
  const serviceUrl = serverEnv.PYTHON_SERVICE_URL;

  if (!serviceUrl) {
    await updateStage(jobId, "movement", "running", 85, completedStages);
    return clips;
  }

  const enhancedClips: LipsyncClip[] = [];

  for (const clip of clips) {
    const audioAsset = audioAssets.find((asset) => asset.turnId === clip.turnId);
    const canEnhance =
      audioAsset &&
      !audioAsset.audioUrl.startsWith("phase2://") &&
      !clip.clipUrl.startsWith("phase2://");

    if (!canEnhance) {
      enhancedClips.push(clip);
    } else {
      try {
        const enhancedPath = await callWav2Lip(clip.clipUrl, audioAsset.audioUrl, serviceUrl);
        enhancedClips.push({ ...clip, clipUrl: enhancedPath });
      } catch (error) {
        console.warn("Wav2Lip skipped:", error);
        enhancedClips.push(clip);
      }
    }

    await updateStage(
      jobId,
      "movement",
      "running",
      Math.round((enhancedClips.length / Math.max(1, clips.length)) * 92),
      completedStages
    );
  }

  return enhancedClips;
};

export const runVideoGenerationPipeline = async ({
  jobId,
  podcastId,
  userId,
}: VideoWorkerInput) => {
  const completedStages = new Set<JobStage>();
  const jobRef = adminDb.collection("jobs").doc(jobId);
  const podcastRef = adminDb.collection("podcasts").doc(podcastId);

  try {
    await jobRef.update({
      status: "running",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const podcast = await loadPodcastForVideo(podcastId, userId);

    await assertNotCanceled(jobId);
    await updateStage(jobId, "audio", "running", 5, completedStages);
    const audioResult = await runAudioWorker(
      {
        jobId,
        podcastId,
        script: podcast.script,
        speakers: podcast.speakers,
      },
      async (completed, total) => {
        await updateStage(jobId, "audio", "running", Math.round((completed / total) * 90), completedStages);
      }
    );
    await markStageCompleted(jobId, "audio", completedStages);

    await assertNotCanceled(jobId);
    await updateStage(jobId, "lipsync", "running", 5, completedStages);
    const lipsyncResult = await runLipsyncWorker(
      {
        jobId,
        podcastId,
        audioAssets: audioResult.assets,
        speakers: podcast.speakers,
      },
      async (completed, total) => {
        await updateStage(jobId, "lipsync", "running", Math.round((completed / total) * 92), completedStages);
      }
    );
    await markStageCompleted(jobId, "lipsync", completedStages);

    await assertNotCanceled(jobId);
    await updateStage(jobId, "movement", "running", 5, completedStages);
    const enhancedClips = await enhanceClipsWithWav2Lip({
      audioAssets: audioResult.assets,
      clips: lipsyncResult.clips,
      completedStages,
      jobId,
    });
    await markStageCompleted(jobId, "movement", completedStages);

    await assertNotCanceled(jobId);
    await updateStage(jobId, "compose", "running", 25, completedStages);
    const composeResult = await runComposeWorker({
      jobId,
      podcastId,
      clips: enhancedClips,
      script: podcast.script,
      videoSettings: podcast.videoSettings,
    });
    await markStageCompleted(jobId, "compose", completedStages);

    await assertNotCanceled(jobId);
    await updateStage(jobId, "export", "running", 40, completedStages);
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Video generation failed.";
    const canceled = message.toLowerCase().includes("canceled");
    const failedStage = (await jobRef.get()).get("stage") as JobStage | undefined;

    await jobRef.update({
      status: canceled ? "canceled" : "failed",
      errorMessage: message,
      ...(failedStage
        ? {
            [`stages.${failedStage}`]: {
              status: canceled ? "canceled" : "failed",
              progress: 0,
              errorMessage: message,
            },
          }
        : {}),
      updatedAt: new Date().toISOString(),
    });

    await podcastRef.update({
      status: canceled ? "canceled" : "failed",
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
};
