export const INDIAN_LANGUAGE_CODES = [
  "ta", "hi", "te", "ml", "kn", "bn", "mr", "gu", "pa", "or",
  "ta-IN", "hi-IN", "te-IN", "ml-IN", "kn-IN", "bn-IN",
  "mr-IN", "gu-IN", "pa-IN",
];

export const GLOBAL_LANGUAGES = [
  { code: "en", name: "English", flag: "🇺🇸" },
  { code: "es", name: "Spanish", flag: "🇪🇸" },
  { code: "fr", name: "French", flag: "🇫🇷" },
  { code: "de", name: "German", flag: "🇩🇪" },
  { code: "pt", name: "Portuguese", flag: "🇧🇷" },
  { code: "it", name: "Italian", flag: "🇮🇹" },
  { code: "ja", name: "Japanese", flag: "🇯🇵" },
  { code: "ko", name: "Korean", flag: "🇰🇷" },
  { code: "zh", name: "Chinese", flag: "🇨🇳" },
  { code: "ar", name: "Arabic", flag: "🇸🇦" },
];

export const INDIAN_LANGUAGES = [
  { code: "ta", name: "Tamil", flag: "🇮🇳" },
  { code: "hi", name: "Hindi", flag: "🇮🇳" },
  { code: "te", name: "Telugu", flag: "🇮🇳" },
  { code: "ml", name: "Malayalam", flag: "🇮🇳" },
  { code: "kn", name: "Kannada", flag: "🇮🇳" },
  { code: "bn", name: "Bengali", flag: "🇮🇳" },
  { code: "mr", name: "Marathi", flag: "🇮🇳" },
  { code: "gu", name: "Gujarati", flag: "🇮🇳" },
  { code: "pa", name: "Punjabi", flag: "🇮🇳" },
];

export const SARVAM_VOICES_V2 = [
  {
    id: "sarvam-abhilash",
    name: "Abhilash",
    gender: "male",
    provider: "sarvam",
    externalVoiceId: "abhilash",
    language: "Indian",
    model: "bulbul:v2",
  },
  {
    id: "sarvam-karun",
    name: "Karun",
    gender: "male",
    provider: "sarvam",
    externalVoiceId: "karun",
    language: "Indian",
    model: "bulbul:v2",
  },
  {
    id: "sarvam-hitesh",
    name: "Hitesh",
    gender: "male",
    provider: "sarvam",
    externalVoiceId: "hitesh",
    language: "Indian",
    model: "bulbul:v2",
  },
  {
    id: "sarvam-anushka",
    name: "Anushka",
    gender: "female",
    provider: "sarvam",
    externalVoiceId: "anushka",
    language: "Indian",
    model: "bulbul:v2",
  },
  {
    id: "sarvam-manisha",
    name: "Manisha",
    gender: "female",
    provider: "sarvam",
    externalVoiceId: "manisha",
    language: "Indian",
    model: "bulbul:v2",
  },
  {
    id: "sarvam-vidya",
    name: "Vidya",
    gender: "female",
    provider: "sarvam",
    externalVoiceId: "vidya",
    language: "Indian",
    model: "bulbul:v2",
  },
  {
    id: "sarvam-arya",
    name: "Arya",
    gender: "female",
    provider: "sarvam",
    externalVoiceId: "arya",
    language: "Indian",
    model: "bulbul:v2",
  },
] as const;

export function isIndianLanguage(lang: string): boolean {
  const base = lang.toLowerCase().split("-")[0] ?? lang;
  return INDIAN_LANGUAGE_CODES.some((code) => code.toLowerCase().startsWith(base));
}

export function getTTSProvider(lang: string): "sarvam" | "elevenlabs" {
  return isIndianLanguage(lang) ? "sarvam" : "elevenlabs";
}

export function toSarvamLangCode(lang: string): string {
  const base = lang.split("-")[0]?.toLowerCase() ?? "hi";
  return `${base}-IN`;
}
