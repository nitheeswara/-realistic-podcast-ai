import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FieldValue } from "firebase-admin/firestore";
import ffmpegStatic from "ffmpeg-static";

import { serverEnv } from "@/config/env";
import { voiceOptions } from "@/lib/podcast/constants";
import { isSarvamLanguage, toSarvamTargetLanguageCode } from "@/lib/podcast/provider-catalog";
import { adminDb } from "@/lib/server/firebase-admin";
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
  segmentIndex: number;
  turnIndex: number;
  audioUrl: string;
  storagePath?: string;
  durationSeconds: number;
  provider: AudioAssetProvider;
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

type AudioAssetProvider = Voice["provider"] | "unrealspeech" | "placeholder";

const audioProviders = new Set<AudioAssetProvider>([
  "elevenlabs",
  "sarvam",
  "gemini",
  "unrealspeech",
  "openai",
  "custom",
  "placeholder",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isScriptSpeakerId = (value: unknown): value is ScriptSpeakerId =>
  value === "host" || value === "guest";

const isAudioProvider = (value: unknown): value is AudioAssetProvider =>
  typeof value === "string" && audioProviders.has(value as AudioAssetProvider);

const isRealAudioUrl = (url: string): boolean =>
  url.startsWith("http://") || url.startsWith("https://");

const parseExistingAudioAsset = (value: unknown): TurnAudioAsset | null => {
  if (!isRecord(value)) {
    return null;
  }

  const turnId = value.turnId;
  const speakerId = value.speakerId;
  const text = value.text;
  const segmentIndex = value.segmentIndex;
  const turnIndex = value.turnIndex;
  const audioUrl = value.audioUrl;
  const storagePath = value.storagePath;
  const durationSeconds = value.durationSeconds;
  const provider = value.provider;
  const normalized = value.normalized;

  if (
    typeof turnId !== "string" ||
    !isScriptSpeakerId(speakerId) ||
    typeof audioUrl !== "string" ||
    typeof durationSeconds !== "number" ||
    !Number.isFinite(durationSeconds)
  ) {
    return null;
  }

  return {
    turnId,
    speakerId,
    text: typeof text === "string" ? text : "",
    segmentIndex: typeof segmentIndex === "number" && Number.isFinite(segmentIndex) ? segmentIndex : 0,
    turnIndex: typeof turnIndex === "number" && Number.isFinite(turnIndex) ? turnIndex : 0,
    audioUrl,
    storagePath: typeof storagePath === "string" ? storagePath : undefined,
    durationSeconds,
    provider: isAudioProvider(provider) ? provider : "placeholder",
    normalized: typeof normalized === "boolean" ? normalized : false,
  };
};

const parseExistingAudioAssets = (value: unknown): TurnAudioAsset[] =>
  Array.isArray(value)
    ? value.map(parseExistingAudioAsset).filter((asset): asset is TurnAudioAsset => asset !== null)
    : [];

const getExistingAudioAssets = async (podcastId: string, jobId: string): Promise<TurnAudioAsset[]> => {
  const jobSnapshot = await adminDb.collection("jobs").doc(jobId).get();
  const jobAssets = parseExistingAudioAssets(jobSnapshot.get("audioAssets") as unknown);

  if (jobAssets.length > 0) {
    return jobAssets;
  }

  const podcastSnapshot = await adminDb.collection("podcasts").doc(podcastId).get();
  return parseExistingAudioAssets(podcastSnapshot.get("audioAssets") as unknown);
};

const persistAudioAssets = async (podcastId: string, jobId: string, assets: TurnAudioAsset[]) => {
  await Promise.all([
    adminDb.collection("jobs").doc(jobId).set(
      {
        audioAssets: assets,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    ),
    adminDb.collection("podcasts").doc(podcastId).set(
      {
        audioAssets: assets,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    ),
  ]);
};

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
  } catch (error) {
    console.warn(
      `Audio normalization failed for ${turnId}:`,
      error instanceof Error ? error.message : error
    );
    return audio;
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
};

const ensureMp3Audio = async (
  audio: SynthesizedAudio,
  turnId: string
): Promise<SynthesizedAudio> => {
  if (audio.contentType === "audio/mpeg") {
    return audio;
  }

  let tempDir: string | null = null;

  try {
    tempDir = await mkdtemp(join(tmpdir(), "convert-"));
    const inputPath = join(tempDir, `${turnId}.${contentTypeToExtension(audio.contentType)}`);
    const outputPath = join(tempDir, `${turnId}.mp3`);
    await writeFile(inputPath, Buffer.from(audio.data));
    await runFfmpeg([
      resolveFfmpegPath(),
      "-y",
      "-i",
      inputPath,
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "128k",
      "-ar",
      "44100",
      "-ac",
      "1",
      outputPath,
    ]);
    const mp3Buffer = await readFile(outputPath);
    console.log(`Converted WAV to MP3 for turn ${turnId}`);

    return {
      data: mp3Buffer.buffer.slice(mp3Buffer.byteOffset, mp3Buffer.byteOffset + mp3Buffer.byteLength),
      contentType: "audio/mpeg",
    };
  } catch (error) {
    console.warn(
      `WAV to MP3 conversion failed for ${turnId}:`,
      error instanceof Error ? error.message : error
    );
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
  _contentType: string,
  data: ArrayBuffer
) => {
  const { uploadAudioBuffer } = await import("@/lib/server/storage");
  const storagePath = `generated/${podcastId}/${jobId}/audio/${turnId}.mp3`;
  const signedUrl = await uploadAudioBuffer(Buffer.from(data), storagePath);

  return {
    storagePath,
    signedUrl,
  };
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

const sarvamSpeakerForVoice = (voice: Voice) => {
  const speaker = voice.externalVoiceId?.trim().toLowerCase();

  if (speaker === "arvind" || speaker === "anushka") {
    return speaker;
  }

  return voice.gender === "male" ? "arvind" : "anushka";
};

const synthesizeWithSarvam = async (
  voice: Voice,
  text: string
): Promise<SynthesizedAudio | null> => {
  if (!serverEnv.SARVAM_API_KEY || !isSarvamLanguage(voice.languageCode)) {
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
      speaker: sarvamSpeakerForVoice(voice),
      pace: 1.65,
      loudness: 1.5,
      speech_sample_rate: 8000,
      enable_preprocessing: true,
      model: "bulbul:v2",
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

const synthesizeWithUnrealSpeech = async (
  text: string,
  speakerId: string
): Promise<SynthesizedAudio | null> => {
  const apiKey = process.env.UNREAL_SPEECH_API_KEY;

  if (!apiKey) {
    console.warn("UNREAL_SPEECH_API_KEY not set");
    return null;
  }

  const voiceId = speakerId === "host" ? "Dan" : "Scarlett";

  try {
    const res = await fetch("https://api.v7.unrealspeech.com/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        Text: text,
        VoiceId: voiceId,
        Bitrate: "128k",
        Speed: "0",
        Pitch: "1",
        TimestampType: "word",
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`Unreal Speech HTTP ${res.status}:`, errText.slice(0, 200));
      return null;
    }

    const data = await res.json() as { OutputUri?: string };
    const audioUrl = data.OutputUri;

    if (!audioUrl) {
      console.warn("Unreal Speech returned no OutputUri:", JSON.stringify(data));
      return null;
    }

    const audioResponse = await fetch(audioUrl);

    if (!audioResponse.ok) {
      console.warn("Failed to download Unreal Speech audio:", audioResponse.status);
      return null;
    }

    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    console.log(
      `Unreal Speech success for ${speakerId} (${voiceId}): ${audioBuffer.length} bytes`
    );

    return {
      data: audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength),
      contentType: "audio/mpeg",
    };
  } catch (error) {
    console.warn("Unreal Speech error:", error instanceof Error ? error.message : error);
    return null;
  }
};

const synthesizeTurn = async (
  input: AudioWorkerInput,
  turn: ScriptTurn,
  segmentIndex: number,
  turnIndex: number
): Promise<TurnAudioAsset> => {
  const voice = getSpeakerVoice(input.speakers, turn.speakerId);
  const provider = voice?.provider ?? "placeholder";
  let rawAudio =
    await synthesizeWithUnrealSpeech(turn.text, turn.speakerId) ??
    (voice?.provider === "elevenlabs"
      ? await synthesizeWithElevenLabs(voice, turn.text)
      : null) ??
    (voice?.provider === "sarvam"
      ? await synthesizeWithSarvam(voice, turn.text)
      : null);
  let assetProvider: AudioAssetProvider = rawAudio ? "unrealspeech" : provider;

  if (!rawAudio) {
    console.warn(`All TTS providers failed for turn ${turn.id}, generating silence`);
    const duration = estimatedDuration(turn);
    let silenceTempDir: string | null = null;

    try {
      silenceTempDir = await mkdtemp(join(tmpdir(), "silence-"));
      const silentPath = join(silenceTempDir, "silent.mp3");
      await runFfmpeg([
        resolveFfmpegPath(),
        "-y",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=44100:cl=mono",
        "-t",
        String(duration),
        "-codec:a",
        "libmp3lame",
        "-b:a",
        "128k",
        silentPath,
      ]);
      const silentBuf = await readFile(silentPath);
      rawAudio = {
        data: silentBuf.buffer.slice(
          silentBuf.byteOffset,
          silentBuf.byteOffset + silentBuf.byteLength
        ),
        contentType: "audio/mpeg",
      };
      console.log(`Generated silence for turn ${turn.id}: ${duration}s`);
    } catch (silenceErr) {
      console.error(
        "Even silence generation failed:",
        silenceErr instanceof Error ? silenceErr.message : silenceErr
      );
      return {
        turnId: turn.id,
        speakerId: turn.speakerId,
        text: turn.text,
        segmentIndex,
        turnIndex,
        audioUrl: "",
        durationSeconds: estimatedDuration(turn),
        provider: "placeholder",
        normalized: false,
      };
    } finally {
      if (silenceTempDir) {
        await rm(silenceTempDir, { recursive: true, force: true });
      }
    }

    assetProvider = "placeholder";
  }

  const audioData = await normalizeAndTrimAudio(rawAudio, turn.id);
  const finalAudio = await ensureMp3Audio(audioData, turn.id);

  try {
    const uploaded = await uploadAudio(
      input.podcastId,
      input.jobId,
      turn.id,
      finalAudio.contentType,
      finalAudio.data
    );

    return {
      turnId: turn.id,
      speakerId: turn.speakerId,
      text: turn.text,
      segmentIndex,
      turnIndex,
      audioUrl: uploaded.signedUrl,
      storagePath: uploaded.storagePath,
      durationSeconds: estimatedDuration(turn),
      provider: assetProvider,
      normalized: finalAudio.contentType === "audio/mpeg",
    };
  } catch (uploadError: unknown) {
    console.error(
      `Upload failed for turn ${turn.id}:`,
      uploadError instanceof Error ? uploadError.message : uploadError
    );

    return {
      turnId: turn.id,
      speakerId: turn.speakerId,
      text: turn.text,
      segmentIndex,
      turnIndex,
      audioUrl: "",
      durationSeconds: estimatedDuration(turn),
      provider: "placeholder",
      normalized: false,
    };
  }
};

export const runAudioWorker = async (
  input: AudioWorkerInput,
  onTurnComplete?: (completed: number, total: number) => Promise<void>
): Promise<AudioWorkerResult> => {
  const totalTurns = input.script.segments.reduce(
    (total, segment) => total + segment.turns.length,
    0
  );
  const existingAssets = await getExistingAudioAssets(input.podcastId, input.jobId);
  const assets: TurnAudioAsset[] = [];

  for (const [segmentIndex, segment] of input.script.segments.entries()) {
    for (const [turnIndex, turn] of segment.turns.entries()) {
      try {
        const existing = existingAssets.find((asset) => asset.turnId === turn.id);
        const asset = existing && isRealAudioUrl(existing.audioUrl)
          ? {
              ...existing,
              speakerId: turn.speakerId,
              text: turn.text,
              segmentIndex,
              turnIndex,
            }
          : await synthesizeTurn(input, turn, segmentIndex, turnIndex);
        const nextAssets = [...assets, asset];

        await persistAudioAssets(input.podcastId, input.jobId, nextAssets);
        assets.push(asset);
        console.log(
          `Audio done for turn ${turn.id}: ${asset.provider} -> ${asset.audioUrl.slice(0, 60)}`
        );
      } catch (turnError: unknown) {
        console.error(
          `Turn ${turn.id} failed completely:`,
          turnError instanceof Error ? turnError.message : turnError
        );
        const failedAsset: TurnAudioAsset = {
          turnId: turn.id,
          speakerId: turn.speakerId,
          text: turn.text,
          segmentIndex,
          turnIndex,
          audioUrl: "",
          durationSeconds: estimatedDuration(turn),
          provider: "placeholder",
          normalized: false,
        };
        const nextAssets = [...assets, failedAsset];

        try {
          await persistAudioAssets(input.podcastId, input.jobId, nextAssets);
        } catch (persistError) {
          console.warn(
            `Persisting failed asset for turn ${turn.id} also failed:`,
            persistError instanceof Error ? persistError.message : persistError
          );
        }

        assets.push(failedAsset);
      }

      if (onTurnComplete) {
        await onTurnComplete(assets.length, totalTurns);
      }
    }
  }

  const validAssets = assets.filter((asset) => asset.audioUrl.length > 0);
  console.log(`Audio complete: ${validAssets.length}/${assets.length} turns have audio`);

  if (validAssets.length === 0) {
    throw new Error(
      "Audio generation failed for all turns. Check UNREAL_SPEECH_API_KEY and Cloudinary config in .env.local"
    );
  }

  return {
    assets,
    durationSeconds: assets.reduce((total, asset) => total + asset.durationSeconds, 0),
  };
};
