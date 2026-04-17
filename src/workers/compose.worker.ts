import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ffmpegStatic from "ffmpeg-static";

import { serverEnv } from "@/config/env";
import { adminStorage } from "@/lib/server/firebase-admin";
import type { PodcastScript, ScriptTurn } from "@/types/script";
import type { StudioBackground, VideoSettings } from "@/types/video";
import type { LipsyncClip } from "@/workers/lipsync.worker";

export interface ComposeWorkerInput {
  jobId: string;
  podcastId: string;
  clips: LipsyncClip[];
  script: PodcastScript;
  videoSettings: VideoSettings;
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

const backgroundLut: Record<StudioBackground, string> = {
  midnight: "eq=contrast=1.08:saturation=0.9:brightness=-0.02",
  newsroom: "eq=contrast=1.05:saturation=0.95:brightness=0.01",
  warm_studio: "eq=contrast=1.04:saturation=1.08:gamma=1.02",
  city: "eq=contrast=1.1:saturation=0.98:brightness=0.01",
};

const resolveFfmpegPath = () => serverEnv.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";

const escapeFilterPath = (path: string) =>
  path.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

const formatTimestamp = (seconds: number) => {
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  const milliseconds = Math.floor((safeSeconds - Math.floor(safeSeconds)) * 1000);

  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${wholeSeconds.toString().padStart(2, "0")}.${milliseconds
    .toString()
    .padStart(3, "0")}`;
};

const turnDuration = (turn: ScriptTurn) => turn.estimatedDurationSeconds ?? 4;

const buildSubtitleFile = (script: PodcastScript) => {
  let cursor = 0;
  const cues = script.segments.flatMap((segment) => segment.turns).map((turn, index) => {
    const duration = Math.max(2, turnDuration(turn));
    const start = cursor;
    const end = cursor + duration;
    cursor = end + Math.max(0, (turn.pauseAfterMs ?? 250) / 1000);

    return `${index + 1}\n${formatTimestamp(start)} --> ${formatTimestamp(end)}\n${turn.text}\n`;
  });

  return `WEBVTT\n\n${cues.join("\n")}`;
};

const buildVisualFilter = (settings: VideoSettings, subtitlePath?: string) => {
  const filters = ["fps=30", backgroundLut[settings.background]];

  if (settings.cameraStyle === "push_in") {
    filters.push("scale=iw*1.03:ih*1.03,crop=iw/1.03:ih/1.03");
  }

  if (settings.cameraStyle === "two_shot") {
    filters.push("tblend=all_mode=average:all_opacity=0.02");
  }

  if (settings.subtitlesEnabled && subtitlePath) {
    filters.push(`subtitles='${escapeFilterPath(subtitlePath)}'`);
  }

  return filters.join(",");
};

const buildClipComposeCommand = (
  input: ComposeWorkerInput,
  outputPath: string,
  subtitlePath?: string
) => {
  const clipInputs = input.clips.flatMap((clip) => ["-i", clip.clipUrl]);
  const concatInputs = input.clips
    .map((_, index) => `[${index}:v:0][${index}:a:0]`)
    .join("");
  const concatFilter = `${concatInputs}concat=n=${input.clips.length}:v=1:a=1[basev][a]`;
  const visualFilter = buildVisualFilter(input.videoSettings, subtitlePath);
  const filterComplex = `${concatFilter};[basev]${visualFilter}[v]`;

  return [
    resolveFfmpegPath(),
    "-y",
    ...clipInputs,
    "-filter_complex",
    filterComplex,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-aspect",
    input.videoSettings.aspectRatio,
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-shortest",
    "-movflags",
    "+faststart",
    outputPath,
  ];
};

const buildFallbackVideoCommand = (
  input: ComposeWorkerInput,
  outputPath: string,
  subtitlePath: string,
  durationSeconds: number
) => {
  const visualFilter = buildVisualFilter(input.videoSettings, subtitlePath);

  return [
    resolveFfmpegPath(),
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x111827:s=1280x720:d=${Math.max(5, Math.round(durationSeconds))}`,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=mono:sample_rate=44100",
    "-filter_complex",
    `[0:v]${visualFilter}[v]`,
    "-map",
    "[v]",
    "-map",
    "1:a",
    "-t",
    `${Math.max(5, Math.round(durationSeconds))}`,
    "-aspect",
    input.videoSettings.aspectRatio,
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-shortest",
    "-movflags",
    "+faststart",
    outputPath,
  ];
};

const runFfmpeg = async (command: string[]) => {
  const [binary, ...args] = command;

  if (!binary) {
    throw new Error("FFmpeg binary could not be resolved.");
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    const stderr: Buffer[] = [];

    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(Buffer.concat(stderr).toString("utf8") || "FFmpeg failed."));
    });
  });
};

const uploadSignedFile = async (
  storagePath: string,
  data: Buffer,
  contentType: string
) => {
  const file = adminStorage.bucket().file(storagePath);
  await file.save(data, {
    contentType,
    metadata: {
      cacheControl: "private, max-age=31536000",
    },
  });
  const [signedUrl] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 1000 * 60 * 60 * 24 * 7,
  });

  return signedUrl;
};

const writeFallbackManifest = async (
  input: ComposeWorkerInput,
  commandPlan: string[]
) => {
  const manifest = {
    jobId: input.jobId,
    podcastId: input.podcastId,
    generatedAt: new Date().toISOString(),
    ffmpegPath: resolveFfmpegPath(),
    commandPlan,
    clips: input.clips,
    videoSettings: input.videoSettings,
    scriptTitle: input.script.title,
    note: "FFmpeg composition failed, so the worker saved a compose manifest instead of an MP4.",
  };

  return Buffer.from(JSON.stringify(manifest, null, 2));
};

const loadPoster = async (backgroundUrl?: string) => {
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
  const posterStoragePath = `generated/${input.podcastId}/${input.jobId}/exports/poster.png`;
  const durationSeconds = Math.max(
    5,
    input.clips.reduce((total, clip) => total + clip.durationSeconds, 0)
  );
  const renderable = input.clips.length > 0 && input.clips.every((clip) => !clip.clipUrl.startsWith("phase2://"));
  let commandPlan: string[] = [];
  let outputData: Buffer;
  let outputContentType = "video/mp4";
  let tempDir: string | null = null;

  try {
    tempDir = await mkdtemp(join(tmpdir(), "realistic-podcast-ai-"));
    const subtitlePath = join(tempDir, "subtitles.vtt");
    const outputPath = join(tempDir, "final.mp4");

    await writeFile(subtitlePath, buildSubtitleFile(input.script), "utf8");
    commandPlan = renderable
      ? buildClipComposeCommand(input, outputPath, subtitlePath)
      : buildFallbackVideoCommand(input, outputPath, subtitlePath, durationSeconds);

    await runFfmpeg(commandPlan);
    outputData = await readFile(outputPath);
  } catch {
    outputContentType = "application/json";
    outputData = await writeFallbackManifest(input, commandPlan);
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  const outputUrl = await uploadSignedFile(outputStoragePath, outputData, outputContentType);
  const poster = await loadPoster(input.videoSettings.backgroundUrl);
  const posterUrl = await uploadSignedFile(
    posterStoragePath,
    poster.data,
    poster.contentType
  );

  return {
    outputUrl,
    outputStoragePath,
    posterUrl,
    durationSeconds,
    ffmpegPath: resolveFfmpegPath(),
    commandPlan,
  };
};
