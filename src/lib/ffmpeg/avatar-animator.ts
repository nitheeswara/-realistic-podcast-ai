import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

import ffmpegStatic from "ffmpeg-static";

import { serverEnv } from "@/config/env";

const resolveFfmpegPath = () => serverEnv.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";

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

      reject(new Error(Buffer.concat(stderr).toString("utf8") || "FFmpeg avatar animation failed."));
    });
  });
};

const assertReadableFile = async (path: string, label: string) => {
  const fileStat = await stat(path).catch(() => null);

  if (!fileStat || fileStat.size === 0) {
    throw new Error(`${label} missing or empty: ${path}`);
  }
};

const safeDuration = (durationSec: number) => Math.max(0.5, Number.isFinite(durationSec) ? durationSec : 5);

export const SPEAKING_FILTER =
  "[0:v]scale=640:720:force_original_aspect_ratio=increase,crop=640:720,eq=brightness=0.05:saturation=1.15:contrast=1.05,format=yuv420p[vout]";

export const LISTENING_FILTER =
  "[0:v]scale=640:720:force_original_aspect_ratio=increase,crop=640:720,eq=brightness=-0.12:saturation=0.75:contrast=0.95,format=yuv420p[vout]";

export const createSpeakingVideo = async (
  avatarImagePath: string,
  audioPath: string,
  outputPath: string,
  durationSec: number
) => {
  await Promise.all([
    assertReadableFile(avatarImagePath, "Speaking avatar image"),
    assertReadableFile(audioPath, "Speaking avatar audio"),
  ]);

  const duration = safeDuration(durationSec);
  const command = [
    resolveFfmpegPath(),
    "-y",
    "-loop",
    "1",
    "-i",
    avatarImagePath,
    "-i",
    audioPath,
    "-filter_complex",
    SPEAKING_FILTER,
    "-map",
    "[vout]",
    "-map",
    "1:a",
    "-c:v",
    "libx264",
    "-b:v",
    "1800k",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-t",
    String(duration),
    "-r",
    "25",
    outputPath,
  ];

  await runFfmpeg(command);
  await assertReadableFile(outputPath, "Speaking avatar video");
  return outputPath;
};

export const createListeningVideo = async (
  avatarImagePath: string,
  durationSec: number,
  outputPath: string
) => {
  await assertReadableFile(avatarImagePath, "Listening avatar image");

  const duration = safeDuration(durationSec);
  const command = [
    resolveFfmpegPath(),
    "-y",
    "-loop",
    "1",
    "-i",
    avatarImagePath,
    "-filter_complex",
    LISTENING_FILTER,
    "-map",
    "[vout]",
    "-c:v",
    "libx264",
    "-b:v",
    "800k",
    "-pix_fmt",
    "yuv420p",
    "-t",
    String(duration),
    "-r",
    "25",
    outputPath,
  ];

  await runFfmpeg(command);
  await assertReadableFile(outputPath, "Listening avatar video");
  return outputPath;
};
