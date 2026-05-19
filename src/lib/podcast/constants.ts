import type { PodcastFormat, PodcastLanguage } from "@/types/podcast";
import type { Voice, VoiceMode } from "@/types/voice";

export const podcastFormatOptions = [
  {
    value: "educational",
    label: "Educational",
    description: "Clear lessons with examples and takeaways.",
  },
  {
    value: "casual",
    label: "Casual",
    description: "Relaxed banter with natural back-and-forth.",
  },
  {
    value: "debate",
    label: "Debate",
    description: "Two viewpoints, sharp counters, fair conclusions.",
  },
  {
    value: "interview",
    label: "Interview",
    description: "Host-led questions and thoughtful guest answers.",
  },
  {
    value: "storytelling",
    label: "Storytelling",
    description: "Narrative arc, scenes, tension, and payoff.",
  },
  {
    value: "news",
    label: "News",
    description: "Brief, current, crisp, and fact-forward coverage.",
  },
] as const satisfies ReadonlyArray<{
  value: PodcastFormat;
  label: string;
  description: string;
}>;

export const languageOptions = [
  { value: "tamil", label: "Tamil", group: "Indian", code: "ta-IN" },
  { value: "hindi", label: "Hindi", group: "Indian", code: "hi-IN" },
  { value: "telugu", label: "Telugu", group: "Indian", code: "te-IN" },
  { value: "malayalam", label: "Malayalam", group: "Indian", code: "ml-IN" },
  { value: "kannada", label: "Kannada", group: "Indian", code: "kn-IN" },
  { value: "english", label: "English", group: "Global", code: "en-US" },
  { value: "spanish", label: "Spanish", group: "Global", code: "es-ES" },
  { value: "french", label: "French", group: "Global", code: "fr-FR" },
  { value: "german", label: "German", group: "Global", code: "de-DE" },
] as const satisfies ReadonlyArray<{
  value: PodcastLanguage;
  label: string;
  group: "Indian" | "Global";
  code: string;
}>;

export const jobStages = [
  "script",
  "audio",
  "merge",
  "export",
] as const;

export type JobStage = typeof jobStages[number];

export const voiceModeOptions = [
  { value: "ai_stock", label: "AI Stock" },
  { value: "ai_premium", label: "AI Premium" },
  { value: "cloned", label: "Clone your voice" },
] as const satisfies ReadonlyArray<{ value: VoiceMode; label: string }>;

const silentPreview =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

export const voiceOptions = [
  {
    id: "eleven-river",
    name: "River",
    provider: "elevenlabs",
    mode: "ai_stock",
    gender: "male",
    languageCode: "en-US",
    previewUrl: silentPreview,
    externalVoiceId: "pNInz6obpgDQGcFmaJgB",
  },
  {
    id: "eleven-aria",
    name: "Aria",
    provider: "elevenlabs",
    mode: "ai_stock",
    gender: "female",
    languageCode: "en-US",
    previewUrl: silentPreview,
    externalVoiceId: "EXAVITQu4vr4xnSDxMaL",
  },
  {
    id: "sarvam-arvind",
    name: "Arvind",
    provider: "sarvam",
    mode: "ai_stock",
    gender: "male",
    languageCode: "hi-IN",
    previewUrl: silentPreview,
    externalVoiceId: "arvind",
  },
  {
    id: "sarvam-anushka",
    name: "Anushka",
    provider: "sarvam",
    mode: "ai_stock",
    gender: "female",
    languageCode: "ta-IN",
    previewUrl: silentPreview,
    externalVoiceId: "anushka",
  },
  {
    id: "eleven-orion",
    name: "Orion",
    provider: "elevenlabs",
    mode: "ai_premium",
    gender: "male",
    languageCode: "en-US",
    previewUrl: silentPreview,
    externalVoiceId: "onwK4e9ZLuTAKqWW03F9",
  },
  {
    id: "eleven-sera",
    name: "Sera",
    provider: "elevenlabs",
    mode: "ai_premium",
    gender: "female",
    languageCode: "en-US",
    previewUrl: silentPreview,
    externalVoiceId: "21m00Tcm4TlvDq8ikWAM",
  },
] as const satisfies ReadonlyArray<Voice>;


