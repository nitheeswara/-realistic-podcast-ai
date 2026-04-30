import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ffmpegStatic from "ffmpeg-static";

import { serverEnv } from "@/config/env";
import { getStockVideoPath } from "@/lib/avatars/stock-videos";
import { uploadVideo } from "@/lib/server/storage";
import type { ScriptTurn } from "@/types/script";
import type { SpeakerConfig, SpeakerGender, SpeakerRole } from "@/types/voice";
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
  speakingClipUrl: string;
  listeningClipUrl: string;
  storagePath?: string;
  speakingStoragePath?: string;
  listeningStoragePath?: string;
  audioUrl?: string;
  audioStoragePath?: string;
  durationSeconds: number;
  providerJobId?: string;
  provider?: "sync" | "stock" | "placeholder";
  fallbackReason?: string;
}

export interface LipsyncWorkerResult {
  clips: LipsyncClip[];
}

interface ProcessedTurnClips {
  speakingClip: string;
  listeningClip: string;
  provider: "sync" | "stock";
  fallbackReason?: string;
}

const SPEAKING_FILTER =
  "scale=640:720:force_original_aspect_ratio=increase,crop=640:720,eq=brightness=0.05:saturation=1.15:contrast=1.05";
const LISTENING_FILTER =
  "scale=640:720:force_original_aspect_ratio=increase,crop=640:720,eq=brightness=-0.12:saturation=0.75:contrast=0.95";

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

      reject(new Error(Buffer.concat(stderr).toString("utf8") || "FFmpeg stock lipsync processing failed."));
    });
  });
};

const getSpeaker = (speakers: SpeakerConfig[], role: SpeakerRole) =>
  speakers.find((speaker) => speaker.id === role || speaker.role === role);

const getSpeakerGender = (speaker: SpeakerConfig | undefined, fallback: SpeakerGender): SpeakerGender =>
  speaker?.gender ?? speaker?.avatar?.gender ?? speaker?.voice?.gender ?? fallback;

function isRealAudioUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

const downloadPublicFile = async (url: string, outputPath: string) => {
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }

  await writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
  return outputPath;
};

const trimSpeakingStockVideo = async (
  inputPath: string,
  audioPath: string,
  outputPath: string,
  durationSeconds: number
) => {
  await runFfmpeg([
    resolveFfmpegPath(),
    "-y",
    "-stream_loop",
    "-1",
    "-i",
    inputPath,
    "-i",
    audioPath,
    "-t",
    String(durationSeconds),
    "-vf",
    SPEAKING_FILTER,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "libx264",
    "-b:v",
    "1800k",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "25",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-shortest",
    outputPath,
  ]);

  return outputPath;
};

const trimListeningStockVideo = async (
  inputPath: string,
  outputPath: string,
  durationSeconds: number
) => {
  await runFfmpeg([
    resolveFfmpegPath(),
    "-y",
    "-stream_loop",
    "-1",
    "-i",
    inputPath,
    "-t",
    String(durationSeconds),
    "-vf",
    LISTENING_FILTER,
    "-c:v",
    "libx264",
    "-b:v",
    "1800k",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "25",
    "-an",
    outputPath,
  ]);

  return outputPath;
};

const createSolidStockClip = async (
  outputPath: string,
  durationSeconds: number,
  speaking: boolean,
  audioPath?: string
) => {
  const command = [
    resolveFfmpegPath(),
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${speaking ? "0x1a2e4a" : "0x0d0d1a"}:size=640x720:rate=25`,
  ];

  if (speaking && audioPath) {
    command.push(
      "-i",
      audioPath,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0"
    );
  }

  command.push(
    "-t",
    String(durationSeconds),
    "-c:v",
    "libx264",
    "-b:v",
    speaking ? "900k" : "600k",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "25"
  );

  if (speaking && audioPath) {
    command.push("-c:a", "aac", "-b:a", "128k", "-shortest");
  } else {
    command.push("-an");
  }

  command.push(outputPath);
  await runFfmpeg(command);

  return outputPath;
};

const prepareStockClip = async ({
  audioPath,
  durationSeconds,
  gender,
  outputPath,
  role,
  speaking,
}: {
  audioPath?: string;
  durationSeconds: number;
  gender: SpeakerGender;
  outputPath: string;
  role: SpeakerRole;
  speaking: boolean;
}) => {
  try {
    const stockPath = getStockVideoPath(role, gender);
    return speaking
      ? await trimSpeakingStockVideo(stockPath, audioPath ?? "", outputPath, durationSeconds)
      : await trimListeningStockVideo(stockPath, outputPath, durationSeconds);
  } catch (error) {
    console.error(`Stock video missing or invalid for ${gender}-${role}, using solid color:`, error);
    return await createSolidStockClip(outputPath, durationSeconds, speaking, audioPath);
  }
};

const uploadClip = async ({
  filePath,
  filename,
  folder,
}: {
  filePath: string;
  filename: string;
  folder: string;
}) => await uploadVideo(await readFile(filePath), folder, filename);

type ProcessTurn = Pick<ScriptTurn, "id" | "speakerId">;

async function processOneTurn(
  turn: ProcessTurn,
  speakers: SpeakerConfig[],
  audioAsset: TurnAudioAsset,
  tempDir: string
): Promise<ProcessedTurnClips> {
  const isHost = turn.speakerId === "host";
  const speakerRole: SpeakerRole = isHost ? "host" : "guest";
  const listenerRole: SpeakerRole = isHost ? "guest" : "host";
  const speakerConfig = getSpeaker(speakers, speakerRole);
  const listenerConfig = getSpeaker(speakers, listenerRole);
  const speakerGender = getSpeakerGender(speakerConfig, isHost ? "male" : "female");
  const listenerGender = getSpeakerGender(listenerConfig, isHost ? "female" : "male");
  const duration = Math.max(0.5, audioAsset.durationSeconds);
  const localAudioPath = join(tempDir, `audio_${turn.id}.mp3`);
  const speakerTrimmed = join(tempDir, `speaker_trimmed_${turn.id}.mp4`);
  const listenerTrimmed = join(tempDir, `listener_trimmed_${turn.id}.mp4`);

  if (!isRealAudioUrl(audioAsset.audioUrl)) {
    console.log(`Skipping turn ${turn.id}: no real audio generated`);
    throw new Error(`Audio URL is not renderable for turn ${turn.id}: ${audioAsset.audioUrl}`);
  }

  await downloadPublicFile(audioAsset.audioUrl, localAudioPath);

  await prepareStockClip({
    audioPath: localAudioPath,
    durationSeconds: duration,
    gender: speakerGender,
    outputPath: speakerTrimmed,
    role: speakerRole,
    speaking: true,
  });
  await prepareStockClip({
    durationSeconds: duration,
    gender: listenerGender,
    outputPath: listenerTrimmed,
    role: listenerRole,
    speaking: false,
  });

  const finalSpeakingClip = speakerTrimmed;
  const provider: "sync" | "stock" = "stock";
  const fallbackReason = "Lip sync skipped; using stock video with real audio.";
  console.log(`Turn ${turn.id}: using stock video (${speakerRole}/${speakerGender})`);

  return {
    speakingClip: finalSpeakingClip,
    listeningClip: listenerTrimmed,
    provider,
    fallbackReason,
  };
}

export const runLipsyncWorker = async (
  input: LipsyncWorkerInput,
  onClipComplete?: (completed: number, total: number) => Promise<void>
): Promise<LipsyncWorkerResult> => {
  const clips: LipsyncClip[] = [];
  let completedTurns = 0;
  let tempDir: string | null = null;

  try {
    tempDir = await mkdtemp(join(tmpdir(), "realistic-podcast-ai-stock-lipsync-"));

    for (const asset of input.audioAssets) {
      if (!isRealAudioUrl(asset.audioUrl)) {
        console.log(`Skipping turn ${asset.turnId}: no real audio generated`);
        completedTurns += 1;

        if (onClipComplete) {
          await onClipComplete(completedTurns, input.audioAssets.length);
        }

        continue;
      }

      const turn: ProcessTurn = {
        id: asset.turnId,
        speakerId: asset.speakerId,
      };
      const processed = await processOneTurn(
        turn,
        input.speakers,
        asset,
        tempDir
      );
      const folder = `generated/${input.podcastId}/${input.jobId}/clips/${asset.turnId}`;
      const speakingUpload = await uploadClip({
        filePath: processed.speakingClip,
        filename: "speaking.mp4",
        folder,
      });
      const listeningUpload = await uploadClip({
        filePath: processed.listeningClip,
        filename: "listening.mp4",
        folder,
      });

      clips.push({
        turnId: asset.turnId,
        speakerId: asset.speakerId,
        clipUrl: speakingUpload.url,
        speakingClipUrl: speakingUpload.url,
        listeningClipUrl: listeningUpload.url,
        storagePath: speakingUpload.storagePath,
        speakingStoragePath: speakingUpload.storagePath,
        listeningStoragePath: listeningUpload.storagePath,
        audioUrl: asset.audioUrl,
        audioStoragePath: asset.storagePath,
        durationSeconds: asset.durationSeconds,
        provider: processed.provider,
        fallbackReason: processed.fallbackReason,
      });

      completedTurns += 1;

      if (onClipComplete) {
        await onClipComplete(completedTurns, input.audioAssets.length);
      }
    }
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  return { clips };
};

