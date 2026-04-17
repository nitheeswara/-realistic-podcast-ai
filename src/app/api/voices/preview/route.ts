import { z } from "zod";

import { serverEnv } from "@/config/env";
import { voicePreviewRequestSchema } from "@/lib/podcast/schemas";
import {
  isSarvamLanguage,
  toSarvamTargetLanguageCode,
} from "@/lib/podcast/provider-catalog";
import { ApiAuthError, jsonError, requireUserFromRequest } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sarvamTtsResponseSchema = z
  .object({
    audios: z.array(z.string().min(1)).min(1),
  })
  .passthrough();

const streamElevenLabsPreview = async (voiceId: string, text: string) => {
  if (!serverEnv.ELEVENLABS_API_KEY) {
    throw new Error("ELEVENLABS_API_KEY is required to preview ElevenLabs voices.");
  }

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`,
    {
      method: "POST",
      headers: {
        "xi-api-key": serverEnv.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    }
  );

  if (!response.ok || !response.body) {
    throw new Error(`ElevenLabs preview failed with status ${response.status}.`);
  }

  return new Response(response.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
};

const streamSarvamPreview = async ({
  lang,
  speaker,
  text,
}: {
  lang?: string;
  speaker: string;
  text: string;
}) => {
  if (!serverEnv.SARVAM_API_KEY) {
    throw new Error("SARVAM_API_KEY is required to preview Sarvam voices.");
  }

  const response = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: {
      "api-subscription-key": serverEnv.SARVAM_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: [text],
      target_language_code: toSarvamTargetLanguageCode(lang),
      speaker,
      model: "bulbul:v1",
    }),
  });

  if (!response.ok) {
    throw new Error(`Sarvam preview failed with status ${response.status}.`);
  }

  const payload: unknown = await response.json();
  const parsed = sarvamTtsResponseSchema.parse(payload);
  const audioBuffer = Buffer.from(parsed.audios[0], "base64");

  return new Response(new Uint8Array(audioBuffer), {
    headers: {
      "Content-Type": "audio/wav",
      "Cache-Control": "no-store",
    },
  });
};

export async function POST(request: Request) {
  try {
    await requireUserFromRequest(request);

    const body: unknown = await request.json();
    const parsedBody = voicePreviewRequestSchema.safeParse(body);

    if (!parsedBody.success) {
      return jsonError("Invalid voice preview request.", 400);
    }

    const { provider, lang, speaker, text, voiceId } = parsedBody.data;
    const shouldUseSarvam = provider === "sarvam" || isSarvamLanguage(lang);

    if (shouldUseSarvam) {
      return await streamSarvamPreview({
        lang,
        speaker: speaker ?? voiceId,
        text,
      });
    }

    return await streamElevenLabsPreview(voiceId, text);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return jsonError(error.message, 401);
    }

    const message = error instanceof Error ? error.message : "Voice preview failed.";
    return jsonError(message, 500);
  }
}
