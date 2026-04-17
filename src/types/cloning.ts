import type { SpeakerRole } from "@/types/voice";

export type CloneType = "voice" | "avatar";
export type CloneProvider = "elevenlabs" | "heygen";
export type CloneStatus = "not_started" | "queued" | "processing" | "ready" | "failed";

export interface CloningConfig {
  id: string;
  userId: string;
  podcastId?: string;
  speaker?: SpeakerRole;
  type: CloneType;
  provider: CloneProvider;
  providerId?: string;
  externalCloneId?: string;
  name: string;
  status: CloneStatus;
  trainingStatus: CloneStatus;
  previewUrl?: string;
  previewImageUrl?: string;
  sourceAudioUrl?: string;
  sourceImageUrl?: string;
  sourceVideoUrl?: string;
  consentConfirmed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CloneListResponse {
  clones: CloningConfig[];
}
