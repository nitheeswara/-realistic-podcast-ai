import type { JobStage } from "@/lib/podcast/constants";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "canceled";

export type { JobStage };

export interface StageProgress {
  status: JobStatus;
  progress: number;
  errorMessage?: string;
}

export interface AudioTurnTiming {
  turnId: string;
  speakerId: "host" | "guest";
  text: string;
  durationSeconds: number;
  startSeconds: number;
  endSeconds: number;
}

export interface GenerationJob {
  id: string;
  userId: string;
  podcastId: string;
  type?: "audio_generation" | string;
  retryJobId?: string;
  status: JobStatus;
  stage: JobStage;
  stages?: Record<JobStage, StageProgress>;
  progress: number;
  errorMessage?: string;
  audioUrl?: string;
  audioStoragePath?: string;
  audioTurns?: AudioTurnTiming[];
  outputUrl?: string;
  outputStoragePath?: string;
  durationSeconds?: number;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}
