import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ffmpegStatic from "ffmpeg-static";

import { serverEnv } from "@/config/env";
import { composePodcastSingleSpeaker } from "@/lib/ffmpeg/composer";
import {
  uploadImage as cloudinaryUploadImage,
  uploadVideo as cloudinaryUploadVideo,
} from "@/lib/server/storage";
import type { PodcastScript } from "@/types/script";
import type { VideoSettings } from "@/types/video";
import type { SpeakerConfig } from "@/types/voice";
import type { TurnAudioAsset } from "@/workers/audio.worker";

export interface ComposeWorkerInput {
  jobId: string;
  podcastId: string;
  audioAssets: TurnAudioAsset[];
  speakers: SpeakerConfig[];
  script: PodcastScript;
  videoSettings: VideoSettings;
  onTurnComplete?: (completed: number, total: number) => Promise<void>;
  onConcatenating?: () => Promise<void>;
  onFinalizing?: () => Promise<void>;
}

export interface ComposeWorkerResult {
  outputUrl: string;
  outputStoragePath: string;
  posterUrl: string;
  durationSeconds: number;
  ffmpegPath: string;
  commandPlan: string[];
}

const fallbackPosterPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGOSHzRgQAAAABJRU5ErkJggg==";
const minFinalOutputBytes = 32 * 1024;

const resolveFfmpegPath = () => serverEnv.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";

const splitStoragePath = (storagePath: string) => {
  const parts = storagePath.replace(/\\/g, "/").split("/").filter(Boolean);
  const filename = parts.pop() ?? "asset";

  return {
    folder: parts.join("/"),
    filename,
  };
};

const uploadComposedFile = async (
  storagePath: string,
  data: Buffer,
  contentType: string
) => {
  const { folder, filename } = splitStoragePath(storagePath);
  const result = contentType.startsWith("image/")
    ? await cloudinaryUploadImage(data, folder, filename)
    : await cloudinaryUploadVideo(data, folder, filename);

  return {
    url: result.url,
    storagePath: result.storagePath,
  };
};

const readStudioPoster = async () => {
  const studioPath = join(process.cwd(), "public", "backgrounds", "studio.jpg");
  const studioStat = await stat(studioPath).catch(() => null);

  if (studioStat && studioStat.size > 0) {
    return {
      data: await readFile(studioPath),
      contentType: "image/jpeg",
    };
  }

  return null;
};

const loadPoster = async (backgroundUrl?: string) => {
  const studioPoster = await readStudioPoster();

  if (studioPoster) {
    return studioPoster;
  }

  if (backgroundUrl) {
    try {
      const response = await fetch(backgroundUrl, { cache: "no-store" });

      if (response.ok) {
        return {
          data: Buffer.from(await response.arrayBuffer()),
          contentType: response.headers.get("content-type") ?? "image/jpeg",
        };
      }
    } catch {
      return {
        data: Buffer.from(fallbackPosterPng, "base64"),
        contentType: "image/png",
      };
    }
  }

  return {
    data: Buffer.from(fallbackPosterPng, "base64"),
    contentType: "image/png",
  };
};

export const runComposeWorker = async (input: ComposeWorkerInput): Promise<ComposeWorkerResult> => {
  const outputStoragePath = `generated/${input.podcastId}/${input.jobId}/exports/final.mp4`;
  const posterStoragePath = `generated/${input.podcastId}/${input.jobId}/exports/poster.jpg`;
  const commandPlan: string[] = [];
  let tempDir: string | null = null;

  try {
    tempDir = await mkdtemp(join(tmpdir(), "realistic-podcast-ai-reel-"));
    const outputPath = join(tempDir, "final.mp4");
    const composed = await composePodcastSingleSpeaker({
      script: input.script,
      speakers: input.speakers,
      audioAssets: input.audioAssets,
      videoSettings: input.videoSettings,
      tempDir,
      outputPath,
      commandPlan,
      onTurnComplete: input.onTurnComplete,
      onConcatenating: input.onConcatenating,
      onFinalizing: input.onFinalizing,
    });
    const outputStat = await stat(composed.outputPath).catch(() => null);

    if (!outputStat || outputStat.size < minFinalOutputBytes) {
      throw new Error(
        `Final composed video output is too small (${outputStat?.size ?? 0} bytes). Expected at least ${minFinalOutputBytes} bytes.`
      );
    }

    const outputUpload = await uploadComposedFile(
      outputStoragePath,
      await readFile(composed.outputPath),
      "video/mp4"
    );
    const poster = await loadPoster(input.videoSettings.backgroundUrl);
    const posterUpload = await uploadComposedFile(
      posterStoragePath,
      poster.data,
      poster.contentType
    );

    return {
      outputUrl: outputUpload.url,
      outputStoragePath: outputUpload.storagePath,
      posterUrl: posterUpload.url,
      durationSeconds: composed.durationSeconds,
      ffmpegPath: resolveFfmpegPath(),
      commandPlan: composed.commandPlan,
    };
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
};

