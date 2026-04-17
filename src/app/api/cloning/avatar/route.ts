import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";

import { serverEnv } from "@/config/env";
import { ApiAuthError, jsonError, requireUserFromRequest } from "@/lib/server/auth";
import { adminDb } from "@/lib/server/firebase-admin";
import type { SpeakerRole } from "@/types/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const speakerSchema = z.enum(["host", "guest"]);

const heyGenPhotoAvatarResponseSchema = z
  .object({
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const getStringField = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
};

const fileToBlob = async (file: File) =>
  new Blob([await file.arrayBuffer()], {
    type: file.type || "image/jpeg",
  });

const getProviderId = (data: Record<string, unknown> | undefined) => {
  const candidates = [
    data?.photo_avatar_id,
    data?.avatar_id,
    data?.id,
  ];

  return candidates.find((value): value is string => typeof value === "string" && value.length > 0) ?? null;
};

const getPreviewImage = (data: Record<string, unknown> | undefined) => {
  const candidates = [
    data?.preview_image_url,
    data?.preview_url,
    data?.image_url,
  ];

  return candidates.find((value): value is string => typeof value === "string" && value.length > 0);
};

const assertPodcastOwner = async (podcastId: string, userId: string) => {
  const podcastRef = adminDb.collection("podcasts").doc(podcastId);
  const snapshot = await podcastRef.get();

  if (!snapshot.exists) {
    throw new Error("Podcast not found.");
  }

  if (snapshot.get("ownerId") !== userId) {
    throw new Error("Forbidden.");
  }

  return podcastRef;
};

export async function POST(request: Request) {
  try {
    const user = await requireUserFromRequest(request);

    if (!serverEnv.HEYGEN_API_KEY) {
      return jsonError("HEYGEN_API_KEY is required for avatar cloning.", 500);
    }

    const formData = await request.formData();
    const file = formData.get("image");
    const podcastId = getStringField(formData, "podcastId");
    const speaker = speakerSchema.safeParse(getStringField(formData, "speaker"));

    if (!(file instanceof File)) {
      return jsonError("Image file is required.", 400);
    }

    if (!file.type.includes("jpeg") && !file.type.includes("jpg") && !file.type.includes("png")) {
      return jsonError("Upload a JPG or PNG file.", 400);
    }

    if (file.size > 10 * 1024 * 1024) {
      return jsonError("Image file must be 10MB or smaller.", 400);
    }

    if (!podcastId || !speaker.success) {
      return jsonError("podcastId and speaker are required.", 400);
    }

    const podcastRef = await assertPodcastOwner(podcastId, user.uid);
    const providerForm = new FormData();
    providerForm.append("file", await fileToBlob(file), file.name || `${speaker.data}.jpg`);

    const providerResponse = await fetch("https://api.heygen.com/v2/photo_avatar/photo/upload", {
      method: "POST",
      headers: {
        "x-api-key": serverEnv.HEYGEN_API_KEY,
      },
      body: providerForm,
    });

    if (!providerResponse.ok) {
      return jsonError(`HeyGen avatar clone failed with status ${providerResponse.status}.`, 502);
    }

    const providerPayload: unknown = await providerResponse.json();
    const parsedProvider = heyGenPhotoAvatarResponseSchema.parse(providerPayload);
    const providerId = getProviderId(parsedProvider.data);

    if (!providerId) {
      return jsonError("HeyGen did not return a photo avatar id.", 502);
    }

    const previewImageUrl = getPreviewImage(parsedProvider.data);
    const cloneRef = adminDb.collection("clones").doc();
    const now = new Date().toISOString();
    const speakerKey: SpeakerRole = speaker.data;
    const cloneName = `${podcastId}_${speakerKey}_avatar`;

    await cloneRef.set({
      id: cloneRef.id,
      userId: user.uid,
      podcastId,
      speaker: speakerKey,
      type: "avatar",
      provider: "heygen",
      providerId,
      externalCloneId: providerId,
      name: cloneName,
      status: "ready",
      trainingStatus: "ready",
      ...(previewImageUrl ? { previewImageUrl } : {}),
      consentConfirmed: true,
      createdAt: now,
      updatedAt: now,
    });

    await podcastRef.update({
      [`${speakerKey}.avatarMode`]: "cloned",
      [`${speakerKey}.clonedAvatarId`]: providerId,
      [`${speakerKey}.clonedAvatarName`]: cloneName,
      ...(previewImageUrl ? { [`${speakerKey}.clonedAvatarPreviewUrl`]: previewImageUrl } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return Response.json({
      cloneId: cloneRef.id,
      avatarId: providerId,
      name: cloneName,
      previewImageUrl,
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return jsonError(error.message, 401);
    }

    const message = error instanceof Error ? error.message : "Avatar clone failed.";
    const status = message === "Forbidden." ? 403 : message === "Podcast not found." ? 404 : 500;
    return jsonError(message, status);
  }
}
