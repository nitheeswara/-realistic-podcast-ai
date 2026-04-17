import { z } from "zod";

import { serverEnv } from "@/config/env";
import { avatarListResponseSchema } from "@/lib/podcast/schemas";
import { normalizeHeyGenAvatar } from "@/lib/podcast/provider-catalog";
import { ApiAuthError, jsonError, requireUserFromRequest } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET(request: Request) {
  try {
    await requireUserFromRequest(request);

    if (!serverEnv.HEYGEN_API_KEY) {
      throw new Error("HEYGEN_API_KEY is required to list HeyGen avatars.");
    }

    const response = await fetch("https://api.heygen.com/v2/avatars", {
      headers: {
        "x-api-key": serverEnv.HEYGEN_API_KEY,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`HeyGen avatar list failed with status ${response.status}.`);
    }

    const payload: unknown = await response.json();
    const parsed = heyGenAvatarsResponseSchema.parse(payload);
    const avatars = parsed.data.avatars
      .filter((avatar) => avatar.avatar_type === "system")
      .map((avatar) =>
        normalizeHeyGenAvatar({
          id: avatar.avatar_id,
          name: avatar.avatar_name ?? "HeyGen Avatar",
          gender: avatar.gender,
          previewImage: optionalUrl(avatar.preview_image_url),
        })
      );

    return Response.json(avatarListResponseSchema.parse({ avatars }));
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return jsonError(error.message, 401);
    }

    const message = error instanceof Error ? error.message : "Avatar listing failed.";
    return jsonError(message, 500);
  }
}
