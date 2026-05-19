import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isIndianLanguage, toSarvamLangCode } from "@/lib/podcast/language-config";

const DEFAULT_PREVIEW_TEXT = "Hello, this is a preview of my voice.";
const GEMINI_TTS_MODEL = "gemini-2.0-flash";

const previewBodySchema = z
  .object({
    voiceId: z.string().optional(),
    text: z.string().optional(),
    provider: z.enum(["unrealspeech", "elevenlabs", "sarvam", "gemini"]).optional(),
    language: z.string().optional(),
    lang: z.string().optional(),
    speaker: z.string().optional(),
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

function getPreviewTextForLanguage(langCode: string): string {
  const previews: Record<string, string> = {
    ta: "வணக்கம், இது என் குரலின் மாதிரி. நான் உங்கள் புவுதியை விவரிப்பேன்.",
    hi: "नमस्ते, यह मेरी आवाज़ का नमूना है। मैं आपके पॉडकास्ट का होस्ट हूँ।",
    te: "నమస్కారం, ఇది నా గొంతు నమూనా. నేను మీ పాడ్‌కాస్ట్ హోస్ట్‌ని.",
    ml: "നമസ്കാരം, ഇത് എന്റെ ശബ്ദ സാമ്പിൾ ആണ്. ഞാൻ നിങ്ങളുടെ പോഡ്കാസ്റ്റ് ഹോസ്റ്റ് ആണ്.",
    kn: "ನಮಸ್ಕಾರ, ಇದು ನನ್ನ ಧ್ವನಿ ಮಾದರಿ. ನಾನು ನಿಮ್ಮ ಪಾಡ್ಕಾಸ್ಟ್ ಹೋಸ್ಟ್ ಆಗಿದ್ದೇನೆ.",
    bn: "নমস্কার, এটি আমার কণ্ঠের নমুনা। আমি আপনার পডকাস্টের হোস্ট।",
    mr: "नमस्कार, हे माझ्या आवाजाचे नमुना आहे। मी तुमच्या पॉडकास्टचा होस्ट आहे.",
    gu: "નમસ્તે, આ મારા અવાજનો નમૂનો છે. હું તમારા પોડકાસ્ટનો હોસ્ટ છું.",
    pa: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਇਹ ਮੇਰੀ ਆਵਾਜ਼ ਦਾ ਨਮੂਨਾ ਹੈ। ਮੈਂ ਤੁਹਾਡੇ ਪੋਡਕਾਸਟ ਦਾ ਹੋਸਟ ਹਾਂ।",
  };
  const code = langCode.split("-")[0]?.toLowerCase() ?? "hi";
  return previews[code] ?? previews.hi;
}

const toGeminiVoiceName = (voiceId: string | undefined) => {
  const normalized = voiceId?.trim().toLowerCase().replace(/^gemini_/, "") || "kore";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const toUnrealVoiceName = (voiceId: string | undefined) => {
  const normalized = voiceId?.trim().replace(/^unrealspeech[-_]/i, "");
  return normalized && normalized.length > 0 ? normalized : "Dan";
};

const generateUnrealSpeechPreview = async (previewText: string, voiceId: string | undefined) => {
  const apiKey = process.env.UNREAL_SPEECH_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Unreal Speech API key not configured" },
      { status: 500 }
    );
  }

  const response = await fetch("https://api.v7.unrealspeech.com/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      Text: previewText,
      VoiceId: toUnrealVoiceName(voiceId),
      Bitrate: "192k",
      Speed: "0",
      Pitch: "1",
    }),
  });

  if (!response.ok) {
    const error = await readProviderError(
      response,
      `Unreal Speech preview failed with status ${response.status}`
    );
    return NextResponse.json({ error }, { status: response.status });
  }

  const payload = await response.json() as { OutputUri?: string };

  if (!payload.OutputUri) {
    return NextResponse.json({ error: "Unreal Speech did not return audio." }, { status: 502 });
  }

  const audioResponse = await fetch(payload.OutputUri);

  if (!audioResponse.ok) {
    return NextResponse.json(
      { error: "Could not download Unreal Speech preview." },
      { status: 502 }
    );
  }

  return new Response(audioResponse.body, {
    headers: { "Content-Type": "audio/mpeg" },
  });
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

    const { voiceId, provider } = parsed.data;
    const language = parsed.data.language ?? parsed.data.lang;
    const previewText = getPreviewText(parsed.data.text);

    if (provider === "gemini") {
      return await generateGeminiTtsPreview(previewText, toGeminiVoiceName(voiceId));
    }

    if (provider === "unrealspeech") {
      return await generateUnrealSpeechPreview(previewText, voiceId);
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
            text: previewText ?? "Hello! This is a preview of my voice for your podcast.",
            model_id: "eleven_turbo_v2",
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
          }),
        }
      );

      if (!res.ok) {
        const err = await res.text();
        return NextResponse.json({ error: err }, { status: res.status });
      }

      return new Response(res.body, { headers: { "Content-Type": "audio/mpeg" } });
    }

    if (provider === "sarvam") {
      const apiKey = process.env.SARVAM_API_KEY;
      if (!apiKey) {
        return NextResponse.json({ error: "Sarvam not configured" }, { status: 500 });
      }

      if (!voiceId) {
        return NextResponse.json({ error: "voiceId is required." }, { status: 400 });
      }

      const speakerName = voiceId.replace("sarvam-", "");
      const validSpeakers = ["abhilash", "karun", "hitesh", "anushka", "manisha", "vidya", "arya"];

      if (!validSpeakers.includes(speakerName)) {
        return NextResponse.json(
          { error: `Speaker ${speakerName} not valid for bulbul:v2` },
          { status: 400 }
        );
      }

      const previewLang = language ?? "hi";
      if (!isIndianLanguage(previewLang)) {
        return NextResponse.json(
          { error: "Sarvam previews require an Indian language." },
          { status: 400 }
        );
      }
      const previewTextForLang = getPreviewTextForLanguage(previewLang);

      const res = await fetch("https://api.sarvam.ai/text-to-speech", {
        method: "POST",
        headers: {
          "api-subscription-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: [previewTextForLang],
          target_language_code: language?.includes("-") ? language : toSarvamLangCode(previewLang),
          speaker: speakerName,
          pace: 1.65,
          loudness: 1.5,
          speech_sample_rate: 22050,
          enable_preprocessing: true,
          model: "bulbul:v2",
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error("Sarvam preview failed:", res.status, err);
        return NextResponse.json({ error: err }, { status: res.status });
      }

      const data = await res.json() as { audios?: string[] };
      const b64 = data.audios?.[0];
      if (!b64) {
        return NextResponse.json({ error: "No audio" }, { status: 500 });
      }

      return new Response(Buffer.from(b64, "base64"), {
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
