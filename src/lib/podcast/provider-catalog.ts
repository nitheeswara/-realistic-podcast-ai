import type { Avatar } from "@/types/avatar";
import type { SpeakerGender, Voice } from "@/types/voice";

export const SARVAM_LANGS = [
  "ta",
  "hi",
  "te",
  "ml",
  "kn",
  "bn",
  "mr",
  "gu",
  "pa",
] as const;

export type SarvamLanguageCode = (typeof SARVAM_LANGS)[number];

const SARVAM_LANGUAGE_NAMES: Record<SarvamLanguageCode, string> = {
  ta: "Tamil",
  hi: "Hindi",
  te: "Telugu",
  ml: "Malayalam",
  kn: "Kannada",
  bn: "Bengali",
  mr: "Marathi",
  gu: "Gujarati",
  pa: "Punjabi",
};

const sarvamSpeakers = [
  {
    speaker: "shubh",
    name: "Shubh",
    gender: "male",
    mode: "ai_stock",
  },
  {
    speaker: "priya",
    name: "Priya",
    gender: "female",
    mode: "ai_stock",
  },
  {
    speaker: "anushka",
    name: "Anushka",
    gender: "female",
    mode: "ai_premium",
  },
  {
    speaker: "abhilash",
    name: "Abhilash",
    gender: "male",
    mode: "ai_premium",
  },
] as const satisfies ReadonlyArray<{
  speaker: string;
  name: string;
  gender: SpeakerGender;
  mode: Voice["mode"];
}>;

export const normalizeLanguagePrefix = (languageCode?: string | null) => {
  if (!languageCode) {
    return null;
  }

  const [prefix] = languageCode.trim().toLowerCase().split("-");
  return prefix || null;
};

export const isSarvamLanguage = (
  languageCode?: string | null
): languageCode is SarvamLanguageCode => {
  const prefix = normalizeLanguagePrefix(languageCode);
  return SARVAM_LANGS.includes(prefix as SarvamLanguageCode);
};

export const toSarvamTargetLanguageCode = (languageCode?: string | null) => {
  const prefix = normalizeLanguagePrefix(languageCode);

  if (!isSarvamLanguage(prefix)) {
    return "hi-IN";
  }

  return `${prefix}-IN`;
};

export const buildSarvamVoiceOptions = (
  languageCode?: string | null
): Voice[] => {
  const prefix = normalizeLanguagePrefix(languageCode);
  const safePrefix = isSarvamLanguage(prefix) ? prefix : "hi";
  const targetLanguageCode = `${safePrefix}-IN`;
  const languageName = SARVAM_LANGUAGE_NAMES[safePrefix];

  return sarvamSpeakers.map((speaker) => ({
    id: `sarvam-${safePrefix}-${speaker.speaker}`,
    name: `${speaker.name} (${languageName})`,
    provider: "sarvam",
    mode: speaker.mode,
    gender: speaker.gender,
    languageCode: targetLanguageCode,
    accent: "Indian",
    externalVoiceId: speaker.speaker,
  }));
};

export const normalizeSpeakerGender = (
  value: unknown,
  fallback: SpeakerGender = "male"
): SpeakerGender => {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized.includes("female") || normalized.includes("woman")) {
    return "female";
  }

  if (normalized.includes("male") || normalized.includes("man")) {
    return "male";
  }

  return fallback;
};

export const normalizeVoiceMode = (category: unknown): Voice["mode"] => {
  if (typeof category !== "string") {
    return "ai_stock";
  }

  const normalized = category.trim().toLowerCase();
  return normalized.includes("professional") || normalized.includes("premium")
    ? "ai_premium"
    : "ai_stock";
};

export const normalizeHeyGenAvatar = (avatar: {
  id: string;
  name: string;
  gender?: string;
  previewImage?: string;
}): Avatar => ({
  id: avatar.id,
  name: avatar.name,
  provider: "heygen",
  mode: "stock",
  gender: normalizeSpeakerGender(avatar.gender, "female"),
  previewImageUrl: avatar.previewImage,
  externalAvatarId: avatar.id,
});
