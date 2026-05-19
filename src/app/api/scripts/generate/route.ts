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
  seriesId: z.string().min(1).optional(),
  seriesTitle: z.string().min(1).optional(),
  episodeNumber: z.number().int().min(1).optional(),
  previousEpisodeSummary: z.string().min(1).optional(),
});

function getDurationTarget(duration: string) {
  const numbers = duration.match(/\d+/g)?.map(Number) ?? [5];
  const mins = Math.max(...numbers);
  const clampedMins = Math.max(1, Math.min(60, mins));
  const wordsPerMin = 130;
  const totalWords = clampedMins * wordsPerMin;
  const totalTurns = Math.ceil(totalWords / 40);
  const totalSegments = Math.max(2, Math.ceil(totalTurns / 4));

  return {
    mins: clampedMins,
    totalWords,
    totalTurns,
    totalSegments,
    estimatedDurationSec: clampedMins * 60,
  };
}

const normalizeLanguageCode = (language: string) => {
  const raw = language.trim().toLowerCase();
  const base = raw.split("-")[0] ?? "en";
  const map: Record<string, string> = {
    en: "en",
    english: "en",
    hi: "hi",
    hindi: "hi",
    ta: "ta",
    tamil: "ta",
    te: "te",
    telugu: "te",
    ml: "ml",
    malayalam: "ml",
    kn: "kn",
    kannada: "kn",
    es: "es",
    spanish: "es",
    fr: "fr",
    french: "fr",
    bn: "bn",
    bengali: "bn",
    mr: "mr",
    marathi: "mr",
    gu: "gu",
    gujarati: "gu",
    pa: "pa",
    punjabi: "pa",
  };

  return map[base] ?? base;
};

function getLanguageSpecificInstructions(language: string): string {
  const code = normalizeLanguageCode(language);

  const instructions: Record<string, string> = {
    ta: "Write in natural conversational Tamil as spoken in Tamil Nadu. Use common Tamil expressions like \"இல்லையா?\", \"சரிதானே?\", \"பாருங்க\". Mix in natural Tamil sentence patterns. Do not translate English phrases literally. Use words Tamil speakers actually use in daily conversation.",
    hi: "Write in natural conversational Hindi as spoken in India. Use common expressions like \"यार\", \"देखो\", \"सच में\", \"बिल्कुल सही\". Mix Hinglish naturally where appropriate (as Indians actually speak). Use words and phrases from everyday Hindi conversation.",
    te: "Write in natural conversational Telugu. Use common expressions like \"అవునా?\", \"చూడండి\", \"నిజమే\". Natural Telugu sentence structure and common conversational phrases.",
    ml: "Write in natural conversational Malayalam. Use common expressions like \"അല്ലേ?\", \"ശരിയാണ്\", \"നോക്കൂ\". Natural Malayalam flow as spoken in Kerala.",
    kn: "Write in natural conversational Kannada. Use common expressions like \"ಅಲ್ವಾ?\", \"ನೋಡಿ\", \"ನಿಜವಾಗಿಯೂ\". Natural Kannada as spoken in Karnataka.",
    en: "Write in natural American/British English as spoken in conversation. Use contractions, filler words, and natural speech patterns. Make it sound like a real podcast recording.",
    es: "Write in natural conversational Spanish. Use common expressions and natural speech patterns. Sound like real people talking, not a textbook.",
  };

  return instructions[code] ?? `Write in natural conversational ${language}. Use common expressions and natural speech patterns native speakers use.`;
}

function buildStrictPrompt(
  target: ReturnType<typeof getDurationTarget>,
  language: string,
  langInstructions: string
): string {
  return `You are a podcast scriptwriter. Return ONLY valid JSON, nothing else.

TARGET: ${target.mins}-minute podcast = ${target.totalWords} words = ${target.totalTurns} turns

MANDATORY REQUIREMENTS — YOU MUST FOLLOW ALL OF THESE:
1. Total word count across ALL turns: ${target.totalWords} words MINIMUM
2. Total number of turns: ${target.totalTurns} turns MINIMUM
3. Number of segments: ${target.totalSegments} segments
4. Each turn: 30 to 60 words (NEVER shorter than 30 words)
5. Each segment: 3 to 5 turns

If you write fewer than ${target.totalWords} words, you have FAILED the task.
Count your words carefully. ${target.mins} minutes × 130 words/min = ${target.totalWords} words.

LANGUAGE: ${language}
${langInstructions}

JSON structure:
{
  "title": "string",
  "summary": "string",
  "estimatedDurationSec": ${target.estimatedDurationSec},
  "language": "${language}",
  "segments": [
    {
      "segmentTitle": "string",
      "turns": [
        { "speaker": "host", "text": "At least 30 words here. Make it conversational and natural. The host asks thoughtful questions or shares insights." },
        { "speaker": "guest", "text": "At least 40 words here. Give detailed, informative answers with examples. Do not give one-sentence answers." },
        { "speaker": "host", "text": "Follow-up comment or question, at least 30 words. React to what guest said." },
        { "speaker": "guest", "text": "Detailed response, at least 40 words with specifics and examples." }
      ]
    }
  ]
}

CONVERSATION STYLE:
- Natural speech: contractions (I'm, it's, we're), filler words (you know, actually, look)
- Host: curious, engaged, asks follow-ups, reacts with "Wow", "That's interesting"
- Guest: knowledgeable, gives examples, passionate about the topic
- NOT formal academic language — real people talking

Return ONLY the JSON object.`;
}

function buildUserPrompt(
  topic: string,
  audience: string,
  format: string,
  language: string,
  target: ReturnType<typeof getDurationTarget>,
  tone: string,
  keywords: string,
  avoid: string,
  seriesContext?: string
): string {
  return `Generate a ${target.mins}-minute podcast.

Topic: ${topic}
Audience: ${audience}
Format: ${format}
Language: ${language}
Tone: ${tone}
${keywords ? `Must include: ${keywords}` : ""}
${avoid ? `Avoid: ${avoid}` : ""}
${seriesContext ?? ""}

YOU MUST WRITE:
- Exactly ${target.totalSegments} segments
- At least ${target.totalTurns} total turns
- At least ${target.totalWords} total words
- Each turn must be 30-60 words long

Do not write a short script. Write the FULL ${target.mins}-minute podcast.`;
}

function countScriptWords(script: any): number {
  const turns = script?.segments?.flatMap((segment: any) => segment.turns ?? []) ?? [];
  return turns.reduce((sum: number, turn: any) => sum + String(turn.text ?? "").trim().split(/\s+/).length, 0);
}

function countScriptTurns(script: any): number {
  return script?.segments?.flatMap((segment: any) => segment.turns ?? []).length ?? 0;
}

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

async function generateWithGroq(userPrompt: string, systemPrompt: string): Promise<string> {
  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 4096,
    response_format: { type: "json_object" },
  });

  return response.choices[0].message.content ?? "{}";
}

async function generateWithGemini(userPrompt: string, systemPrompt: string): Promise<string | null> {
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
            system_instruction: { parts: [{ text: systemPrompt }] },
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
      seriesId,
      seriesTitle,
      episodeNumber,
      previousEpisodeSummary,
    } = parsed.data;

    const target = getDurationTarget(duration);
    const langInstructions = getLanguageSpecificInstructions(language);
    const systemPrompt = buildStrictPrompt(target, language, langInstructions);
    const seriesContext = seriesId && episodeNumber && previousEpisodeSummary
      ? `${seriesTitle ? `Series: ${seriesTitle}\n` : ""}This is Episode ${episodeNumber} continuing from Episode ${episodeNumber - 1}.
The previous episode covered: ${previousEpisodeSummary}.
Continue the conversation naturally from where it left off.
Do not repeat what was covered in Episode 1.`
      : undefined;
    const userPrompt = buildUserPrompt(
      topic,
      audience,
      format,
      language,
      target,
      tone,
      keywords,
      avoid,
      seriesContext
    );

    let script: PodcastScript | null = null;
    let attempts = 0;
    const MAX_ATTEMPTS = 3;

    while (attempts < MAX_ATTEMPTS) {
      attempts += 1;
      let raw: string | null = null;

      if (process.env.GROQ_API_KEY) {
        try {
          raw = await generateWithGroq(userPrompt, systemPrompt);
        } catch (error) {
          console.warn(`Groq attempt ${attempts} failed:`, error);
        }
      }

      if (!raw) {
        raw = await generateWithGemini(userPrompt, systemPrompt);
      }

      if (!raw) {
        if (attempts >= MAX_ATTEMPTS) {
          throw new Error("All providers failed");
        }
        continue;
      }

      try {
        const clean = raw
          .replace(/^```json\s*/im, "")
          .replace(/^```\s*/im, "")
          .replace(/```\s*$/im, "")
          .trim();

        const parsedScript = JSON.parse(clean);
        const normalized = normalizeScript(parsedScript, podcastId);

        const wordCount = countScriptWords(normalized);
        const turnCount = countScriptTurns(normalized);

        console.log(
          `Attempt ${attempts}: ${turnCount} turns, ${wordCount} words ` +
          `(needed: ${target.totalTurns} turns, ${target.totalWords} words)`
        );

        const minAcceptableWords = Math.floor(target.totalWords * 0.7);
        const minAcceptableTurns = Math.floor(target.totalTurns * 0.7);
        if (wordCount >= minAcceptableWords && turnCount >= minAcceptableTurns) {
          script = normalized;
          console.log(`Script accepted on attempt ${attempts}: ${wordCount} words, ${turnCount} turns`);
          break;
        }

        console.warn(
          `Script too short (attempt ${attempts}): ${wordCount}/${target.totalWords} words. ` +
          (attempts < MAX_ATTEMPTS ? "Retrying..." : "Using best result so far.")
        );

        if (!script || wordCount > countScriptWords(script)) {
          script = normalized;
        }
      } catch (parseErr: unknown) {
        const message = parseErr instanceof Error ? parseErr.message : "Unknown parsing error";
        console.error(`Parse error attempt ${attempts}:`, message);
        if (attempts >= MAX_ATTEMPTS) {
          throw new Error("Script parsing failed after all retries");
        }
      }
    }

    if (!script) {
      throw new Error("Failed to generate valid script");
    }

    const finalWordCount = countScriptWords(script);
    const finalTurnCount = countScriptTurns(script);
    console.log(`Final script: ${finalTurnCount} turns, ${finalWordCount} words, target: ${target.totalWords} words`);

    return NextResponse.json({ script });
  } catch (error: unknown) {
    console.error("Script generation error:", error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Script generation failed" },
      { status: 500 }
    );
  }
}
