import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ffmpegStatic from "ffmpeg-static";

import { serverEnv } from "@/config/env";
import { isIndianLanguage } from "@/lib/podcast/language-config";
import type { PodcastScript, ScriptTurn } from "@/types/script";
import type { SpeakerConfig } from "@/types/voice";

export interface AudioJobInput {
  jobId: string;
  podcastId: string;
  script: PodcastScript;
  speakers: SpeakerConfig[];
}

export interface TurnAudio {
  turnId: string;
  speakerId: string;
  text: string;
  localPath: string;
  durationSeconds: number;
}

export interface AudioJobResult {
  finalAudioUrl: string;
  finalAudioPath: string;
  durationSeconds: number;
  turns: TurnAudio[];
}

// -- FFmpeg helper -------------------------------------------------
const resolveFfmpeg = () => serverEnv.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";

async function runFfmpeg(args: string[]): Promise<void> {
  const [bin, ...rest] = args;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin!, rest, { stdio: ["ignore", "ignore", "pipe"] });
    const err: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(Buffer.concat(err).toString() || "FFmpeg failed"));
      }
    });
  });
}

// -- TTS providers -------------------------------------------------

// Provider 1: Unreal Speech (primary - 500K chars/month free)
async function ttsUnrealSpeech(
  text: string,
  speakerId: string,
  voiceIdOverride?: string
): Promise<Buffer | null> {
  const key = process.env.UNREAL_SPEECH_API_KEY;
  if (!key) {
    return null;
  }

  const voiceId = voiceIdOverride || (speakerId === "host" ? "Dan" : "Scarlett");

  try {
    const res = await fetch("https://api.v7.unrealspeech.com/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        Text: text,
        VoiceId: voiceId,
        Bitrate: "192k",
        Speed: "0",
        Pitch: "1",
      }),
    });

    if (!res.ok) {
      console.warn("Unreal Speech error:", res.status);
      return null;
    }

    const data = await res.json() as { OutputUri?: string };
    if (!data.OutputUri) {
      return null;
    }

    const audioRes = await fetch(data.OutputUri);
    if (!audioRes.ok) {
      return null;
    }

    const buf = Buffer.from(await audioRes.arrayBuffer());
    console.log(`Unreal Speech OK [${speakerId}/${voiceId}]: ${buf.length} bytes`);
    return buf;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("Unreal Speech exception:", message);
    return null;
  }
}

// Provider 2: ElevenLabs (if key available)
async function ttsElevenLabs(
  text: string,
  voiceId: string,
  speakerId: string
): Promise<Buffer | null> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key || !voiceId) {
    return null;
  }

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": key,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.35,
            similarity_boost: 0.85,
            style: 0.45,
            use_speaker_boost: true,
          },
          pronunciation_dictionary_locators: [],
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`ElevenLabs error ${res.status}:`, errText.slice(0, 200));
      return null;
    }

    const buf = Buffer.from(await res.arrayBuffer());
    console.log(`ElevenLabs [${speakerId}/${voiceId}]: ${buf.length} bytes`);
    return buf;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("ElevenLabs exception:", message);
    return null;
  }
}

// Provider 3: Sarvam (for Indian languages)
async function ttsSarvamInternal(
  text: string,
  langCode: string,
  speaker: string
): Promise<Buffer | null> {
  const key = process.env.SARVAM_API_KEY;
  if (!key) {
    return null;
  }

  const baseCode = langCode.split("-")[0]?.toLowerCase() ?? "hi";
  const targetLangCode = `${baseCode}-IN`;

  console.log(`Sarvam TTS: speaker=${speaker} lang=${targetLangCode} text="${text.slice(0, 40)}..."`);

  try {
    const res = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: {
        "api-subscription-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: [text],
        target_language_code: targetLangCode,
        speaker,
        pace: 1.0,
        loudness: 1.5,
        speech_sample_rate: 22050,
        enable_preprocessing: true,
        model: "bulbul:v2",
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`Sarvam error ${res.status}:`, errText.slice(0, 300));
      return null;
    }

    const data = await res.json() as { audios?: string[] };
    const b64 = data.audios?.[0];
    if (!b64) {
      console.error("Sarvam returned empty audio array");
      return null;
    }

    const buf = Buffer.from(b64, "base64");
    console.log(`Sarvam OK: ${speaker}/${targetLangCode} -> ${buf.length} bytes`);
    return buf;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Sarvam exception:", message);
    return null;
  }
}

async function ttsSarvam(
  text: string,
  langCode: string,
  speakerId: string
): Promise<Buffer | null> {
  const VALID_SPEAKERS = {
    male: ["abhilash", "karun", "hitesh"],
    female: ["anushka", "manisha", "vidya", "arya"],
  } as const;

  const speaker = speakerId === "host"
    ? VALID_SPEAKERS.male[0]
    : VALID_SPEAKERS.female[0];

  return ttsSarvamInternal(text, langCode, speaker);
}

async function ttsSarvamWithSpeaker(
  text: string,
  langCode: string,
  speaker: string
): Promise<Buffer | null> {
  const VALID = ["abhilash", "karun", "hitesh", "anushka", "manisha", "vidya", "arya"];
  const safeSpeaker = VALID.includes(speaker) ? speaker : "abhilash";
  return ttsSarvamInternal(text, langCode, safeSpeaker);
}

// -- Generate silence as last resort -------------------------------
async function generateSilence(
  durationSec: number,
  outputPath: string
): Promise<void> {
  await runFfmpeg([
    resolveFfmpeg(), "-y",
    "-f", "lavfi",
    "-i", "anullsrc=r=44100:cl=stereo",
    "-t", String(durationSec),
    "-codec:a", "libmp3lame",
    "-b:a", "128k",
    outputPath,
  ]);
}

// -- Estimate turn duration from word count ------------------------
function estimateDuration(text: string): number {
  return Math.max(2, Math.ceil(text.split(/\s+/).length / 2.5));
}

function detectLanguageFromText(text: string): string | null {
  if (/[\u0B80-\u0BFF]/.test(text)) {
    return "ta";
  }
  if (/[\u0900-\u097F]/.test(text)) {
    return "hi";
  }
  if (/[\u0C00-\u0C7F]/.test(text)) {
    return "te";
  }
  if (/[\u0D00-\u0D7F]/.test(text)) {
    return "ml";
  }
  if (/[\u0C80-\u0CFF]/.test(text)) {
    return "kn";
  }
  if (/[\u0980-\u09FF]/.test(text)) {
    return "bn";
  }
  if (/[\u0A80-\u0AFF]/.test(text)) {
    return "gu";
  }
  if (/[\u0A00-\u0A7F]/.test(text)) {
    return "pa";
  }
  return null;
}

// -- Generate audio for one turn -----------------------------------
async function generateTurnAudio(
  turn: ScriptTurn,
  speakers: SpeakerConfig[],
  language: string,
  tempDir: string
): Promise<TurnAudio> {
  const speaker = speakers.find((item) => item.role === turn.speakerId || item.id === turn.speakerId);
  const outputPath = join(tempDir, `turn_${turn.id}.mp3`);

  console.log(`Generating audio for turn ${turn.id} [${turn.speakerId}]: "${turn.text.slice(0, 50)}..."`);

  const storedLang = language ?? "en";
  const detectedLang = detectLanguageFromText(turn.text);
  const effectiveLang = detectedLang ?? storedLang;
  const isIndian = isIndianLanguage(effectiveLang) || detectedLang !== null;

  console.log(
    `Turn ${turn.id}: stored="${storedLang}" detected="${detectedLang ?? "none"}" ` +
    `effective="${effectiveLang}" isIndian=${isIndian}`
  );

  let audioBuffer: Buffer | null = null;

  if (isIndian) {
    if (!process.env.SARVAM_API_KEY) {
      console.error("SARVAM_API_KEY not set -- cannot generate Indian language audio");
      await generateSilence(estimateDuration(turn.text), outputPath);
      return {
        turnId: turn.id,
        speakerId: turn.speakerId,
        text: turn.text,
        localPath: outputPath,
        durationSeconds: estimateDuration(turn.text),
      };
    }

    const sarvamVoiceId = speaker?.voiceId?.startsWith("sarvam-")
      ? speaker.voiceId.replace("sarvam-", "")
      : null;
    audioBuffer = sarvamVoiceId
      ? await ttsSarvamWithSpeaker(turn.text, effectiveLang, sarvamVoiceId)
      : await ttsSarvam(turn.text, effectiveLang, turn.speakerId);

    if (!audioBuffer) {
      console.error(`Sarvam failed for turn ${turn.id} -- generating silence`);
      await generateSilence(estimateDuration(turn.text), outputPath);
      return {
        turnId: turn.id,
        speakerId: turn.speakerId,
        text: turn.text,
        localPath: outputPath,
        durationSeconds: estimateDuration(turn.text),
      };
    }
  } else {
    const selectedVoiceId = speaker?.voice?.externalVoiceId ?? speaker?.voiceId;
    if (
      selectedVoiceId &&
      process.env.ELEVENLABS_API_KEY &&
      !selectedVoiceId.startsWith("unrealspeech-") &&
      !selectedVoiceId.startsWith("sarvam-")
    ) {
      audioBuffer = await ttsElevenLabs(turn.text, selectedVoiceId, turn.speakerId);
    }

    if (!audioBuffer && process.env.ELEVENLABS_API_KEY) {
      const defaultVoice = turn.speakerId === "host"
        ? "pNInz6obpgDQGcFmaJgB"
        : "EXAVITQu4vr4xnSDxMaL";
      audioBuffer = await ttsElevenLabs(turn.text, defaultVoice, turn.speakerId);
    }

    if (!audioBuffer) {
      const urVoice = turn.speakerId === "host" ? "Dan" : "Scarlett";
      audioBuffer = await ttsUnrealSpeech(turn.text, turn.speakerId, urVoice);
    }
  }

  if (audioBuffer) {
    await writeFile(outputPath, audioBuffer);
  } else {
    console.warn(`All TTS failed for ${turn.id} - using silence`);
    await generateSilence(estimateDuration(turn.text), outputPath);
    return {
      turnId: turn.id,
      speakerId: turn.speakerId,
      text: turn.text,
      localPath: outputPath,
      durationSeconds: estimateDuration(turn.text),
    };
  }

  let durationSeconds = estimateDuration(turn.text);
  try {
    const dur = await new Promise<number>((resolve) => {
      const child = spawn(resolveFfmpeg(), [
        "-i", outputPath,
        "-f", "null", "-",
      ], { stdio: ["ignore", "ignore", "pipe"] });
      const chunks: Buffer[] = [];
      child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
      child.on("close", () => {
        const output = Buffer.concat(chunks).toString();
        const match = output.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
        if (match) {
          const h = Number.parseInt(match[1]!, 10);
          const m = Number.parseInt(match[2]!, 10);
          const s = Number.parseFloat(match[3]!);
          resolve(h * 3600 + m * 60 + s);
        } else {
          resolve(estimateDuration(turn.text));
        }
      });
    });
    durationSeconds = dur;
  } catch {
    // Keep estimate
  }

  console.log(`Turn ${turn.id} audio ready: ${durationSeconds.toFixed(1)}s`);

  return {
    turnId: turn.id,
    speakerId: turn.speakerId,
    text: turn.text,
    localPath: outputPath,
    durationSeconds,
  };
}

// -- Merge all turn audio files into one final MP3 -----------------
async function mergeTurnAudios(
  turns: TurnAudio[],
  tempDir: string,
  ffmpegPath: string
): Promise<string> {
  if (turns.length === 0) {
    throw new Error("No audio turns to merge");
  }

  if (turns.length === 1) {
    const finalPath = join(tempDir, "merged_podcast.mp3");
    await runFfmpeg([
      ffmpegPath, "-y",
      "-i", turns[0]!.localPath,
      "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
      "-c:a", "libmp3lame",
      "-b:a", "192k",
      "-ar", "44100",
      "-ac", "2",
      finalPath,
    ]);
    return finalPath;
  }

  const wavFiles: string[] = [];

  for (let i = 0; i < turns.length; i += 1) {
    const turn = turns[i]!;
    const wavPath = join(tempDir, `turn_${i}_decoded.wav`);
    await runFfmpeg([
      ffmpegPath, "-y",
      "-i", turn.localPath,
      "-c:a", "pcm_s16le",
      "-ar", "44100",
      "-ac", "2",
      wavPath,
    ]);
    wavFiles.push(wavPath);

    if (i < turns.length - 1) {
      const nextTurn = turns[i + 1]!;
      const isSameSpeaker = turn.speakerId === nextTurn.speakerId;
      const silenceSec = isSameSpeaker ? 0.3 : 0.6;
      const silencePath = join(tempDir, `silence_${i}.wav`);
      await runFfmpeg([
        ffmpegPath, "-y",
        "-f", "lavfi",
        "-i", "anullsrc=r=44100:cl=stereo",
        "-t", String(silenceSec),
        "-c:a", "pcm_s16le",
        "-ar", "44100",
        "-ac", "2",
        silencePath,
      ]);
      wavFiles.push(silencePath);
    }
  }

  const concatListPath = join(tempDir, "concat_wav.txt");
  const concatContent = wavFiles
    .map((filePath) => `file '${filePath.replace(/\\/g, "/")}'`)
    .join("\n");
  await writeFile(concatListPath, concatContent);

  const mergedWavPath = join(tempDir, "merged_raw.wav");
  await runFfmpeg([
    ffmpegPath, "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", concatListPath,
    "-c:a", "pcm_s16le",
    "-ar", "44100",
    "-ac", "2",
    mergedWavPath,
  ]);

  const finalPath = join(tempDir, "merged_podcast.mp3");
  await runFfmpeg([
    ffmpegPath, "-y",
    "-i", mergedWavPath,
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
    "-c:a", "libmp3lame",
    "-b:a", "192k",
    "-ar", "44100",
    "-ac", "2",
    "-id3v2_version", "3",
    finalPath,
  ]);

  console.log(`Merged ${turns.length} turns into final MP3 (no artifacts)`);
  return finalPath;
}

// -- Upload final audio to Cloudinary ------------------------------
async function uploadFinalAudio(
  localPath: string,
  podcastId: string,
  jobId: string
): Promise<string> {
  const { uploadAudioBuffer } = await import("@/lib/server/storage");
  const buffer = await readFile(localPath);
  const storagePath = `podcasts/${podcastId}/${jobId}/final_podcast.mp3`;
  const url = await uploadAudioBuffer(buffer, storagePath);
  console.log(`Final audio uploaded: ${url}`);
  return url;
}

// -- Main export ---------------------------------------------------
export async function runAudioJob(
  input: AudioJobInput,
  onProgress?: (stage: string, pct: number) => Promise<void>
): Promise<AudioJobResult> {
  const tempDir = await mkdtemp(join(tmpdir(), "podcast-audio-"));
  const language = input.script.language ?? "en";

  try {
    const allTurns = input.script.segments.flatMap((segment) => segment.turns);
    console.log(`Starting audio generation: ${allTurns.length} turns, language: ${language}`);

    const turnAudios: TurnAudio[] = [];

    for (const [index, turn] of allTurns.entries()) {
      const audio = await generateTurnAudio(turn, input.speakers, language, tempDir);
      turnAudios.push(audio);
      const pct = Math.round(((index + 1) / allTurns.length) * 80);
      await onProgress?.("audio", pct);
    }

    await onProgress?.("merge", 85);
    const mergedPath = await mergeTurnAudios(turnAudios, tempDir, resolveFfmpeg());

    await onProgress?.("export", 92);
    const finalUrl = await uploadFinalAudio(mergedPath, input.podcastId, input.jobId);
    await onProgress?.("export", 100);

    const totalDuration = turnAudios.reduce((total, audio) => total + audio.durationSeconds, 0);

    return {
      finalAudioUrl: finalUrl,
      finalAudioPath: mergedPath,
      durationSeconds: totalDuration,
      turns: turnAudios,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}