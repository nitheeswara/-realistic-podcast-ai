export type VoiceMode = "ai_stock" | "ai_premium" | "cloned";
export type SpeakerRole = "host" | "guest";
export type SpeakerGender = "male" | "female";

export interface Voice {
  id: string;
  name: string;
  provider: "unrealspeech" | "elevenlabs" | "sarvam" | "gemini" | "openai" | "custom";
  mode: VoiceMode;
  gender: SpeakerGender;
  languageCode: string;
  accent?: string;
  previewUrl?: string | null;
  externalVoiceId?: string;
}

export interface SpeakerConfig {
  id: SpeakerRole;
  name: string;
  role: SpeakerRole;
  gender?: SpeakerGender;
  voiceMode: VoiceMode;
  voiceId?: string;
  voice?: Voice;
  clonedVoiceId?: string;
  clonedVoiceName?: string;
  speakingStyle?: string;
}
