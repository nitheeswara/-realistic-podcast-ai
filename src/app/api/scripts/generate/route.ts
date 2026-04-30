import Groq from "groq-sdk";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { podcastScriptSchema } from "@/lib/podcast/schemas";
import type { PodcastScript, ScriptSpeakerId } from "@/types/script";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });

const Body = z.object({
  topic: z.string().min(1),
  audience: z.string().min(1),
  format: z.string().default("educational"),
  language: z.string().default("en"),
  duration: z.string().default("5-7 minutes"),
  tone: z.string().default("conversational"),
  keywords: z.string().default(""),
  avoid: z.string().default(""),
  podcastId: z.string().min(1).optional(),
  existingScript: z.unknown().optional(),
  segmentId: z.string().min(1).optional(),
});

const SYSTEM_PROMPT = `You are a podcast scriptwriter.
You must respond with ONLY a JSON object. No text before or after.
No markdown. No code fences. No explanation.

The JSON must have EXACTLY these fields:
{
  "title": "Episode title here",
  "summary": "Brief summary here",
  "estimatedDurationSec": 300,
  "language": "en",
  "segments": [
    {
      "segmentTitle": "Opening",
      "turns": [
        { "speaker": "host", "text": "What the host says" },
        { "speaker": "guest", "text": "What the guest says" }
      ]
    }
  ]
}

CRITICAL RULES:
- speaker must be exactly "host" or "guest" in lowercase
- Every segment must have at least 2 turns
- turns must alternate between host and guest
- Return ONLY the JSON object, nothing else at all`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const firstString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
};

const parseDurationSeconds = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  const numeric = Number(trimmed);

  if (Number.isFinite(numeric)) {
    return numeric;
  }

  const rangeMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);

  if (rangeMatch) {
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);

    if (Number.isFinite(start) && Number.isFinite(end)) {
      return Math.round(((start + end) / 2) * 60);
    }
  }

  const minuteMatch = trimmed.match(/(\d+(?:\.\d+)?)/);

  if (minuteMatch) {
    const minutes = Number(minuteMatch[1]);

    if (Number.isFinite(minutes)) {
      return Math.round(minutes * 60);
    }
  }

  return undefined;
};

const normalizeSpeaker = (value: unknown, fallback: ScriptSpeakerId): ScriptSpeakerId => {
  const normalized = String(value ?? fallback).trim().toLowerCase();

  if (normalized.includes("guest")) {
    return "guest";
  }

  if (normalized.includes("host")) {
    return "host";
  }

  return fallback;
};

function normalizeScript(raw: unknown, podcastId?: string): PodcastScript {
  let data = raw;

  while (isRecord(data)) {
    if (isRecord(data.script)) {
      data = data.script;
      continue;
    }

    if (isRecord(data.podcast)) {
      data = data.podcast;
      continue;
    }

    if (isRecord(data.result)) {
      data = data.result;
      continue;
    }

    break;
  }

  if (!isRecord(data)) {
    throw new Error("Script response was not a JSON object");
  }

  const now = new Date().toISOString();
  const segmentSource = Array.isArray(data.segments)
    ? data.segments
    : Array.isArray(data.scenes)
      ? data.scenes
      : Array.isArray(data.sections)
        ? data.sections
        : [];

  const segments = segmentSource
    .map((segment, segmentIndex) => {
      const source = isRecord(segment) ? segment : {};
      const turnSource = Array.isArray(source.turns)
        ? source.turns
        : Array.isArray(source.dialogue)
          ? source.dialogue
          : Array.isArray(source.conversation)
            ? source.conversation
            : Array.isArray(source.lines)
              ? source.lines
              : [];

      const turns = turnSource
        .map((turn, turnIndex) => {
          const item = isRecord(turn) ? turn : {};
          const text = firstString(item.text, item.content, item.line) ?? "";

          if (text.length === 0) {
            return null;
          }

          const fallbackSpeaker: ScriptSpeakerId = turnIndex % 2 === 0 ? "host" : "guest";

          return {
            id: firstString(item.id) ?? `turn-${segmentIndex + 1}-${turnIndex + 1}`,
            speakerId: normalizeSpeaker(item.speaker ?? item.role ?? item.speakerId, fallbackSpeaker),
            text,
            emotion: firstString(item.emotion),
            pauseAfterMs:
              typeof item.pauseAfterMs === "number" && Number.isFinite(item.pauseAfterMs)
                ? Math.max(0, Math.round(item.pauseAfterMs))
                : undefined,
            estimatedDurationSeconds:
              typeof item.estimatedDurationSeconds === "number" && Number.isFinite(item.estimatedDurationSeconds)
                ? item.estimatedDurationSeconds
                : undefined,
          };
        })
        .filter((turn): turn is NonNullable<typeof turn> => turn !== null);

      if (turns.length === 0) {
        return null;
      }

      return {
        id: firstString(source.id) ?? `segment-${segmentIndex + 1}`,
        title: firstString(source.segmentTitle, source.title, source.name) ?? "Segment",
        summary: firstString(source.summary, source.description),
        order:
          typeof source.order === "number" && Number.isFinite(source.order)
            ? source.order
            : segmentIndex,
        turns,
      };
    })
    .filter((segment): segment is NonNullable<typeof segment> => segment !== null);

  const normalized = {
    id: firstString(data.id) ?? `script-${crypto.randomUUID()}`,
    podcastId: firstString(data.podcastId, podcastId) ?? `podcast-${crypto.randomUUID()}`,
    title: firstString(data.title, data.name) ?? "Podcast",
    hook: firstString(data.summary, data.description),
    segments,
    totalEstimatedDurationSeconds:
      parseDurationSeconds(data.totalEstimatedDurationSeconds) ??
      parseDurationSeconds(data.estimatedDurationSec) ??
      parseDurationSeconds(data.duration) ??
      300,
    createdAt: firstString(data.createdAt) ?? now,
    updatedAt: now,
  };

  const parsed = podcastScriptSchema.safeParse(normalized);

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Generated script did not match the expected structure");
  }

  return parsed.data;
}

async function generateWithGroq(userPrompt: string): Promise<string> {
  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 4096,
    response_format: { type: "json_object" },
  });

  return response.choices[0].message.content ?? "{}";
}

async function generateWithGemini(userPrompt: string): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    return null;
  }

  const models = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash-8b",
  ];

  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            generationConfig: {
              temperature: 0.7,
              responseMimeType: "application/json",
            },
          }),
        }
      );

      if (res.status === 429 || res.status === 503) {
        continue;
      }

      if (!res.ok) {
        continue;
      }

      const data = await res.json();
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (raw) {
        console.log(`Script generated with Gemini: ${model}`);
        return raw;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const parsed = Body.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const {
      topic,
      audience,
      format,
      language,
      duration,
      tone,
      keywords,
      avoid,
      podcastId,
    } = parsed.data;

    const userPrompt = `Topic: ${topic}
Audience: ${audience}
Format: ${format}
Language: ${language}
Duration: ${duration}
Tone: ${tone}
${keywords ? `Include keywords: ${keywords}` : ""}
${avoid ? `Avoid: ${avoid}` : ""}`;

    let raw: string | null = null;

    if (process.env.GROQ_API_KEY) {
      try {
        raw = await generateWithGroq(userPrompt);
        console.log("RAW GROQ OUTPUT:", raw?.slice(0, 800));
        console.log("Script generated with Groq llama-3.3-70b");
      } catch (error) {
        console.warn("Groq failed, trying Gemini:", error);
      }
    }

    if (!raw) {
      raw = await generateWithGemini(userPrompt);
    }

    if (!raw) {
      return NextResponse.json(
        { error: "All providers failed. Check GROQ_API_KEY in .env.local" },
        { status: 503 }
      );
    }

    try {
      const clean = raw
        .replace(/^```json\s*/im, "")
        .replace(/^```\s*/im, "")
        .replace(/```\s*$/im, "")
        .trim();

      const parsedScript = JSON.parse(clean);
      const script = normalizeScript(parsedScript, podcastId);

      if (!script.segments || script.segments.length === 0) {
        throw new Error("Script has no segments");
      }

      if (!script.segments.some((segment) => segment.turns.length >= 2)) {
        throw new Error("Script segments have no turns");
      }

      return NextResponse.json({ script });
    } catch (parseErr: unknown) {
      const message = parseErr instanceof Error ? parseErr.message : "Unknown parsing error";

      console.error("Script parse error:", message);
      console.error("Raw output was:", raw?.slice(0, 500));

      return NextResponse.json(
        { error: `Script parsing failed: ${message}` },
        { status: 500 }
      );
    }
  } catch (error: unknown) {
    console.error("Script generation error:", error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Script generation failed" },
      { status: 500 }
    );
  }
}
