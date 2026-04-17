export type JobStatus = "queued" | "running" | "completed" | "failed" | "canceled";

export type JobStage = "audio" | "lipsync" | "movement" | "compose" | "export";

export interface StageProgress {
  status: JobStatus;
  progress: number;
  errorMessage?: string;
}

export interface GenerationJob {
  id: string;
  userId: string;
  podcastId: string;
  retryJobId?: string;
  status: JobStatus;
  stage: JobStage;
  stages: Record<JobStage, StageProgress>;
  progress: number;
  errorMessage?: string;
  outputUrl?: string;
  outputStoragePath?: string;
  posterUrl?: string;
  durationSeconds?: number;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}