import { NextResponse } from "next/server";

import type { SpeakerGender, Voice } from "@/types/voice";

type VoiceListItem = Voice;

interface ElevenLabsVoiceItem {
  voice_id: string;
  name: string;
  labels?: {
    gender?: string;
    accent?: string;
  };
  preview_url?: string | null;
}

const normalizeGender = (value: unknown): SpeakerGender => {
  if (typeof value !== "string") {
    return "female";
  }

  const normalized = value.trim().toLowerCase();

  if (normalized.includes("male") && !normalized.includes("female")) {
    return "male";
  }

  return "female";
};

const GEMINI_VOICES: VoiceListItem[] = [
  {
    id: "gemini_kore",
    name: "Kore (Gemini)",
    gender: "female",
    accent: "american",
    previewUrl: null,
    provider: "gemini",
    mode: "ai_stock",
    languageCode: "en-US",
  },
  {
    id: "gemini_charon",
    name: "Charon (Gemini)",
    gender: "male",
    accent: "american",
    previewUrl: null,
    provider: "gemini",
    mode: "ai_stock",
    languageCode: "en-US",
  },
  {
    id: "gemini_fenrir",
    name: "Fenrir (Gemini)",
    gender: "male",
    accent: "american",
    previewUrl: null,
    provider: "gemini",
    mode: "ai_stock",
    languageCode: "en-US",
  },
  {
    id: "gemini_aoede",
    name: "Aoede (Gemini)",
    gender: "female",
    accent: "american",
    previewUrl: null,
    provider: "gemini",
    mode: "ai_stock",
    languageCode: "en-US",
  },
  {
    id: "gemini_puck",
    name: "Puck (Gemini)",
    gender: "male",
    accent: "american",
    previewUrl: null,
    provider: "gemini",
    mode: "ai_stock",
    languageCode: "en-US",
  },
];

const SARVAM_VOICES: VoiceListItem[] = [
  {
    id: "sarvam_ta_female",
    name: "Anushka (Tamil)",
    gender: "female",
    accent: "tamil",
    previewUrl: null,
    provider: "sarvam",
    mode: "ai_stock",
    languageCode: "ta-IN",
    externalVoiceId: "anushka",
  },
  {
    id: "sarvam_hi_male",
    name: "Arvind (Hindi)",
    gender: "male",
    accent: "hindi",
    previewUrl: null,
    provider: "sarvam",
    mode: "ai_stock",
    languageCode: "hi-IN",
    externalVoiceId: "arvind",
  },
  {
    id: "sarvam_te_female",
    name: "Anushka (Telugu)",
    gender: "female",
    accent: "telugu",
    previewUrl: null,
    provider: "sarvam",
    mode: "ai_stock",
    languageCode: "te-IN",
    externalVoiceId: "anushka",
  },
];

const MOCK_ELEVENLABS_VOICES: VoiceListItem[] = [
  {
    id: "mock_male_1",
    name: "Adam",
    gender: "male",
    accent: "american",
    previewUrl: null,
    provider: "elevenlabs",
    mode: "ai_stock",
    languageCode: "en-US",
  },
  {
    id: "mock_male_2",
    name: "Antoni",
    gender: "male",
    accent: "american",
    previewUrl: null,
    provider: "elevenlabs",
    mode: "ai_stock",
    languageCode: "en-US",
  },
  {
    id: "mock_male_3",
    name: "Arnold",
    gender: "male",
    accent: "american",
    previewUrl: null,
    provider: "elevenlabs",
    mode: "ai_stock",
    languageCode: "en-US",
  },
  {
    id: "mock_female_1",
    name: "Rachel",
    gender: "female",
    accent: "american",
    previewUrl: null,
    provider: "elevenlabs",
    mode: "ai_stock",
    languageCode: "en-US",
  },
  {
    id: "mock_female_2",
    name: "Domi",
    gender: "female",
    accent: "american",
    previewUrl: null,
    provider: "elevenlabs",
    mode: "ai_stock",
    languageCode: "en-US",
  },
  {
    id: "mock_female_3",
    name: "Bella",
    gender: "female",
    accent: "american",
    previewUrl: null,
    provider: "elevenlabs",
    mode: "ai_stock",
    languageCode: "en-US",
  },
];

const MOCK_VOICES: VoiceListItem[] = [
  ...MOCK_ELEVENLABS_VOICES,
  ...SARVAM_VOICES,
  ...GEMINI_VOICES,
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isElevenLabsVoiceItem = (value: unknown): value is ElevenLabsVoiceItem => {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.voice_id === "string" && typeof value.name === "string";
};

const getElevenLabsVoices = (payload: unknown) => {
  if (!isRecord(payload) || !Array.isArray(payload.voices)) {
    return [];
  }

  return payload.voices;
};

export async function GET() {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ voices: MOCK_VOICES });
    }

    const res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": apiKey },
    });

    if (!res.ok) {
      console.error("ElevenLabs voices error:", res.status);
      return NextResponse.json({ voices: MOCK_VOICES });
    }

    const voices = getElevenLabsVoices(await res.json())
      .filter(isElevenLabsVoiceItem)
      .map((voice): VoiceListItem => ({
        id: voice.voice_id,
        name: voice.name,
        gender: normalizeGender(voice.labels?.gender),
        accent: voice.labels?.accent ?? "american",
        previewUrl: voice.preview_url ?? null,
        provider: "elevenlabs",
        mode: "ai_stock",
        languageCode: "en-US",
        externalVoiceId: voice.voice_id,
      }));

    return NextResponse.json({ voices: [...voices, ...SARVAM_VOICES, ...GEMINI_VOICES] });
  } catch (error) {
    console.error("Voice list error:", error);
    return NextResponse.json({ voices: MOCK_VOICES });
  }
}