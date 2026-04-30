import { spawn } from "node:child_process";
import { stat, writeFile } from "node:fs/promises";

import ffmpegStatic from "ffmpeg-static";

import { serverEnv } from "@/config/env";

const resolveFfmpegPath = () => serverEnv.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";

const runFfmpeg = async (command: string[]) => {
  const [binary, ...args] = command;

  if (!binary) {
    throw new Error("FFmpeg binary could not be resolved.");
  }

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    const stderr: Buffer[] = [];

    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const stderrText = Buffer.concat(stderr).toString("utf8");

      if (code === 0) {
        resolve(stderrText);
        return;
      }

      reject(new Error(stderrText || "FFmpeg avatar fallback failed."));
    });
  });
};

const createDefaultStudioImage = () => {
  const width = 1280;
  const height = 720;
  const header = Buffer.from(`P6\n${width} ${height}\n255\n`, "ascii");
  const pixels = Buffer.alloc(width * height * 3);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      const spotlight = Math.max(0, 1 - Math.hypot((x - 640) / 640, (y - 300) / 520));
      pixels[offset] = Math.round(18 + spotlight * 62);
      pixels[offset + 1] = Math.round(24 + spotlight * 46);
      pixels[offset + 2] = Math.round(35 + spotlight * 28);
    }
  }

  return Buffer.concat([header, pixels]);
};

export const writeDefaultStudioImage = async (imagePath: string) => {
  await writeFile(imagePath, createDefaultStudioImage());
};

const parseDurationSeconds = (stderr: string) => {
  const match = /Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const durationSeconds = hours * 3600 + minutes * 60 + seconds;

  return Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : null;
};

const readAudioDurationSeconds = async (audioPath: string) => {
  const stderr = await runFfmpeg([
    resolveFfmpegPath(),
    "-hide_banner",
    "-i",
    audioPath,
    "-f",
    "null",
    "-",
  ]);
  const durationSeconds = parseDurationSeconds(stderr);

  if (!durationSeconds) {
    throw new Error(`Could not determine audio duration for avatar fallback: ${audioPath}`);
  }

  return durationSeconds;
};

export const createAvatarPlaceholderVideo = async (
  imagePath: string,
  audioPath: string,
  outputPath: string
): Promise<string[]> => {
  const [imageStat, audioStat] = await Promise.all([
    stat(imagePath).catch(() => null),
    stat(audioPath).catch(() => null),
  ]);

  if (!imageStat || imageStat.size === 0) {
    throw new Error(`Avatar fallback image missing or empty: ${imagePath}`);
  }

  if (!audioStat || audioStat.size === 0) {
    throw new Error(`Avatar fallback audio missing or empty: ${audioPath}`);
  }

  const durationSeconds = await readAudioDurationSeconds(audioPath);

  const command = [
    resolveFfmpegPath(),
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-loop",
    "1",
    "-framerate",
    "25",
    "-i",
    imagePath,
    "-i",
    audioPath,
    "-filter_complex",
    "[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,eq=brightness=0.03:saturation=1.05:contrast=1.02,format=yuv420p[v]",
    "-map",
    "[v]",
    "-map",
    "1:a:0",
    "-c:v",
    "libx264",
    "-b:v",
    "2000k",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-pix_fmt",
    "yuv420p",
    "-t",
    durationSeconds.toFixed(3),
    "-movflags",
    "+faststart",
    "-shortest",
    outputPath,
  ];

  await runFfmpeg(command);
  return command;
};



