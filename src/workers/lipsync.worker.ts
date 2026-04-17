import { serverEnv } from "@/config/env";
import { avatarOptions } from "@/lib/podcast/constants";
import { adminStorage } from "@/lib/server/firebase-admin";
import type { SpeakerConfig } from "@/types/voice";
import type { TurnAudioAsset } from "@/workers/audio.worker";

export interface LipsyncWorkerInput {
  jobId: string;
  podcastId: string;
  audioAssets: TurnAudioAsset[];
  speakers: SpeakerConfig[];
}

export interface LipsyncClip {
  turnId: string;
  speakerId: TurnAudioAsset["speakerId"];
  clipUrl: string;
  storagePath?: string;
  durationSeconds: number;
  providerJobId?: string;
}

export interface LipsyncWorkerResult {
  clips: LipsyncClip[];
}

interface DownloadedClip {
  signedUrl: string;
  storagePath: string;
}

const getSpeakerAvatar = (speakers: SpeakerConfig[], speakerId: TurnAudioAsset["speakerId"]) => {
  const speaker = speakers.find((item) => item.id === speakerId || item.role === speakerId);

  if (speaker?.avatarMode === "cloned" && speaker.clonedAvatarId) {
    return {
      id: speaker.clonedAvatarId,
      name: speaker.clonedAvatarName ?? `${speaker.name} avatar clone`,
      provider: "heygen",
      mode: "cloned",
      gender: speaker.role === "host" ? "male" : "female",
      previewImageUrl: speaker.clonedAvatarPreviewUrl,
      externalAvatarId: speaker.clonedAvatarId,
    };
  }

  if (speaker?.avatar) {
    return speaker.avatar;
  }

  return avatarOptions.find((avatar) => avatar.id === speaker?.avatarId);
};

const wait = (ms: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms);
});

const requestHeyGenVideo = async (asset: TurnAudioAsset, avatarId: string) => {
  if (!serverEnv.HEYGEN_API_KEY || asset.audioUrl.startsWith("phase2://")) {
    return null;
  }

  const response = await fetch("https://api.heygen.com/v2/video/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": serverEnv.HEYGEN_API_KEY,
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
            audio_url: asset.audioUrl,
          },
        },
      ],
      dimension: {
        width: 1280,
        height: 720,
      },
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload: unknown = await response.json();
  return typeof payload === "object" &&
    payload !== null &&
    "data" in payload &&
    typeof (payload as { data: { video_id?: unknown } }).data.video_id === "string"
    ? (payload as { data: { video_id: string } }).data.video_id
    : null;
};

const pollHeyGenVideo = async (videoId: string) => {
  if (!serverEnv.HEYGEN_API_KEY) {
    return null;
  }

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(
      `https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
      {
        headers: {
          "X-Api-Key": serverEnv.HEYGEN_API_KEY,
        },
      }
    );

    if (response.ok) {
      const payload: unknown = await response.json();
      const data =
        typeof payload === "object" && payload !== null && "data" in payload
          ? (payload as { data: Record<string, unknown> }).data
          : null;
      const status = typeof data?.status === "string" ? data.status : null;
      const videoUrl = typeof data?.video_url === "string" ? data.video_url : null;

      if (status === "completed" && videoUrl) {
        return videoUrl;
      }

      if (status === "failed") {
        return null;
      }
    }

    await wait(2000);
  }

  return null;
};

const downloadHeyGenClip = async (
  podcastId: string,
  jobId: string,
  turnId: string,
  clipUrl: string
): Promise<DownloadedClip | null> => {
  const response = await fetch(clipUrl, { cache: "no-store" });

  if (!response.ok) {
    return null;
  }

  const storagePath = `generated/${podcastId}/${jobId}/clips/${turnId}.mp4`;
  const contentType = response.headers.get("content-type") ?? "video/mp4";
  const file = adminStorage.bucket().file(storagePath);
  await file.save(Buffer.from(await response.arrayBuffer()), {
    contentType,
    metadata: {
      cacheControl: "private, max-age=31536000",
    },
  });
  const [signedUrl] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 1000 * 60 * 60 * 24 * 7,
  });

  return { signedUrl, storagePath };
};

export const runLipsyncWorker = async (
  input: LipsyncWorkerInput,
  onClipComplete?: (completed: number, total: number) => Promise<void>
): Promise<LipsyncWorkerResult> => {
  const clips: LipsyncClip[] = [];

  for (const asset of input.audioAssets) {
    const avatar = getSpeakerAvatar(input.speakers, asset.speakerId);
    const providerJobId = avatar?.externalAvatarId
      ? await requestHeyGenVideo(asset, avatar.externalAvatarId)
      : null;
    const remoteClipUrl = providerJobId
      ? await pollHeyGenVideo(providerJobId)
      : null;
    const downloadedClip = remoteClipUrl
      ? await downloadHeyGenClip(input.podcastId, input.jobId, asset.turnId, remoteClipUrl)
      : null;

    clips.push({
      turnId: asset.turnId,
      speakerId: asset.speakerId,
      clipUrl: downloadedClip?.signedUrl ?? remoteClipUrl ?? `phase2://clip/${input.jobId}/${asset.turnId}.mp4`,
      storagePath: downloadedClip?.storagePath,
      durationSeconds: asset.durationSeconds,
      providerJobId: providerJobId ?? undefined,
    });

    if (onClipComplete) {
      await onClipComplete(clips.length, input.audioAssets.length);
    }
  }

  return { clips };
};

