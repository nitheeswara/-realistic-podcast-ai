import { NextResponse } from "next/server";

import type { SpeakerGender, Voice } from "@/types/voice";

type VoiceListItem = Voice;

interface ElevenLabsVoiceItem {
  voice_id: string;
  name: string;
  labels?: {
    gender?: string;
    accent?: string;
    language?: string;
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isElevenLabsVoiceItem = (value: unknown): value is ElevenLabsVoiceItem =>
  isRecord(value) &&
  typeof value.voice_id === "string" &&
  typeof value.name === "string";

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
      return NextResponse.json({
        voices: [],
        elevenLabsConfigured: false,
      });
    }

    const res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": apiKey },
    });

    if (!res.ok) {
      console.error("ElevenLabs voices error:", res.status);
      return NextResponse.json({
        voices: [],
        elevenLabsConfigured: true,
        error: `ElevenLabs returned ${res.status}`,
      });
    }

    const voices = getElevenLabsVoices(await res.json())
      .filter(isElevenLabsVoiceItem)
      .map((voice): VoiceListItem => ({
        id: voice.voice_id,
        name: voice.name,
        gender: normalizeGender(voice.labels?.gender),
        accent: voice.labels?.accent ?? voice.labels?.language ?? "Global",
        previewUrl: voice.preview_url ?? null,
        provider: "elevenlabs",
        mode: "ai_stock",
        languageCode: "en-US",
        externalVoiceId: voice.voice_id,
      }));

    return NextResponse.json({
      voices,
      elevenLabsConfigured: true,
    });
  } catch (error) {
    console.error("Voice list error:", error);
    return NextResponse.json({
      voices: [],
      elevenLabsConfigured: Boolean(process.env.ELEVENLABS_API_KEY),
      error: "Could not load ElevenLabs voices",
    });
  }
}
