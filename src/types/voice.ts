import type { Avatar, AvatarMode } from "@/types/avatar";

export type VoiceMode = "ai_stock" | "ai_premium" | "cloned";
export type SpeakerRole = "host" | "guest";
export type SpeakerGender = "male" | "female";

export interface Voice {
  id: string;
  name: string;
  provider: "elevenlabs" | "sarvam" | "openai" | "custom";
  mode: VoiceMode;
  gender: SpeakerGender;
  languageCode: string;
  accent?: string;
  previewUrl?: string;
  externalVoiceId?: string;
}

export interface SpeakerConfig {
  id: SpeakerRole;
  name: string;
  role: SpeakerRole;
  voiceMode: VoiceMode;
  voiceId?: string;
  voice?: Voice;
  clonedVoiceId?: string;
  clonedVoiceName?: string;
  avatarMode?: AvatarMode;
  avatarId?: string;
  avatar?: Avatar;
  clonedAvatarId?: string;
  clonedAvatarName?: string;
  clonedAvatarPreviewUrl?: string;
  speakingStyle?: string;
}
