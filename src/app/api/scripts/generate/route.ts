import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { Schema } from "@google/generative-ai";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";

import { serverEnv } from "@/config/env";
import { generateScriptRequestSchema, podcastScriptSchema } from "@/lib/podcast/schemas";
import { ApiAuthError, jsonError, requireUserFromRequest } from "@/lib/server/auth";
import { adminDb } from "@/lib/server/firebase-admin";
import type { PodcastScript } from "@/types/script";

export const runtime = "nodejs";

type PodcastBrief = z.infer<typeof podcastBriefSchema>;

const podcastBriefSchema = z
  .object({
    id: z.string().min(1),
    ownerId: z.string().min(1),
    topic: z.string().min(1),
    audience: z.string().min(1),
    format: z.string().min(1),
    language: z.string().min(1),
    durationMinutes: z.number().min(1).max(15),
    tone: z.string().min(1),
    keywords: z.array(z.string()).default([]),
    avoid: z.string().default(""),
    script: podcastScriptSchema.optional(),
  })
  .passthrough();

const responseSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    id: { type: SchemaType.STRING },
    podcastId: { type: SchemaType.STRING },
    title: { type: SchemaType.STRING },
    hook: { type: SchemaType.STRING },
    totalEstimatedDurationSeconds: { type: SchemaType.NUMBER },
    createdAt: { type: SchemaType.STRING },
    updatedAt: { type: SchemaType.STRING },
    segments: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          id: { type: SchemaType.STRING },
          title: { type: SchemaType.STRING },
          summary: { type: SchemaType.STRING },
          order: { type: SchemaType.INTEGER },
          turns: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                id: { type: SchemaType.STRING },
                speakerId: {
                  type: SchemaType.STRING,
                  format: "enum",
                  enum: ["host", "guest"],
                },
                text: { type: SchemaType.STRING },
                emotion: { type: SchemaType.STRING },
                pauseAfterMs: { type: SchemaType.INTEGER },
                estimatedDurationSeconds: { type: SchemaType.NUMBER },
              },
              required: ["id", "speakerId", "text"],
            },
          },
        },
        required: ["id", "title", "turns", "order"],
      },
    },
  },
  required: ["id", "podcastId", "title", "segments", "createdAt", "updatedAt"],
};

const stripCodeFences = (text: string) =>
  text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

const buildPrompt = (podcast: PodcastBrief, segmentId?: string) => {
  const existingScript = podcast.script
    ? `Existing script JSON:\n${JSON.stringify(podcast.script)}`
    : "No existing script yet.";

  const segmentDirection = segmentId
    ? `Regenerate only segment ${segmentId}. Return the full script JSON with the regenerated segment replaced and all other segments preserved unless continuity requires tiny bridge edits.`
    : "Generate the full script from scratch.";

  return `You are an expert podcast scriptwriter for realistic AI-hosted video podcasts.
Return only JSON matching this structure exactly: PodcastScript with segments and turns.
Every turn speakerId must be either "host" or "guest".
Make the dialogue sound human, specific, and production-ready.
Avoid stage directions outside the JSON fields.

Podcast brief:
Topic: ${podcast.topic}
Audience: ${podcast.audience}
Format: ${podcast.format}
Language: ${podcast.language}
Target duration: ${podcast.durationMinutes} minutes
Tone: ${podcast.tone}
Keywords: ${podcast.keywords.join(", ") || "none"}
Avoid: ${podcast.avoid || "none"}

${segmentDirection}
${existingScript}

Use ISO strings for createdAt and updatedAt. Use podcastId "${podcast.id}". Make 3-5 segments with 2-6 turns each unless the duration needs less.`;
};

const generateScriptWithGemini = async (
  podcast: PodcastBrief,
  segmentId?: string
): Promise<PodcastScript> => {
  if (!serverEnv.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is required to generate scripts.");
  }

  const genAI = new GoogleGenerativeAI(serverEnv.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    generationConfig: {
      temperature: 0.8,
      responseMimeType: "application/json",
      responseSchema,
    },
  });

  const result = await model.generateContent(buildPrompt(podcast, segmentId));
  const rawText = result.response.text();
  const parsedJson: unknown = JSON.parse(stripCodeFences(rawText));
  const parsedObject = z.record(z.string(), z.unknown()).parse(parsedJson);
  const now = new Date().toISOString();

  const script = podcastScriptSchema.parse({
    ...parsedObject,
    id: typeof parsedObject.id === "string" ? parsedObject.id : crypto.randomUUID(),
    podcastId: podcast.id,
    createdAt: typeof parsedObject.createdAt === "string" ? parsedObject.createdAt : now,
    updatedAt: now,
  });

  return script;
};

export async function POST(request: Request) {
  try {
    const user = await requireUserFromRequest(request);
    const body: unknown = await request.json();
    const parsedBody = generateScriptRequestSchema.safeParse(body);

    if (!parsedBody.success) {
      return jsonError("Invalid script generation request.", 400);
    }

    const podcastRef = adminDb.collection("podcasts").doc(parsedBody.data.podcastId);
    const snapshot = await podcastRef.get();

    if (!snapshot.exists) {
      return jsonError("Podcast not found.", 404);
    }

    const podcast = podcastBriefSchema.parse({ id: snapshot.id, ...snapshot.data() });

    if (podcast.ownerId !== user.uid) {
      return jsonError("Forbidden.", 403);
    }

    await podcastRef.update({
      status: "scripting",
      updatedAt: FieldValue.serverTimestamp(),
    });

    const script = await generateScriptWithGemini(podcast, parsedBody.data.segmentId);

    await podcastRef.update({
      script,
      status: "script_ready",
      updatedAt: FieldValue.serverTimestamp(),
    });

    return Response.json({ script });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return jsonError(error.message, 401);
    }

    const message = error instanceof Error ? error.message : "Script generation failed.";
    return jsonError(message, 500);
  }
}





