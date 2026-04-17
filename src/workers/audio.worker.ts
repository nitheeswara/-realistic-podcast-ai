import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ffmpegStatic from "ffmpeg-static";

import { serverEnv } from "@/config/env";
import { voiceOptions } from "@/lib/podcast/constants";
import { toSarvamTargetLanguageCode } from "@/lib/podcast/provider-catalog";
import { adminStorage } from "@/lib/server/firebase-admin";
import type { PodcastScript, ScriptSpeakerId, ScriptTurn } from "@/types/script";
import type { SpeakerConfig, Voice } from "@/types/voice";

export interface AudioWorkerInput {
  jobId: string;
  podcastId: string;
  script: PodcastScript;
  speakers: SpeakerConfig[];
}

export interface TurnAudioAsset {
  turnId: string;
  speakerId: ScriptSpeakerId;
  text: string;
  audioUrl: string;
  storagePath?: string;
  durationSeconds: number;
  provider: Voice["provider"] | "placeholder";
  normalized: boolean;
}

export interface AudioWorkerResult {
  assets: TurnAudioAsset[];
  durationSeconds: number;
}

interface SynthesizedAudio {
  data: ArrayBuffer;
  contentType: string;
}

const getSpeakerVoice = (speakers: SpeakerConfig[], speakerId: ScriptSpeakerId) => {
  const speaker = speakers.find((item) => item.id === speakerId || item.role === speakerId);

  if (speaker?.voiceMode === "cloned" && speaker.clonedVoiceId) {
    return {
      id: speaker.clonedVoiceId,
      name: speaker.clonedVoiceName ?? `${speaker.name} clone`,
      provider: "elevenlabs",
      mode: "cloned",
      gender: speaker.role === "host" ? "male" : "female",
      languageCode: speaker.voice?.languageCode ?? "en-US",
      externalVoiceId: speaker.clonedVoiceId,
    } satisfies Voice;
  }

  if (speaker?.voice) {
    return speaker.voice;
  }

  return voiceOptions.find((voice) => voice.id === speaker?.voiceId);
};

const estimatedDuration = (turn: ScriptTurn) =>
  turn.estimatedDurationSeconds ?? Math.max(3, Math.ceil(turn.text.split(/\s+/).length / 2.4));

const resolveFfmpegPath = () => serverEnv.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";

const contentTypeToExtension = (contentType: string) =>
  contentType.includes("wav") ? "wav" : "mp3";

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

      reject(new Error(Buffer.concat(stderr).toString("utf8") || "FFmpeg audio processing failed."));
    });
  });
};

const normalizeAndTrimAudio = async (
  audio: SynthesizedAudio,
  turnId: string
): Promise<SynthesizedAudio> => {
  let tempDir: string | null = null;

  try {
    tempDir = await mkdtemp(join(tmpdir(), "realistic-podcast-ai-audio-"));
    const inputPath = join(tempDir, `${turnId}.${contentTypeToExtension(audio.contentType)}`);
    const outputPath = join(tempDir, `${turnId}.normalized.mp3`);

    await writeFile(inputPath, Buffer.from(audio.data));
    await runFfmpeg([
      resolveFfmpegPath(),
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-af",
      "silenceremove=start_periods=1:start_duration=0.05:start_threshold=-45dB:stop_periods=1:stop_duration=0.15:stop_threshold=-45dB,loudnorm=I=-16:TP=-1.5:LRA=11",
      "-ar",
      "44100",
      "-ac",
      "1",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "128k",
      outputPath,
    ]);

    const output = await readFile(outputPath);

    return {
      data: output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength),
      contentType: "audio/mpeg",
    };
  } catch {
    return audio;
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
};

const uploadAudio = async (
  podcastId: string,
  jobId: string,
  turnId: string,
  contentType: string,
  data: ArrayBuffer
) => {
  const storagePath = `generated/${podcastId}/${jobId}/audio/${turnId}.mp3`;
  const file = adminStorage.bucket().file(storagePath);
  await file.save(Buffer.from(data), {
    contentType,
    metadata: {
      cacheControl: "private, max-age=31536000",
    },
  });
  const [signedUrl] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 1000 * 60 * 60 * 24 * 7,
  });

  return { storagePath, signedUrl };
};

const synthesizeWithElevenLabs = async (
  voice: Voice,
  text: string
): Promise<SynthesizedAudio | null> => {
  if (!serverEnv.ELEVENLABS_API_KEY || !voice.externalVoiceId) {
    return null;
  }

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice.externalVoiceId}`,
    {
      method: "POST",
      headers: {
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": serverEnv.ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.78,
          style: 0.3,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!response.ok) {
    return null;
  }

  return {
    data: await response.arrayBuffer(),
    contentType: "audio/mpeg",
  };
};

const synthesizeWithSarvam = async (
  voice: Voice,
  text: string
): Promise<SynthesizedAudio | null> => {
  if (!serverEnv.SARVAM_API_KEY) {
    return null;
  }

  const response = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: {
      "api-subscription-key": serverEnv.SARVAM_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: [text],
      target_language_code: toSarvamTargetLanguageCode(voice.languageCode),
      speaker: voice.externalVoiceId ?? "anushka",
      pitch: 0,
      pace: 1,
      loudness: 1,
      speech_sample_rate: 22050,
      enable_preprocessing: true,
      model: "bulbul:v1",
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload: unknown = await response.json();
  const audios =
    typeof payload === "object" &&
    payload !== null &&
    "audios" in payload &&
    Array.isArray((payload as { audios: unknown }).audios)
      ? (payload as { audios: string[] }).audios
      : [];
  const firstAudio = audios[0];

  if (!firstAudio) {
    return null;
  }

  const buffer = Buffer.from(firstAudio, "base64");

  return {
    data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    contentType: "audio/wav",
  };
};

const synthesizeTurn = async (
  input: AudioWorkerInput,
  turn: ScriptTurn
): Promise<TurnAudioAsset> => {
  const voice = getSpeakerVoice(input.speakers, turn.speakerId);
  const provider = voice?.provider ?? "placeholder";
  const rawAudio =
    voice?.provider === "elevenlabs"
      ? await synthesizeWithElevenLabs(voice, turn.text)
      : voice?.provider === "sarvam"
        ? await synthesizeWithSarvam(voice, turn.text)
        : null;

  if (rawAudio) {
    const audioData = await normalizeAndTrimAudio(rawAudio, turn.id);
    const uploaded = await uploadAudio(
      input.podcastId,
      input.jobId,
      turn.id,
      audioData.contentType,
      audioData.data
    );

    return {
      turnId: turn.id,
      speakerId: turn.speakerId,
      text: turn.text,
      audioUrl: uploaded.signedUrl,
      storagePath: uploaded.storagePath,
      durationSeconds: estimatedDuration(turn),
      provider,
      normalized: audioData.contentType === "audio/mpeg",
    };
  }

  return {
    turnId: turn.id,
    speakerId: turn.speakerId,
    text: turn.text,
    audioUrl: `phase2://audio/${input.jobId}/${turn.id}.mp3`,
    durationSeconds: estimatedDuration(turn),
    provider: "placeholder",
    normalized: true,
  };
};

export const runAudioWorker = async (
  input: AudioWorkerInput,
  onTurnComplete?: (completed: number, total: number) => Promise<void>
): Promise<AudioWorkerResult> => {
  const turns = input.script.segments.flatMap((segment) => segment.turns);
  const assets: TurnAudioAsset[] = [];

  for (const turn of turns) {
    const asset = await synthesizeTurn(input, turn);
    assets.push(asset);

    if (onTurnComplete) {
      await onTurnComplete(assets.length, turns.length);
    }
  }

  return {
    assets,
    durationSeconds: assets.reduce((total, asset) => total + asset.durationSeconds, 0),
  };
};

