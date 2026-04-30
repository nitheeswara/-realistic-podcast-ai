import { z } from "zod";

import type { PodcastFormat } from "@/types/podcast";

const podcastFormats = [
  "educational",
  "casual",
  "debate",
  "interview",
  "storytelling",
  "news",
] as const satisfies ReadonlyArray<PodcastFormat>;

export const podcastCreationSchema = z.object({
  topic: z.string().trim().min(3),
  audience: z.string().trim().min(1),
  format: z.enum(podcastFormats),
  language: z.string().trim().default("en"),
  duration: z.string().trim().default("5-7 minutes"),
  tone: z.string().trim().default("conversational"),
  keywords: z.string().trim().optional(),
  avoid: z.string().trim().optional(),
});

export type PodcastCreationInput = z.infer<typeof podcastCreationSchema>;