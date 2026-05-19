import { z } from "zod";

import {
  jobStages,
  languageOptions,
  podcastFormatOptions,
  voiceModeOptions,
} from "@/lib/podcast/constants";

const valuesOf = <T extends ReadonlyArray<{ value: string }>>(items: T) =>
  items.map((item) => item.value) as [T[number]["value"], ...T[number]["value"][]];

const tupleValues = <T extends ReadonlyArray<string>>(items: T) =>
  [...items] as unknown as [T[number], ...T[number][]];

export const podcastFormatSchema = z.enum(valuesOf(podcastFormatOptions));
export const podcastLanguageSchema = z.enum(valuesOf(languageOptions));
export const voiceModeSchema = z.enum(valuesOf(voiceModeOptions));
export const speakerGenderSchema = z.enum(["male", "female"]);
export const speakerRoleSchema = z.enum(["host", "guest"]);
export const voiceProviderSchema = z.enum(["unrealspeech", "elevenlabs", "sarvam", "gemini", "openai", "custom"]);
export const jobStageSchema = z.enum(tupleValues(jobStages));

export const voiceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  provider: voiceProviderSchema,
  mode: voiceModeSchema,
  gender: speakerGenderSchema,
  languageCode: z.string().min(2),
  accent: z.string().optional(),
  previewUrl: z.string().url().nullable().optional(),
  externalVoiceId: z.string().min(1).optional(),
});

export const scriptTurnSchema = z.object({
  id: z.string().min(1),
  speakerId: speakerRoleSchema,
  text: z.string().min(1).max(1800),
  emotion: z.string().max(80).optional(),
  pauseAfterMs: z.number().int().min(0).max(5000).optional(),
  estimatedDurationSeconds: z.number().min(0).max(600).optional(),
});

export const scriptSegmentSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(140),
  summary: z.string().max(400).optional(),
  turns: z.array(scriptTurnSchema).min(1).max(16),
  order: z.number().int().min(0),
});

export const podcastScriptSchema = z.object({
  id: z.string().min(1),
  podcastId: z.string().min(1),
  title: z.string().min(1).max(160),
  language: z.string().min(2).optional(),
  hook: z.string().max(500).optional(),
  segments: z.array(scriptSegmentSchema).min(1).max(8),
  totalEstimatedDurationSeconds: z.number().min(0).max(3600).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const createPodcastSchema = z.object({
  topic: z.string().trim().min(3).max(200),
  audience: z.string().trim().min(2).max(200),
  format: podcastFormatSchema,
  language: podcastLanguageSchema,
  durationMinutes: z.number().int().min(1).max(15),
  tone: z.string().trim().min(2).max(80),
  keywords: z.array(z.string().trim().min(1).max(40)).max(20),
  avoid: z.string().trim().max(500),
});

export const generateScriptRequestSchema = z.object({
  podcastId: z.string().min(1),
  segmentId: z.string().min(1).optional(),
});

export const speakerConfigSchema = z.object({
  id: speakerRoleSchema,
  name: z.string().min(1).max(80).default("Speaker"),
  role: speakerRoleSchema,
  gender: speakerGenderSchema.default("male"),
  voiceMode: voiceModeSchema.default("ai_stock"),
  voiceId: z.string().min(1).optional(),
  voice: voiceSchema.optional(),
  clonedVoiceId: z.string().min(1).optional(),
  clonedVoiceName: z.string().min(1).max(120).optional(),
  speakingStyle: z.string().max(120).optional(),
});

export const voiceListResponseSchema = z.object({
  voices: z.array(voiceSchema),
});

export const voicePreviewRequestSchema = z.object({
  voiceId: z.string().min(1),
  text: z.string().trim().min(1).max(1000),
  provider: z.enum(["unrealspeech", "elevenlabs", "sarvam", "gemini"]).optional(),
  lang: z.string().min(2).optional(),
  speaker: z.string().min(1).optional(),
});

export const cloneTypeSchema = z.enum(["voice"]);
export const cloneProviderSchema = z.enum(["elevenlabs"]);
export const cloneStatusSchema = z.enum(["not_started", "queued", "processing", "ready", "failed"]);

export const cloneRecordSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  podcastId: z.string().min(1).optional(),
  speaker: speakerRoleSchema.optional(),
  type: cloneTypeSchema,
  provider: cloneProviderSchema,
  providerId: z.string().min(1).optional(),
  externalCloneId: z.string().min(1).optional(),
  name: z.string().min(1).max(160),
  status: cloneStatusSchema,
  trainingStatus: cloneStatusSchema,
  previewUrl: z.string().url().optional(),
  sourceAudioUrl: z.string().url().optional(),
  consentConfirmed: z.boolean(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const cloneListResponseSchema = z.object({
  clones: z.array(cloneRecordSchema),
});
export const generatePodcastRequestSchema = z.object({
  podcastId: z.string().min(1),
  retryJobId: z.string().min(1).optional(),
});

export const stageProgressSchema = z.object({
  status: z.enum(["queued", "running", "completed", "failed", "canceled"]),
  progress: z.number().min(0).max(100),
  errorMessage: z.string().optional(),
});

export const generationJobSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  podcastId: z.string().min(1),
  retryJobId: z.string().min(1).optional(),
  status: z.enum(["queued", "running", "completed", "failed", "canceled"]),
  stage: jobStageSchema,
  stages: z.record(jobStageSchema, stageProgressSchema).optional(),
  progress: z.number().min(0).max(100),
  errorMessage: z.string().optional(),
  audioUrl: z.string().url().optional(),
  audioStoragePath: z.string().optional(),
  audioTurns: z
    .array(
      z.object({
        turnId: z.string().min(1),
        speakerId: speakerRoleSchema,
        text: z.string(),
        durationSeconds: z.number().min(0),
        startSeconds: z.number().min(0),
        endSeconds: z.number().min(0),
      })
    )
    .optional(),
  outputUrl: z.string().url().optional(),
  outputStoragePath: z.string().optional(),
  durationSeconds: z.number().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CreatePodcastInput = z.infer<typeof createPodcastSchema>;
export type GenerateScriptRequest = z.infer<typeof generateScriptRequestSchema>;
export type GeneratePodcastRequest = z.infer<typeof generatePodcastRequestSchema>;



