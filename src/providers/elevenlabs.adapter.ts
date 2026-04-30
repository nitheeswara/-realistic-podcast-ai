import "server-only";

import { z } from "zod";

import { serverEnv } from "@/config/env";
import {
  normalizeSpeakerGender,
  normalizeVoiceMode,
} from "@/lib/podcast/provider-catalog";
import { voiceListResponseSchema } from "@/lib/podcast/schemas";
import type { Voice } from "@/types/voice";

export interface GenerateSpeechInput {
  voiceId: string;
  text: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  useSpeakerBoost?: boolean;
}

export interface GeneratedSpeechDto {
  provider: "elevenlabs";
  voiceId: string;
  modelId: string;
  audio: ArrayBuffer;
  contentType: string;
  bytes: number;
}

const elevenLabsVoiceSchema = z
  .object({
    voice_id: z.string().min(1),
    name: z.string().min(1),
    category: z.string().optional(),
    labels: z.record(z.string(), z.unknown()).optional(),
    preview_url: z.string().nullable().optional(),
  })
  .passthrough();

const elevenLabsResponseSchema = z.object({
  voices: z.array(elevenLabsVoiceSchema),
});

const optionalUrl = (value: string | null | undefined) => {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value).toString();
  } catch {
    return undefined;
  }
};

const labelValue = (
  labels: Record<string, unknown> | undefined,
  key: string
) => {
  const value = labels?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
};

const readProviderError = async (response: Response, fallback: string) => {
  try {
    const payload: unknown = await response.json();
    if (typeof payload === "object" && payload !== null) {
      const detail = "detail" in payload ? (payload as { detail?: unknown }).detail : undefined;
      const message = "message" in payload ? (payload as { message?: unknown }).message : undefined;
      if (typeof detail === "string") {
        return detail;
      }
      if (typeof message === "string") {
        return message;
      }
    }
  } catch {
    return fallback;
  }

  return fallback;
};

const requireApiKey = () => {
  if (!serverEnv.ELEVENLABS_API_KEY) {
    throw new Error("ELEVENLABS_API_KEY is required for ElevenLabs requests.");
  }

  return serverEnv.ELEVENLABS_API_KEY;
};

export const generateSpeech = async (
  input: GenerateSpeechInput
): Promise<GeneratedSpeechDto> => {
  const apiKey = requireApiKey();
  const modelId = input.modelId ?? "eleven_multilingual_v2";
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(input.voiceId)}`,
    {
      method: "POST",
      headers: {
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text: input.text,
        model_id: modelId,
        voice_settings: {
          stability: input.stability ?? 0.45,
          similarity_boost: input.similarityBoost ?? 0.78,
          style: input.style ?? 0.3,
          use_speaker_boost: input.useSpeakerBoost ?? true,
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(
      await readProviderError(response, `ElevenLabs speech failed with status ${response.status}.`)
    );
  }

  const audio = await response.arrayBuffer();

  return {
    provider: "elevenlabs",
    voiceId: input.voiceId,
    modelId,
    audio,
    contentType: response.headers.get("content-type") ?? "audio/mpeg",
    bytes: audio.byteLength,
  };
};

export const listVoices = async (languageCode = "en-US"): Promise<Voice[]> => {
  const apiKey = requireApiKey();
  const response = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: {
      "xi-api-key": apiKey,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      await readProviderError(response, `ElevenLabs voice list failed with status ${response.status}.`)
    );
  }

  const payload: unknown = await response.json();
  const parsed = elevenLabsResponseSchema.parse(payload);
  const voices: Voice[] = parsed.voices
    .filter((voice) => voice.category?.toLowerCase() !== "cloned")
    .map((voice, index) => {
      const accent = labelValue(voice.labels, "accent");
      const gender = normalizeSpeakerGender(
        labelValue(voice.labels, "gender"),
        index % 2 === 0 ? "male" : "female"
      );
      const mode = normalizeVoiceMode(
        labelValue(voice.labels, "tier") ?? voice.category
      );

      return {
        id: voice.voice_id,
        name: voice.name,
        provider: "elevenlabs",
        mode,
        gender,
        languageCode: labelValue(voice.labels, "language") ?? languageCode,
        accent,
        previewUrl: optionalUrl(voice.preview_url),
        externalVoiceId: voice.voice_id,
      };
    });

  return voiceListResponseSchema.parse({ voices }).voices;
};