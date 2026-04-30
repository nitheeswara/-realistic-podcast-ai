import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import ffmpegStatic from "ffmpeg-static";

import { getAvatarImagePath } from "@/lib/avatars/stock-videos";
import { writeDefaultStudioImage } from "@/lib/ffmpeg/studio-background";
import { serverEnv } from "@/config/env";
import { generateHeyGenVideo } from "@/providers/heygen.adapter";
import type { PodcastScript } from "@/types/script";
import type { VideoSettings } from "@/types/video";
import type { SpeakerConfig, SpeakerGender, SpeakerRole } from "@/types/voice";
import type { TurnAudioAsset } from "@/workers/audio.worker";

export interface ComposeSingleSpeakerInput {
  speakerImagePath: string;
  backgroundPath: string;
  audioPath: string;
  speakerName: string;
  durationSec: number;
  outputPath: string;
  ffmpegPath: string;
}

export interface ComposePodcastSingleSpeakerInput {
  script: PodcastScript;
  speakers: SpeakerConfig[];
  audioAssets: TurnAudioAsset[];
  videoSettings: VideoSettings;
  tempDir: string;
  outputPath: string;
  commandPlan?: string[];
  onTurnComplete?: (completed: number, total: number) => Promise<void>;
  onConcatenating?: () => Promise<void>;
  onFinalizing?: () => Promise<void>;
}

export interface ComposePodcastSingleSpeakerResult {
  outputPath: string;
  durationSeconds: number;
  turnVideos: string[];
  commandPlan: string[];
}

const resolveFfmpegPath = () => serverEnv.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";
const commandLabel = (command: string[]) => command.join(" ");

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

      reject(new Error(Buffer.concat(stderr).toString("utf8") || "FFmpeg single-speaker compose failed."));
    });
  });
};

const assertReadableFile = async (path: string, label: string) => {
  const fileStat = await stat(path).catch(() => null);

  if (!fileStat || fileStat.size === 0) {
    throw new Error(`${label} missing or empty: ${path}`);
  }
};

const quoteConcatPath = (path: string) => path.replace(/\\/g, "/").replace(/'/g, "\\'");

const sanitizeSpeakerName = (speakerName: string) =>
  speakerName
    .replace(/\\/g, "")
    .replace(/'/g, "")
    .replace(/:/g, "")
    .replace(/"/g, "")
    .replace(/\r?\n/g, " ")
    .slice(0, 30) || "Speaker";

export const isRealAudioUrl = (url: string): boolean =>
  url.startsWith("http://") || url.startsWith("https://");

export const downloadToTemp = async (
  url: string,
  tempDir: string,
  filename: string
) => {
  if (!isRealAudioUrl(url)) {
    throw new Error(`File is not renderable: ${url}`);
  }

  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }

  const outputPath = join(tempDir, filename);
  await writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
  await assertReadableFile(outputPath, `Downloaded file from ${url}`);
  return outputPath;
};

const getSpeaker = (speakers: SpeakerConfig[], role: SpeakerRole) =>
  speakers.find((speaker) => speaker.role === role || speaker.id === role);

const buildCompositeFilter = (speakerName: string, studioBgExists: boolean) => {
  const safeName = sanitizeSpeakerName(speakerName);

  return studioBgExists
    ? [
        "[1:v]scale=1280:720,setsar=1[bg]",
        "[0:v]scale=560:630:force_original_aspect_ratio=increase,crop=560:630,setsar=1[person]",
        "[bg][person]overlay=x=(W-w)/2:y=40[with_person]",
        `[with_person]drawtext=text='${safeName}':fontcolor=white:fontsize=28:box=1:boxcolor=0x0a0a1e@0.85:boxborderw=8:x=(W-text_w)/2:y=H-65[final]`,
      ].join(";")
    : [
        "[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1[scaled]",
        `[scaled]drawtext=text='${safeName}':fontcolor=white:fontsize=28:box=1:boxcolor=0x0a0a1e@0.85:boxborderw=8:x=(W-text_w)/2:y=H-65[final]`,
      ].join(";");
};

const buildComposeSingleSpeakerCommand = ({
  audioPath,
  backgroundPath,
  durationSec,
  ffmpegPath,
  outputPath,
  speakerImagePath,
  speakerName,
}: ComposeSingleSpeakerInput) => {
  const studioBgExists = existsSync(backgroundPath);
  const inputs = studioBgExists
    ? [
        "-loop",
        "1",
        "-i",
        speakerImagePath,
        "-loop",
        "1",
        "-i",
        backgroundPath,
        "-i",
        audioPath,
      ]
    : [
        "-loop",
        "1",
        "-i",
        speakerImagePath,
        "-i",
        audioPath,
      ];
  const audioMapIndex = studioBgExists ? "2" : "1";

  return [
    ffmpegPath,
    "-y",
    ...inputs,
    "-filter_complex",
    buildCompositeFilter(speakerName, studioBgExists),
    "-map",
    "[final]",
    "-map",
    `${audioMapIndex}:a`,
    "-c:v",
    "libx264",
    "-b:v",
    "2500k",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-t",
    String(durationSec),
    "-shortest",
    outputPath,
  ];
};

export async function composeSingleSpeaker(params: ComposeSingleSpeakerInput): Promise<void> {
  const studioBgExists = existsSync(params.backgroundPath);
  const checks = [
    assertReadableFile(params.speakerImagePath, "Speaker image"),
    assertReadableFile(params.audioPath, "Turn audio"),
  ];

  if (studioBgExists) {
    checks.push(assertReadableFile(params.backgroundPath, "Studio background"));
  }

  await Promise.all(checks);

  await runFfmpeg(buildComposeSingleSpeakerCommand(params));
  await assertReadableFile(params.outputPath, "Single-speaker turn video");
}

const resolveStudioBackgroundPath = async (tempDir: string) => {
  const studioPath = join(process.cwd(), "public", "backgrounds", "studio.jpg");
  const studioStat = await stat(studioPath).catch(() => null);

  if (studioStat && studioStat.size > 0) {
    return studioPath;
  }

  const fallbackPath = join(tempDir, "studio-fallback.ppm");
  await writeDefaultStudioImage(fallbackPath);
  await assertReadableFile(fallbackPath, "Generated studio background");
  return fallbackPath;
};

export const composePodcastSingleSpeaker = async ({
  audioAssets,
  commandPlan = [],
  onConcatenating,
  onFinalizing,
  onTurnComplete,
  outputPath,
  script,
  speakers,
  tempDir,
  videoSettings,
}: ComposePodcastSingleSpeakerInput): Promise<ComposePodcastSingleSpeakerResult> => {
  void videoSettings;

  const turns = script.segments.flatMap((segment) => segment.turns);
  const ffmpegPath = resolveFfmpegPath();
  const studioBgPath = await resolveStudioBackgroundPath(tempDir);
  const turnVideos: string[] = [];
  let renderedDurationSeconds = 0;

  for (const audioAsset of audioAssets) {
    const turn = turns.find((candidate) => candidate.id === audioAsset.turnId);

    if (!turn) {
      console.warn(`Skipping audio asset ${audioAsset.turnId}: no matching script turn`);
      continue;
    }

    const isHost = turn.speakerId === "host";
    const speakerRole: SpeakerRole = isHost ? "host" : "guest";
    const speaker = getSpeaker(speakers, speakerRole);
    const speakerGender: SpeakerGender = speaker?.gender ?? "male";
    const speakerName = speaker?.name?.trim() || speakerRole;
    const speakerImagePath = getAvatarImagePath(speakerRole, speakerGender);
    const duration = Math.max(0.5, audioAsset.durationSeconds);
    const turnOutputPath = join(tempDir, `turn_${audioAsset.turnId}.mp4`);

    if (!isRealAudioUrl(audioAsset.audioUrl)) {
      console.warn(`Skipping turn ${turn.id}: no valid audio`);

      if (onTurnComplete) {
        await onTurnComplete(turnVideos.length, audioAssets.length);
      }

      continue;
    }

    const avatarId =
      speaker?.avatarId ??
      speaker?.clonedAvatarId ??
      (isHost ? "Abigail_expressive_20240628" : "Bryan_FrontView_public");

    const heygenUrl = await generateHeyGenVideo({
      avatarId,
      audioUrl: audioAsset.audioUrl,
      turnId: audioAsset.turnId,
    });

    if (heygenUrl) {
      try {
        const videoRes = await fetch(heygenUrl, { cache: "no-store" });

        if (videoRes.ok) {
          const videoBuf = Buffer.from(await videoRes.arrayBuffer());
          await writeFile(turnOutputPath, videoBuf);
          await assertReadableFile(turnOutputPath, "HeyGen turn video");
          console.log(`HeyGen video saved for ${audioAsset.turnId}: ${videoBuf.length} bytes`);
          turnVideos.push(turnOutputPath);
          renderedDurationSeconds += duration;
          await onTurnComplete?.(turnVideos.length, audioAssets.length);
          continue;
        }

        console.warn(`HeyGen video download failed for ${audioAsset.turnId}: ${videoRes.status}`);
      } catch (error) {
        console.warn(`HeyGen video download failed for ${audioAsset.turnId}:`, error);
      }
    }

    console.warn(`HeyGen failed for ${audioAsset.turnId}, using FFmpeg fallback`);
    const localAudioPath = await downloadToTemp(
      audioAsset.audioUrl,
      tempDir,
      `audio_${audioAsset.turnId}.mp3`
    );
    const command = buildComposeSingleSpeakerCommand({
      speakerImagePath,
      backgroundPath: studioBgPath,
      audioPath: localAudioPath,
      speakerName,
      durationSec: duration,
      outputPath: turnOutputPath,
      ffmpegPath,
    });

    commandPlan.push(commandLabel(command));
    await composeSingleSpeaker({
      speakerImagePath,
      backgroundPath: studioBgPath,
      audioPath: localAudioPath,
      speakerName,
      durationSec: duration,
      outputPath: turnOutputPath,
      ffmpegPath,
    });

    turnVideos.push(turnOutputPath);
    renderedDurationSeconds += duration;
    await onTurnComplete?.(turnVideos.length, audioAssets.length);
  }

  if (turnVideos.length === 0) {
    throw new Error("No turn videos were generated.");
  }

  if (onConcatenating) {
    await onConcatenating();
  }

  const concatenatedPath = await concatTurnVideos(turnVideos, tempDir, ffmpegPath, commandPlan);
  await assertReadableFile(concatenatedPath, "Concatenated video");

  if (onFinalizing) {
    await onFinalizing();
  }

  const finalCommand = [
    ffmpegPath,
    "-y",
    "-i",
    concatenatedPath,
    "-vf",
    "eq=brightness=0.04:saturation=1.12:contrast=1.07",
    "-c:v",
    "libx264",
    "-b:v",
    "2500k",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "copy",
    "-movflags",
    "+faststart",
    outputPath,
  ];

  commandPlan.push(commandLabel(finalCommand));
  await runFfmpeg(finalCommand);
  await assertReadableFile(outputPath, "Final single-speaker video");

  return {
    outputPath,
    durationSeconds: renderedDurationSeconds,
    turnVideos,
    commandPlan,
  };
};

const concatTurnVideos = async (
  turnVideos: string[],
  tempDir: string,
  ffmpegPath: string,
  commandPlan?: string[]
) => {
  if (turnVideos.length === 0) {
    throw new Error("No turn videos to concatenate");
  }

  if (turnVideos.length === 1) {
    const outputPath = join(tempDir, "concatenated.mp4");
    await copyFile(turnVideos[0], outputPath);
    return outputPath;
  }

  const concatListPath = join(tempDir, "concat.txt");
  const concatContent = turnVideos
    .map((path) => `file '${quoteConcatPath(path)}'`)
    .join("\n");
  await writeFile(concatListPath, concatContent);

  const outputPath = join(tempDir, "concatenated.mp4");
  const concatCommand = [
    ffmpegPath,
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatListPath,
    "-c:v",
    "libx264",
    "-b:v",
    "2500k",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outputPath,
  ];

  commandPlan?.push(commandLabel(concatCommand));
  await runFfmpeg(concatCommand);
  return outputPath;
};
