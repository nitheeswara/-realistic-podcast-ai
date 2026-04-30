import type { Avatar } from "@/types/avatar";
import type { JobStage } from "@/types/jobs";
import type { PodcastFormat, PodcastLanguage } from "@/types/podcast";
import type { AspectRatio, CameraStyle, StudioBackground, SubtitleStyle } from "@/types/video";
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
  "audio",
  "lipsync",
  "movement",
  "compose",
  "export",
] as const satisfies ReadonlyArray<JobStage>;

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

export const avatarOptions = [
  {
    id: "heygen-host-male-1",
    name: "Aarav",
    provider: "heygen",
    mode: "stock",
    gender: "male",
    previewImageUrl:
      "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=420&q=80",
    externalAvatarId: "Aarav_public_001",
  },
  {
    id: "heygen-host-female-1",
    name: "Maya",
    provider: "heygen",
    mode: "stock",
    gender: "female",
    previewImageUrl:
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=420&q=80",
    externalAvatarId: "Maya_public_001",
  },
  {
    id: "heygen-guest-male-1",
    name: "Dev",
    provider: "heygen",
    mode: "stock",
    gender: "male",
    previewImageUrl:
      "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=420&q=80",
    externalAvatarId: "Dev_public_001",
  },
  {
    id: "heygen-guest-female-1",
    name: "Leah",
    provider: "heygen",
    mode: "stock",
    gender: "female",
    previewImageUrl:
      "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=420&q=80",
    externalAvatarId: "Leah_public_001",
  },
] as const satisfies ReadonlyArray<Avatar>;

export const backgroundOptions = [
  {
    value: "midnight",
    label: "Midnight Desk",
    imageUrl:
      "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=480&q=80",
  },
  {
    value: "newsroom",
    label: "Newsroom",
    imageUrl:
      "https://images.unsplash.com/photo-1589903308904-1010c2294adc?auto=format&fit=crop&w=480&q=80",
  },
  {
    value: "warm_studio",
    label: "Warm Studio",
    imageUrl:
      "https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?auto=format&fit=crop&w=480&q=80",
  },
  {
    value: "city",
    label: "City Glass",
    imageUrl:
      "https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=480&q=80",
  },
] as const satisfies ReadonlyArray<{
  value: StudioBackground;
  label: string;
  imageUrl: string;
}>;

export const cameraStyleOptions = [
  {
    value: "locked",
    label: "Locked Frame",
    description: "Stable desk camera with subtle breathing room.",
  },
  {
    value: "push_in",
    label: "Slow Push",
    description: "Gentle emphasis on key moments and turns.",
  },
  {
    value: "two_shot",
    label: "Two Shot Cuts",
    description: "Host and guest coverage with clean reactions.",
  },
] as const satisfies ReadonlyArray<{
  value: CameraStyle;
  label: string;
  description: string;
}>;

export const subtitleStyles = ["minimal", "karaoke", "podcast"] as const satisfies ReadonlyArray<SubtitleStyle>;
export const aspectRatios = ["16:9", "9:16", "1:1"] as const satisfies ReadonlyArray<AspectRatio>;


