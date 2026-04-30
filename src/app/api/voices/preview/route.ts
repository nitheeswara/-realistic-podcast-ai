import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const ELEVENLABS_TTS_PERMISSION_ERROR =
  "ElevenLabs key missing TTS permission. Please regenerate your API key at elevenlabs.io with full permissions.";
const ELEVENLABS_RATE_LIMIT_ERROR = "ElevenLabs free tier limit reached.";
const DEFAULT_PREVIEW_TEXT = "Hello, this is a preview of my voice.";
const DEFAULT_SARVAM_PREVIEW_TEXT = "Vanakkam, this is a preview of my voice.";
const GEMINI_TTS_MODEL = "gemini-2.0-flash";

const previewBodySchema = z
  .object({
    voiceId: z.string().optional(),
    text: z.string().optional(),
    provider: z.enum(["elevenlabs", "sarvam", "gemini"]).optional(),
    language: z.string().optional(),
    lang: z.string().optional(),
    speaker: z.string().optional(),
  })
  .passthrough();

const sarvamTtsResponseSchema = z
  .object({
    audios: z.array(z.string().min(1)).min(1),
  })
  .passthrough();

const geminiTtsResponseSchema = z
  .object({
    candidates: z
      .array(
        z
          .object({
            content: z
              .object({
                parts: z
                  .array(
                    z
                      .object({
                        inlineData: z
                          .object({
                            data: z.string().min(1),
                            mimeType: z.string().optional(),
                          })
                          .optional(),
                      })
                      .passthrough()
                  )
                  .optional(),
              })
              .optional(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();

const readProviderError = async (response: Response, fallback: string) => {
  try {
    const payload: unknown = await response.json();

    if (typeof payload === "object" && payload !== null) {
      const error = "error" in payload ? (payload as { error?: unknown }).error : undefined;
      const message = "message" in payload ? (payload as { message?: unknown }).message : undefined;

      if (typeof message === "string") {
        return message;
      }

      if (typeof error === "string") {
        return error;
      }

      if (typeof error === "object" && error !== null && "message" in error) {
        const nestedMessage = (error as { message?: unknown }).message;
        if (typeof nestedMessage === "string") {
          return nestedMessage;
        }
      }
    }
  } catch {
    try {
      const text = await response.text();
      return text || fallback;
    } catch {
      return fallback;
    }
  }

  return fallback;
};

const getPreviewText = (text: string | undefined, fallback = DEFAULT_PREVIEW_TEXT) => {
  const trimmed = text?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
};

const normalizeLanguagePrefix = (value: string | undefined) => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return "ta";
  }

  return normalized.split("-")[0] || "ta";
};

const toSarvamLanguageCode = (value: string | undefined) => {
  const prefix = normalizeLanguagePrefix(value);
  return `${prefix}-IN`;
};

const toSarvamV2Speaker = (value: string | undefined) => {
  const normalized = value?.trim().toLowerCase() ?? "";

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

const toGeminiVoiceName = (voiceId: string | undefined) => {
  const normalized = voiceId?.trim().toLowerCase().replace(/^gemini_/, "") || "kore";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const generateGeminiTtsPreview = async (previewText: string, voiceName = "Kore") => {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required for Gemini TTS fallback.");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent?key=${encodeURIComponent(
      apiKey
    )}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: previewText }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(
      await readProviderError(response, `Gemini TTS fallback failed with status ${response.status}.`)
    );
  }

  const payload = geminiTtsResponseSchema.parse(await response.json());
  const inlineData = payload.candidates?.[0]?.content?.parts?.find(
    (part) => part.inlineData?.data
  )?.inlineData;

  if (!inlineData?.data) {
    throw new Error("Gemini TTS fallback did not return audio.");
  }

  return new Response(Buffer.from(inlineData.data, "base64"), {
    headers: { "Content-Type": "audio/wav" },
  });
};

export async function POST(req: NextRequest) {
  try {
    const parsed = previewBodySchema.safeParse(await req.json());

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid voice preview request." }, { status: 400 });
    }

    const { voiceId, provider, speaker } = parsed.data;
    const language = parsed.data.language ?? parsed.data.lang;
    const previewText = getPreviewText(parsed.data.text);

    if (provider === "gemini") {
      return await generateGeminiTtsPreview(previewText, toGeminiVoiceName(voiceId));
    }

    if (provider === "elevenlabs" || !provider) {
      const apiKey = process.env.ELEVENLABS_API_KEY;

      if (!apiKey) {
        return NextResponse.json(
          { error: "ElevenLabs API key not configured" },
          { status: 500 }
        );
      }

      if (!voiceId) {
        return NextResponse.json({ error: "voiceId is required." }, { status: 400 });
      }

      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`,
        {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: previewText,
            model_id: "eleven_turbo_v2",
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
            },
          }),
        }
      );

      if (res.status === 401) {
        console.error("ElevenLabs TTS permission error; trying Gemini TTS fallback.");

        try {
          return await generateGeminiTtsPreview(previewText);
        } catch (fallbackError) {
          console.error("Gemini TTS fallback error:", fallbackError);
          return NextResponse.json(
            { error: ELEVENLABS_TTS_PERMISSION_ERROR },
            { status: 401 }
          );
        }
      }

      if (res.status === 429) {
        return NextResponse.json(
          { error: ELEVENLABS_RATE_LIMIT_ERROR },
          { status: 429 }
        );
      }

      if (!res.ok) {
        const error = await readProviderError(
          res,
          `ElevenLabs preview failed with status ${res.status}`
        );
        console.error("ElevenLabs error:", res.status, error);
        return NextResponse.json({ error }, { status: res.status });
      }

      return new Response(res.body, {
        headers: { "Content-Type": "audio/mpeg" },
      });
    }

    if (provider === "sarvam") {
      const apiKey = process.env.SARVAM_API_KEY;

      if (!apiKey) {
        return NextResponse.json(
          { error: "Sarvam API key not configured" },
          { status: 500 }
        );
      }

      const res = await fetch("https://api.sarvam.ai/text-to-speech", {
        method: "POST",
        headers: {
          "api-subscription-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: [getPreviewText(parsed.data.text, DEFAULT_SARVAM_PREVIEW_TEXT)],
          target_language_code: toSarvamLanguageCode(language),
          speaker: toSarvamV2Speaker(speaker ?? voiceId),
          pace: 1.65,
          loudness: 1.5,
          speech_sample_rate: 8000,
          enable_preprocessing: true,
          model: "bulbul:v2",
        }),
      });

      if (!res.ok) {
        const error = await readProviderError(
          res,
          `Sarvam preview failed with status ${res.status}`
        );
        console.error("Sarvam error:", res.status, error);
        return NextResponse.json({ error }, { status: res.status });
      }

      const data = sarvamTtsResponseSchema.parse(await res.json());
      return new Response(Buffer.from(data.audios[0], "base64"), {
        headers: { "Content-Type": "audio/wav" },
      });
    }

    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  } catch (error) {
    console.error("Voice preview error:", error);
    const message = error instanceof Error ? error.message : "Preview failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}