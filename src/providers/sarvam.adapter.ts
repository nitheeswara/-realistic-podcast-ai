import "server-only";

import { z } from "zod";

import { serverEnv } from "@/config/env";
import { toSarvamTargetLanguageCode } from "@/lib/podcast/provider-catalog";

export interface GenerateSpeechInput {
  text: string;
  languageCode?: string;
  speaker?: string;
  model?: string;
  pace?: number;
  loudness?: number;
  sampleRate?: number;
  enablePreprocessing?: boolean;
}

export interface GeneratedSpeechDto {
  provider: "sarvam";
  speaker: string;
  languageCode: string;
  model: string;
  audio: ArrayBuffer;
  contentType: "audio/wav";
  bytes: number;
}

const sarvamTtsResponseSchema = z
  .object({
    audios: z.array(z.string().min(1)).min(1),
  })
  .passthrough();

const requireApiKey = () => {
  if (!serverEnv.SARVAM_API_KEY) {
    throw new Error("SARVAM_API_KEY is required for Sarvam requests.");
  }

  return serverEnv.SARVAM_API_KEY;
};

const readProviderError = async (response: Response, fallback: string) => {
  try {
    const payload: unknown = await response.json();
    if (typeof payload === "object" && payload !== null) {
      const message = "message" in payload ? (payload as { message?: unknown }).message : undefined;
      const error = "error" in payload ? (payload as { error?: unknown }).error : undefined;
      if (typeof message === "string") {
        return message;
      }
      if (typeof error === "string") {
        return error;
      }
    }
  } catch {
    return fallback;
  }

  return fallback;
};

const toArrayBuffer = (buffer: Buffer): ArrayBuffer =>
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

const toSarvamV2Speaker = (speaker?: string) => {
  const normalized = speaker?.trim().toLowerCase() ?? "";

  if (
    normalized.includes("female") ||
    normalized.includes("woman") ||
    normalized.includes("anushka") ||
    normalized.includes("priya")
  ) {
    return "anushka";
  }

  if (
    normalized.includes("male") ||
    normalized.includes("man") ||
    normalized.includes("arvind") ||
    normalized.includes("shubh") ||
    normalized.includes("abhilash")
  ) {
    return "arvind";
  }

  return "anushka";
};

export const generateSpeech = async (
  input: GenerateSpeechInput
): Promise<GeneratedSpeechDto> => {
  const apiKey = requireApiKey();
  const targetLanguageCode = toSarvamTargetLanguageCode(input.languageCode);
  const speaker = toSarvamV2Speaker(input.speaker);
  const model = input.model ?? "bulbul:v2";
  const response = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: {
      "api-subscription-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: [input.text],
      target_language_code: targetLanguageCode,
      speaker,
      pace: input.pace ?? 1.65,
      loudness: input.loudness ?? 1.5,
      speech_sample_rate: input.sampleRate ?? 8000,
      enable_preprocessing: input.enablePreprocessing ?? true,
      model,
    }),
  });

  if (!response.ok) {
    throw new Error(
      await readProviderError(response, `Sarvam speech failed with status ${response.status}.`)
    );
  }

  const parsed = sarvamTtsResponseSchema.parse(await response.json());
  const audioBuffer = Buffer.from(parsed.audios[0], "base64");
  const audio = toArrayBuffer(audioBuffer);

  return {
    provider: "sarvam",
    speaker,
    languageCode: targetLanguageCode,
    model,
    audio,
    contentType: "audio/wav",
    bytes: audio.byteLength,
  };
};