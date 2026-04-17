export type ScriptSpeakerId = "host" | "guest";

export interface ScriptTurn {
  id: string;
  speakerId: ScriptSpeakerId;
  text: string;
  emotion?: string;
  pauseAfterMs?: number;
  estimatedDurationSeconds?: number;
}

export interface ScriptSegment {
  id: string;
  title: string;
  summary?: string;
  turns: ScriptTurn[];
  order: number;
}

export interface PodcastScript {
  id: string;
  podcastId: string;
  title: string;
  hook?: string;
  segments: ScriptSegment[];
  totalEstimatedDurationSeconds?: number;
  createdAt: string;
  updatedAt: string;
}
