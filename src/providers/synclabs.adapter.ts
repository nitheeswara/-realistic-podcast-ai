import "server-only";

import { z } from "zod";

import { serverEnv } from "@/config/env";

export type SyncLabsVideoStatus = "queued" | "processing" | "completed" | "failed";

export interface GenerateVideoInput {
  videoUrl: string;
  audioUrl: string;
  poll?: boolean;
  pollIntervalMs?: number;
  maxAttempts?: number;
}

export interface GeneratedVideoDto {
  provider: "synclabs";
  providerJobId: string;
  status: SyncLabsVideoStatus;
  videoUrl?: string;
}

const syncLabsCreateResponseSchema = z
  .object({
    id: z.string().min(1).optional(),
    job_id: z.string().min(1).optional(),
    status: z.string().optional(),
    output_url: z.string().optional(),
    video_url: z.string().optional(),
  })
  .passthrough();

const syncLabsStatusResponseSchema = syncLabsCreateResponseSchema;

const requireApiKey = () => {
  if (!serverEnv.SYNCLABS_API_KEY) {
    throw new Error("SYNCLABS_API_KEY is required for Sync Labs requests.");
  }

  return serverEnv.SYNCLABS_API_KEY;
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

const normalizeStatus = (status: string | undefined): SyncLabsVideoStatus => {
  const normalized = status?.toLowerCase();

  if (normalized === "completed" || normalized === "succeeded" || normalized === "success") {
    return "completed";
  }

  if (normalized === "failed" || normalized === "error") {
    return "failed";
  }

  if (normalized === "queued" || normalized === "created" || normalized === "pending") {
    return "queued";
  }

  return "processing";
};

const readProviderError = async (response: Response, fallback: string) => {
  try {
    const payload: unknown = await response.json();
    if (typeof payload === "object" && payload !== null) {
      const message = "message" in payload ? (payload as { message?: unknown }).message : undefined;
      const error = "error" in payload ? (payload as { error?: unknown }).error : undefined;
      if (typeof message === "string") {
        return message;
      }
      if (typeof error === "string") {
        return error;
      }
    }
  } catch {
    return fallback;
  }

  return fallback;
};

const mapResponse = (payload: z.infer<typeof syncLabsCreateResponseSchema>): GeneratedVideoDto => {
  const providerJobId = payload.id ?? payload.job_id;

  if (!providerJobId) {
    throw new Error("Sync Labs response did not include a job id.");
  }

  return {
    provider: "synclabs",
    providerJobId,
    status: normalizeStatus(payload.status),
    videoUrl: optionalUrl(payload.output_url ?? payload.video_url),
  };
};

const fetchStatus = async (id: string, apiKey: string): Promise<GeneratedVideoDto> => {
  const response = await fetch(`https://api.synclabs.so/lipsync/${encodeURIComponent(id)}`, {
    headers: {
      "x-api-key": apiKey,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      await readProviderError(response, `Sync Labs status failed with status ${response.status}.`)
    );
  }

  return mapResponse(syncLabsStatusResponseSchema.parse(await response.json()));
};

export const generateVideo = async (
  input: GenerateVideoInput
): Promise<GeneratedVideoDto> => {
  const apiKey = requireApiKey();
  const response = await fetch("https://api.synclabs.so/lipsync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      video_url: input.videoUrl,
      audio_url: input.audioUrl,
    }),
  });

  if (!response.ok) {
    throw new Error(
      await readProviderError(response, `Sync Labs video generation failed with status ${response.status}.`)
    );
  }

  const created = mapResponse(syncLabsCreateResponseSchema.parse(await response.json()));

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