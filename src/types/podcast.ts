import type { AudioTurnTiming, GenerationJob } from "@/types/jobs";
import type { PodcastScript } from "@/types/script";
import type { SpeakerConfig } from "@/types/voice";

export type PodcastStatus =
  | "draft"
  | "scripting"
  | "script_ready"
  | "configuring"
  | "queued"
  | "generating"
  | "completed"
  | "failed"
  | "canceled";

export type PodcastFormat =
  | "educational"
  | "casual"
  | "debate"
  | "interview"
  | "storytelling"
  | "news";

export type PodcastLanguage =
  | "tamil"
  | "hindi"
  | "telugu"
  | "malayalam"
  | "kannada"
  | "english"
  | "spanish"
  | "french"
  | "german";

export type PodcastCloningPreset =
  | "full_ai"
  | "clone_host"
  | "clone_guest"
  | "clone_both"
  | "clone_host_voice"
  | "custom";

export interface Podcast {
  id: string;
  userId: string;
  ownerId: string;
  title: string;
  topic: string;
  audience: string;
  format: PodcastFormat;
  language: PodcastLanguage;
  durationMinutes: number;
  tone: string;
  keywords: string[];
  avoid: string;
  description?: string;
  status: PodcastStatus;
  host?: SpeakerConfig;
  guest?: SpeakerConfig;
  speakers: SpeakerConfig[];
  script?: PodcastScript;
  cloningPreset?: PodcastCloningPreset;
  activeJob?: GenerationJob;
  currentJobId?: string;
  audioUrl?: string;
  audioTurns?: AudioTurnTiming[];
  thumbnailUrl?: string;
  durationSeconds?: number;
  creditsSpent: number;
  createdAt: string;
  updatedAt: string;
}
