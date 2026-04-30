import "server-only";

import { z } from "zod";

import { serverEnv } from "@/config/env";
import { podcastScriptSchema } from "@/lib/podcast/schemas";
import type { PodcastFormat, PodcastLanguage } from "@/types/podcast";
import type { PodcastScript } from "@/types/script";

export const GEMINI_SCRIPT_MODEL = "gemini-2.5-flash";

export interface ScriptGenerationBrief {
  id: string;
  topic: string;
  audience: string;
  format: PodcastFormat | string;
  language: PodcastLanguage | string;
  durationMinutes?: number;
  duration?: string;
  tone: string;
  keywords?: string[];
  avoid?: string;
}

export interface GenerateScriptInput {
  podcast: ScriptGenerationBrief;
  existingScript?: PodcastScript;
  segmentId?: string;
  model?: string;
}

export type ScriptProvider = "gemini";

export interface GeneratedScriptDto {
  provider: ScriptProvider;
  model: string;
  script: PodcastScript;
}

export class ScriptGenerationJsonError extends Error {
  constructor(provider: ScriptProvider = "gemini") {
    super(`${provider} returned invalid JSON.`);
    this.name = "ScriptGenerationJsonError";
  }
}

const SYSTEM_PROMPT =
  "You generate production-ready podcast scripts and always respond with a single JSON object.";

const geminiResponseSchema = z
  .object({
    candidates: z
      .array(
        z
          .object({
            content: z
              .object({
                parts: z.array(z.object({ text: z.string().optional() })).optional(),
              })
              .optional(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();

const stripCodeFences = (text: string) =>
  text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

const durationText = (podcast: ScriptGenerationBrief) =>
  podcast.duration ?? `${podcast.durationMinutes ?? 5} minutes`;

const buildPrompt = ({ existingScript, podcast, segmentId }: GenerateScriptInput) => {
  const existingScriptJson = existingScript
    ? `Existing script JSON:\n${JSON.stringify(existingScript)}`
    : "No existing script yet.";

  const segmentDirection = segmentId
    ? `Regenerate only segment ${segmentId}. Return the full script JSON with the regenerated segment replaced and all other segments preserved unless continuity requires tiny bridge edits.`
    : "Generate the full script from scratch.";

  return `You are an expert podcast scriptwriter for realistic AI-hosted video podcasts.
Return only valid JSON matching this TypeScript shape:
{
  "id": string,
  "podcastId": string,
  "title": string,
  "hook"?: string,
  "segments": [{
    "id": string,
    "title": string,
    "summary"?: string,
    "order": number,
    "turns": [{
      "id": string,
      "speakerId": "host" | "guest",
      "text": string,
      "emotion"?: string,
      "pauseAfterMs"?: number,
      "estimatedDurationSeconds"?: number
    }]
  }],
  "totalEstimatedDurationSeconds"?: number,
  "createdAt": string,
  "updatedAt": string
}
Every turn speakerId must be either "host" or "guest".
Make the dialogue sound human, specific, and production-ready.
Avoid stage directions outside JSON fields.

Podcast brief:
Topic: ${podcast.topic}
Audience: ${podcast.audience}
Format: ${podcast.format}
Language: ${podcast.language}
Target duration: ${durationText(podcast)}
Tone: ${podcast.tone}
Keywords: ${podcast.keywords?.join(", ") || "none"}
Avoid: ${podcast.avoid || "none"}

${segmentDirection}
${existingScriptJson}

Use ISO strings for createdAt and updatedAt. Use podcastId "${podcast.id}". Make 3-5 segments with 2-6 turns each unless the duration needs less. Return JSON only.`;
};

const readGeminiError = async (response: Response) => {
  const fallback = `Gemini script generation failed with status ${response.status}.`;

  try {
    const payload: unknown = await response.json();

    if (typeof payload === "object" && payload !== null && "error" in payload) {
      const error = (payload as { error?: { message?: unknown } | string }).error;

      if (typeof error === "string") {
        return error;
      }

      if (typeof error?.message === "string") {
        return error.message;
      }
    }
  } catch {
    return fallback;
  }

  return fallback;
};

const generateScriptContent = async ({
  model = GEMINI_SCRIPT_MODEL,
  prompt,
  systemPrompt,
}: {
  model?: string;
  prompt: string;
  systemPrompt: string;
}): Promise<string> => {
  if (!serverEnv.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is required for Gemini script generation.");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
      serverEnv.GEMINI_API_KEY
    )}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: "application/json",
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(await readGeminiError(response));
  }

  const payload = geminiResponseSchema.parse(await response.json());
  const content = payload.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;

  if (!content) {
    throw new Error("Gemini response did not include text content.");
  }

  return content;
};

const parseScript = (content: string, podcastId: string): PodcastScript => {
  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(stripCodeFences(content));
  } catch {
    throw new ScriptGenerationJsonError();
  }

  const parsedObject = z.record(z.string(), z.unknown()).parse(parsedJson);
  const now = new Date().toISOString();

  return podcastScriptSchema.parse({
    ...parsedObject,
    id: typeof parsedObject.id === "string" ? parsedObject.id : crypto.randomUUID(),
    podcastId,
    createdAt: typeof parsedObject.createdAt === "string" ? parsedObject.createdAt : now,
    updatedAt: now,
  });
};

export async function generateScript(
  input: GenerateScriptInput
): Promise<GeneratedScriptDto>;
export async function generateScript(
  prompt: string,
  systemPrompt: string
): Promise<string>;
export async function generateScript(
  inputOrPrompt: GenerateScriptInput | string,
  systemPrompt?: string
): Promise<GeneratedScriptDto | string> {
  if (typeof inputOrPrompt === "string") {
    return generateScriptContent({
      prompt: inputOrPrompt,
      systemPrompt: systemPrompt ?? SYSTEM_PROMPT,
    });
  }

  const model = inputOrPrompt.model ?? GEMINI_SCRIPT_MODEL;
  const content = await generateScriptContent({
    model,
    prompt: buildPrompt(inputOrPrompt),
    systemPrompt: SYSTEM_PROMPT,
  });

  return {
    provider: "gemini",
    model,
    script: parseScript(content, inputOrPrompt.podcast.id),
  };
}