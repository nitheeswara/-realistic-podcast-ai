import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";

import { serverEnv } from "@/config/env";
import { ApiAuthError, jsonError, requireUserFromRequest } from "@/lib/server/auth";
import { adminDb } from "@/lib/server/firebase-admin";
import type { SpeakerRole } from "@/types/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const speakerSchema = z.enum(["host", "guest"]);

const elevenLabsCloneResponseSchema = z
  .object({
    voice_id: z.string().min(1),
  })
  .passthrough();

const fileToBlob = async (file: File) =>
  new Blob([await file.arrayBuffer()], {
    type: file.type || "audio/mpeg",
  });

const getStringField = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
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

    if (!serverEnv.ELEVENLABS_API_KEY) {
      return jsonError("ELEVENLABS_API_KEY is required for voice cloning.", 500);
    }

    const formData = await request.formData();
    const file = formData.get("audio");
    const podcastId = getStringField(formData, "podcastId");
    const speaker = speakerSchema.safeParse(getStringField(formData, "speaker"));
    const requestedName = getStringField(formData, "name");

    if (!(file instanceof File)) {
      return jsonError("Audio file is required.", 400);
    }

    if (!file.type.includes("mpeg") && !file.type.includes("mp3") && !file.type.includes("wav") && !file.type.includes("webm")) {
      return jsonError("Upload an MP3 or WAV file, or record live audio.", 400);
    }

    if (file.size > 10 * 1024 * 1024) {
      return jsonError("Audio file must be 10MB or smaller.", 400);
    }

    if (!podcastId || !speaker.success) {
      return jsonError("podcastId and speaker are required.", 400);
    }

    const podcastRef = await assertPodcastOwner(podcastId, user.uid);
    const cloneName = requestedName || `${podcastId}_${speaker.data}`;
    const providerForm = new FormData();
    providerForm.append("name", cloneName);
    providerForm.append("files", await fileToBlob(file), file.name || `${speaker.data}.mp3`);

    const providerResponse = await fetch("https://api.elevenlabs.io/v1/voices/add", {
      method: "POST",
      headers: {
        "xi-api-key": serverEnv.ELEVENLABS_API_KEY,
      },
      body: providerForm,
    });

    if (!providerResponse.ok) {
      return jsonError(`ElevenLabs voice clone failed with status ${providerResponse.status}.`, 502);
    }

    const providerPayload: unknown = await providerResponse.json();
    const parsedProvider = elevenLabsCloneResponseSchema.parse(providerPayload);
    const cloneRef = adminDb.collection("clones").doc();
    const now = new Date().toISOString();
    const speakerKey: SpeakerRole = speaker.data;

    await cloneRef.set({
      id: cloneRef.id,
      userId: user.uid,
      podcastId,
      speaker: speakerKey,
      type: "voice",
      provider: "elevenlabs",
      providerId: parsedProvider.voice_id,
      externalCloneId: parsedProvider.voice_id,
      name: cloneName,
      status: "ready",
      trainingStatus: "ready",
      consentConfirmed: true,
      createdAt: now,
      updatedAt: now,
    });

    await podcastRef.update({
      [`${speakerKey}.voiceMode`]: "cloned",
      [`${speakerKey}.clonedVoiceId`]: parsedProvider.voice_id,
      [`${speakerKey}.clonedVoiceName`]: cloneName,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return Response.json({
      cloneId: cloneRef.id,
      voiceId: parsedProvider.voice_id,
      name: cloneName,
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return jsonError(error.message, 401);
    }

    const message = error instanceof Error ? error.message : "Voice clone failed.";
    const status = message === "Forbidden." ? 403 : message === "Podcast not found." ? 404 : 500;
    return jsonError(message, status);
  }
}

