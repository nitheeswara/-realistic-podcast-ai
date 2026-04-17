import { z } from "zod";

import { serverEnv } from "@/config/env";
import { voiceListResponseSchema } from "@/lib/podcast/schemas";
import {
  buildSarvamVoiceOptions,
  isSarvamLanguage,
  normalizeSpeakerGender,
  normalizeVoiceMode,
} from "@/lib/podcast/provider-catalog";
import { ApiAuthError, jsonError, requireUserFromRequest } from "@/lib/server/auth";
import type { Voice } from "@/types/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

const labelValue = (
  labels: Record<string, unknown> | undefined,
  key: string
) => {
  const value = labels?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
};

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

const listElevenLabsVoices = async (languageCode?: string | null) => {
  if (!serverEnv.ELEVENLABS_API_KEY) {
    throw new Error("ELEVENLABS_API_KEY is required to list ElevenLabs voices.");
  }

  const response = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: {
      "xi-api-key": serverEnv.ELEVENLABS_API_KEY,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs voice list failed with status ${response.status}.`);
  }

  const payload: unknown = await response.json();
  const parsed = elevenLabsResponseSchema.parse(payload);
  const fallbackLanguageCode = languageCode || "en-US";

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
        languageCode: labelValue(voice.labels, "language") ?? fallbackLanguageCode,
        accent,
        previewUrl: optionalUrl(voice.preview_url),
        externalVoiceId: voice.voice_id,
      };
    });

  return voiceListResponseSchema.parse({ voices }).voices;
};

export async function GET(request: Request) {
  try {
    await requireUserFromRequest(request);

    const url = new URL(request.url);
    const languageCode = url.searchParams.get("language") ?? url.searchParams.get("lang");
    const voices = isSarvamLanguage(languageCode)
      ? buildSarvamVoiceOptions(languageCode)
      : await listElevenLabsVoices(languageCode);

    return Response.json({ voices });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return jsonError(error.message, 401);
    }

    const message = error instanceof Error ? error.message : "Voice listing failed.";
    return jsonError(message, 500);
  }
}
