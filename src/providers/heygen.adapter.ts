import "server-only";

import { z } from "zod";

import { serverEnv } from "@/config/env";
import { normalizeHeyGenAvatar } from "@/lib/podcast/provider-catalog";
import { avatarListResponseSchema } from "@/lib/podcast/schemas";
import type { Avatar } from "@/types/avatar";

export type ProviderVideoStatus = "queued" | "processing" | "completed" | "failed";

export interface GenerateAvatarVideoInput {
  avatarId: string;
  audioUrl: string;
  width?: number;
  height?: number;
  poll?: boolean;
  pollIntervalMs?: number;
  maxAttempts?: number;
}

export interface GeneratedAvatarVideoDto {
  provider: "heygen";
  providerJobId: string;
  status: ProviderVideoStatus;
  videoUrl?: string;
  thumbnailUrl?: string;
}

const heyGenAvatarSchema = z
  .object({
    avatar_id: z.string().min(1),
    avatar_name: z.string().optional(),
    gender: z.string().optional(),
    preview_image_url: z.string().optional(),
    avatar_type: z.string().optional(),
  })
  .passthrough();

const heyGenAvatarsResponseSchema = z.object({
  data: z.object({
    avatars: z.array(heyGenAvatarSchema),
  }),
});

const heyGenGenerateResponseSchema = z
  .object({
    data: z.object({
      video_id: z.string().min(1),
    }),
  })
  .passthrough();

const heyGenStatusResponseSchema = z
  .object({
    data: z
      .object({
        status: z.string().optional(),
        video_url: z.string().optional(),
        thumbnail_url: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const requireApiKey = () => {
  if (!serverEnv.HEYGEN_API_KEY) {
    throw new Error("HEYGEN_API_KEY is required for HeyGen requests.");
  }

  return serverEnv.HEYGEN_API_KEY;
};

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

const wait = (ms: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms);
});

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

const normalizeStatus = (status: string | undefined): ProviderVideoStatus => {
  const normalized = status?.toLowerCase();

  if (normalized === "completed") {
    return "completed";
  }

  if (normalized === "failed") {
    return "failed";
  }

  if (normalized === "pending" || normalized === "waiting" || normalized === "queued") {
    return "queued";
  }

  return "processing";
};

const getVideoStatus = async (
  videoId: string,
  apiKey: string
): Promise<GeneratedAvatarVideoDto> => {
  const response = await fetch(
    `https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
    {
      headers: {
        "X-Api-Key": apiKey,
      },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    throw new Error(
      await readProviderError(response, `HeyGen status failed with status ${response.status}.`)
    );
  }

  const parsed = heyGenStatusResponseSchema.parse(await response.json());

  return {
    provider: "heygen",
    providerJobId: videoId,
    status: normalizeStatus(parsed.data.status),
    videoUrl: optionalUrl(parsed.data.video_url),
    thumbnailUrl: optionalUrl(parsed.data.thumbnail_url),
  };
};

export async function generateHeyGenVideo(params: {
  avatarId: string;
  audioUrl: string;
  turnId: string;
  width?: number;
  height?: number;
}): Promise<string | null> {
  const apiKey = process.env.HEYGEN_API_KEY;

  if (!apiKey) {
    return null;
  }

  const { avatarId, audioUrl, turnId, width = 1280, height = 720 } = params;

  try {
    const createRes = await fetch("https://api.heygen.com/v2/video/generate", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        video_inputs: [
          {
            character: {
              type: "avatar",
              avatar_id: avatarId,
              avatar_style: "normal",
            },
            voice: {
              type: "audio",
              audio_url: audioUrl,
            },
            background: {
              type: "color",
              value: "#1a1a2e",
            },
          },
        ],
        dimension: { width, height },
        aspect_ratio: null,
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      console.error(`HeyGen create failed ${turnId}: ${createRes.status}`, err);
      return null;
    }

    const createData = await createRes.json();
    const videoId = createData?.data?.video_id;

    if (!videoId) {
      console.error("HeyGen returned no video_id:", JSON.stringify(createData));
      return null;
    }

    console.log(`HeyGen job started for ${turnId}: ${videoId}`);

    const startTime = Date.now();
    const timeoutMs = 300_000;

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((resolve) => {
        setTimeout(resolve, 5000);
      });

      const statusRes = await fetch(
        `https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
        { headers: { "x-api-key": apiKey } }
      );

      if (!statusRes.ok) {
        console.warn(`HeyGen status check failed: ${statusRes.status}`);
        continue;
      }

      const statusData = await statusRes.json();
      const status = statusData?.data?.status;
      console.log(`HeyGen ${turnId} status: ${status}`);

      if (status === "completed") {
        const videoUrl = statusData?.data?.video_url;
        if (!videoUrl) {
          return null;
        }
        console.log(`HeyGen completed ${turnId}: ${videoUrl}`);
        return videoUrl;
      }

      if (status === "failed" || status === "error") {
        console.error(`HeyGen failed ${turnId}:`, statusData?.data?.error);
        return null;
      }
    }

    console.error(`HeyGen timeout for ${turnId}`);
    return null;
  } catch (err) {
    console.error(`HeyGen exception ${turnId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export const generateAvatarVideo = async (
  input: GenerateAvatarVideoInput
): Promise<GeneratedAvatarVideoDto> => {
  const apiKey = requireApiKey();
  const response = await fetch("https://api.heygen.com/v2/video/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
    },
    body: JSON.stringify({
      video_inputs: [
        {
          character: {
            type: "avatar",
            avatar_id: input.avatarId,
            avatar_style: "normal",
          },
          voice: {
            type: "audio",
            audio_url: input.audioUrl,
          },
        },
      ],
      dimension: {
        width: input.width ?? 1280,
        height: input.height ?? 720,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(
      await readProviderError(response, `HeyGen video generation failed with status ${response.status}.`)
    );
  }

  const parsed = heyGenGenerateResponseSchema.parse(await response.json());

  if (input.poll === false) {
    return {
      provider: "heygen",
      providerJobId: parsed.data.video_id,
      status: "queued",
    };
  }

  const maxAttempts = input.maxAttempts ?? 30;
  const pollIntervalMs = input.pollIntervalMs ?? 2000;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const status = await getVideoStatus(parsed.data.video_id, apiKey);

    if (status.status === "completed" || status.status === "failed") {
      return status;
    }

    await wait(pollIntervalMs);
  }

  return {
    provider: "heygen",
    providerJobId: parsed.data.video_id,
    status: "processing",
  };
};

export const listAvatars = async (): Promise<Avatar[]> => {
  const apiKey = requireApiKey();
  const response = await fetch("https://api.heygen.com/v2/avatars", {
    headers: {
      "x-api-key": apiKey,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      await readProviderError(response, `HeyGen avatar list failed with status ${response.status}.`)
    );
  }

  const parsed = heyGenAvatarsResponseSchema.parse(await response.json());
  const avatars = parsed.data.avatars
    .map((avatar) =>
      normalizeHeyGenAvatar({
        id: avatar.avatar_id,
        name: avatar.avatar_name ?? "HeyGen Avatar",
        gender: avatar.gender,
        previewImage: optionalUrl(avatar.preview_image_url),
      })
    );

  return avatarListResponseSchema.parse({ avatars }).avatars;
};
