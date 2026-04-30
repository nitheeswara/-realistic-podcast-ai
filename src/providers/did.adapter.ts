import "server-only";

import { z } from "zod";

import { serverEnv } from "@/config/env";

export type DidVideoStatus = "queued" | "processing" | "completed" | "failed";

export interface GenerateVideoInput {
  sourceUrl: string;
  audioUrl?: string;
  text?: string;
  voiceId?: string;
  poll?: boolean;
  pollIntervalMs?: number;
  maxAttempts?: number;
}

export interface GeneratedVideoDto {
  provider: "did";
  providerJobId: string;
  status: DidVideoStatus;
  videoUrl?: string;
  durationSeconds?: number;
}

const didCreateResponseSchema = z
  .object({
    id: z.string().min(1),
    status: z.string().optional(),
    result_url: z.string().optional(),
    duration: z.number().optional(),
  })
  .passthrough();

const didStatusResponseSchema = didCreateResponseSchema;

const requireApiKey = () => {
  if (!serverEnv.DID_API_KEY) {
    throw new Error("DID_API_KEY is required for D-ID requests.");
  }

  return serverEnv.DID_API_KEY;
};

const wait = (ms: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms);
});

const optionalUrl = (value: string | undefined) => {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value).toString();
  } catch {
    return undefined;
  }
};

const normalizeStatus = (status: string | undefined): DidVideoStatus => {
  const normalized = status?.toLowerCase();

  if (normalized === "done" || normalized === "completed") {
    return "completed";
  }

  if (normalized === "error" || normalized === "failed" || normalized === "rejected") {
    return "failed";
  }

  if (normalized === "created" || normalized === "queued") {
    return "queued";
  }

  return "processing";
};

const readProviderError = async (response: Response, fallback: string) => {
  try {
    const payload: unknown = await response.json();
    if (typeof payload === "object" && payload !== null) {
      const description = "description" in payload
        ? (payload as { description?: unknown }).description
        : undefined;
      const message = "message" in payload ? (payload as { message?: unknown }).message : undefined;
      if (typeof description === "string") {
        return description;
      }
      if (typeof message === "string") {
        return message;
      }
    }
  } catch {
    return fallback;
  }

  return fallback;
};

const mapResponse = (payload: z.infer<typeof didCreateResponseSchema>): GeneratedVideoDto => ({
  provider: "did",
  providerJobId: payload.id,
  status: normalizeStatus(payload.status),
  videoUrl: optionalUrl(payload.result_url),
  durationSeconds: payload.duration,
});

const fetchStatus = async (id: string, apiKey: string): Promise<GeneratedVideoDto> => {
  const response = await fetch(`https://api.d-id.com/talks/${encodeURIComponent(id)}`, {
    headers: {
      Authorization: `Basic ${apiKey}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      await readProviderError(response, `D-ID status failed with status ${response.status}.`)
    );
  }

  return mapResponse(didStatusResponseSchema.parse(await response.json()));
};

export const generateVideo = async (
  input: GenerateVideoInput
): Promise<GeneratedVideoDto> => {
  const apiKey = requireApiKey();

  if (!input.audioUrl && !input.text) {
    throw new Error("Either audioUrl or text is required for D-ID video generation.");
  }

  const response = await fetch("https://api.d-id.com/talks", {
    method: "POST",
    headers: {
      Authorization: `Basic ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source_url: input.sourceUrl,
      script: input.audioUrl
        ? {
            type: "audio",
            audio_url: input.audioUrl,
          }
        : {
            type: "text",
            input: input.text,
            provider: {
              type: "microsoft",
              voice_id: input.voiceId ?? "en-US-JennyNeural",
            },
          },
      config: {
        fluent: true,
        pad_audio: 0,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(
      await readProviderError(response, `D-ID video generation failed with status ${response.status}.`)
    );
  }

  const created = mapResponse(didCreateResponseSchema.parse(await response.json()));

  if (input.poll === false) {
    return created;
  }

  const maxAttempts = input.maxAttempts ?? 30;
  const pollIntervalMs = input.pollIntervalMs ?? 2000;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const status = await fetchStatus(created.providerJobId, apiKey);

    if (status.status === "completed" || status.status === "failed") {
      return status;
    }

    await wait(pollIntervalMs);
  }

  return created.status === "queued" ? { ...created, status: "processing" } : created;
};