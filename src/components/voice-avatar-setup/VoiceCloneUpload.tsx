"use client";

import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { CheckCircle2, Loader2, Mic, Square, UploadCloud } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import type { SpeakerRole } from "@/types/voice";

interface VoiceCloneUploadProps {
  podcastId: string;
  speaker: SpeakerRole;
  existingVoiceId?: string;
  existingVoiceName?: string;
  onCloneCreated: (clone: { voiceId: string; name: string }) => void;
}

const qualityRules = [
  "Record in a quiet room with no fans, traffic, or music.",
  "Use one speaker only.",
  "Speak naturally at a normal pace.",
  "Keep the microphone distance consistent.",
  "Use 30 seconds to 3 minutes of audio.",
  "Upload MP3 or WAV only.",
  "Avoid reverb or echo.",
  "Do not include background music or sound effects.",
] as const;

const readApiError = async (response: Response, fallback: string) => {
  try {
    const payload: unknown = await response.json();

    if (
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof (payload as { error: unknown }).error === "string"
    ) {
      return (payload as { error: string }).error;
    }
  } catch {
    return fallback;
  }

  return fallback;
};

export function VoiceCloneUpload({
  podcastId,
  speaker,
  existingVoiceId,
  existingVoiceName,
  onCloneCreated,
}: VoiceCloneUploadProps) {
  const { user } = useAuth();
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const waveSurferRef = useRef<WaveSurfer | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [cloneName, setCloneName] = useState(existingVoiceName ?? `${speaker} voice clone`);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [createdVoiceId, setCreatedVoiceId] = useState(existingVoiceId ?? null);
  const [createdVoiceName, setCreatedVoiceName] = useState(existingVoiceName ?? null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!waveformRef.current || !audioUrl) {
      return;
    }

    waveSurferRef.current?.destroy();
    const waveSurfer = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: "rgba(251, 191, 36, 0.28)",
      progressColor: "rgb(252, 211, 77)",
      cursorColor: "rgb(255, 255, 255)",
      height: 70,
      barWidth: 2,
      barGap: 2,
      normalize: true,
      url: audioUrl,
    });
    waveSurferRef.current = waveSurfer;

    return () => waveSurfer.destroy();
  }, [audioUrl]);

  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }

      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [audioUrl, previewUrl]);

  const setSelectedFile = (file: File) => {
    setError(null);

    if (!file.type.includes("mpeg") && !file.type.includes("mp3") && !file.type.includes("wav") && !file.type.includes("webm")) {
      setError("Upload an MP3 or WAV file, or record live audio.");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError("Audio file must be 10MB or smaller.");
      return;
    }

    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }

    setAudioFile(file);
    setAudioUrl(URL.createObjectURL(file));
  };

  const startRecording = async () => {
    setError(null);

    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("This browser does not support live recording.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
        const file = new File([blob], `${speaker}-recording.webm`, { type: "audio/webm" });
        setSelectedFile(file);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (recordError) {
      setError(recordError instanceof Error ? recordError.message : "Could not start recording.");
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const uploadClone = async () => {
    if (!user || !audioFile) {
      setError("Choose or record audio before creating the clone.");
      return;
    }

    setUploading(true);
    setProgress(20);
    setError(null);

    const timer = window.setInterval(() => {
      setProgress((current) => Math.min(current + 12, 82));
    }, 450);

    try {
      const token = await user.getIdToken();
      const formData = new FormData();
      formData.append("audio", audioFile);
      formData.append("podcastId", podcastId);
      formData.append("speaker", speaker);
      formData.append("name", cloneName.trim() || `${speaker} voice clone`);

      const response = await fetch("/api/cloning/voice", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "Voice clone creation failed."));
      }

      const payload: unknown = await response.json();
      const voiceId =
        typeof payload === "object" &&
        payload !== null &&
        "voiceId" in payload &&
        typeof (payload as { voiceId: unknown }).voiceId === "string"
          ? (payload as { voiceId: string }).voiceId
          : null;
      const name =
        typeof payload === "object" &&
        payload !== null &&
        "name" in payload &&
        typeof (payload as { name: unknown }).name === "string"
          ? (payload as { name: string }).name
          : cloneName;

      if (!voiceId) {
        throw new Error("The clone provider did not return a voice id.");
      }

      setCreatedVoiceId(voiceId);
      setCreatedVoiceName(name);
      onCloneCreated({ voiceId, name });
      setProgress(92);

      const previewResponse = await fetch("/api/voices/preview", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: "elevenlabs",
          voiceId,
          text: "Hello, this is a preview of your cloned voice.",
        }),
      });

      if (previewResponse.ok) {
        const blob = await previewResponse.blob();
        setPreviewUrl((current) => {
          if (current) {
            URL.revokeObjectURL(current);
          }

          return URL.createObjectURL(blob);
        });
      }

      setProgress(100);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Voice clone creation failed.");
    } finally {
      window.clearInterval(timer);
      setUploading(false);
    }
  };

  return (
    <Card className="rounded-[8px] border border-white/10 bg-gray-950/60 py-0 text-white">
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-white">Clone your voice</p>
            <p className="text-xs text-gray-400">MP3/WAV, max 10MB.</p>
          </div>
          {createdVoiceId ? (
            <Badge className="rounded-[8px] border-emerald-300/30 bg-emerald-300/10 text-emerald-100" variant="outline">
              <CheckCircle2 className="size-3.5" />
              Clone ready
            </Badge>
          ) : null}
        </div>

        <Input
          value={cloneName}
          onChange={(event) => setCloneName(event.target.value)}
          className="h-10 rounded-[8px] border-white/10 bg-white/5 text-sm text-white"
          placeholder="Voice clone name"
        />

        <Tabs defaultValue="upload">
          <TabsList className="grid w-full grid-cols-2 rounded-[8px] bg-white/10">
            <TabsTrigger value="upload" className="rounded-[8px]">Upload File</TabsTrigger>
            <TabsTrigger value="record" className="rounded-[8px]">Record Live</TabsTrigger>
          </TabsList>
          <TabsContent value="upload" className="mt-4">
            <label
              className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-[8px] border border-dashed border-white/15 bg-white/[0.03] p-4 text-center text-sm text-gray-300 hover:bg-white/[0.06]"
              onDrop={(event) => {
                event.preventDefault();
                const file = event.dataTransfer.files.item(0);
                if (file) {
                  setSelectedFile(file);
                }
              }}
              onDragOver={(event) => event.preventDefault()}
            >
              <UploadCloud className="mb-2 size-6 text-amber-200" />
              Drop audio here or choose a file
              <input
                type="file"
                accept="audio/mpeg,audio/mp3,audio/wav,.mp3,.wav"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.item(0);
                  if (file) {
                    setSelectedFile(file);
                  }
                }}
              />
            </label>
          </TabsContent>
          <TabsContent value="record" className="mt-4 space-y-3">
            <div className="flex h-20 items-end justify-center gap-1 rounded-[8px] border border-white/10 bg-white/[0.03] p-3">
              {Array.from({ length: 28 }).map((_, index) => (
                <span
                  key={index}
                  className={cn(
                    "w-1 rounded-full bg-amber-300/70",
                    recording ? "animate-pulse" : "opacity-35"
                  )}
                  style={{ height: `${12 + ((index * 17) % 44)}px` }}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={startRecording}
                disabled={recording}
                className="h-10 flex-1 rounded-[8px] bg-amber-300 text-gray-950 hover:bg-amber-200"
              >
                <Mic className="size-4" />
                Start
              </Button>
              <Button
                type="button"
                onClick={stopRecording}
                disabled={!recording}
                variant="outline"
                className="h-10 flex-1 rounded-[8px] border-white/10 bg-white/5 text-white hover:bg-white/10"
              >
                <Square className="size-4" />
                Stop
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        {audioUrl ? (
          <div className="space-y-2">
            <div ref={waveformRef} className="overflow-hidden rounded-[8px] border border-white/10 bg-black/30" />
            <audio src={audioUrl} controls className="h-8 w-full" />
          </div>
        ) : null}

        <div className="grid gap-2 text-xs text-gray-300 sm:grid-cols-2">
          {qualityRules.map((rule) => (
            <div key={rule} className="flex gap-2 rounded-[8px] bg-white/[0.03] p-2">
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-300" />
              {rule}
            </div>
          ))}
        </div>

        {uploading ? <Progress value={progress} className="bg-white/10" /> : null}
        {previewUrl ? <audio src={previewUrl} controls className="h-8 w-full" /> : null}
        {error ? <p className="rounded-[8px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}

        <Button
          type="button"
          onClick={uploadClone}
          disabled={uploading || !audioFile}
          className="h-10 w-full rounded-[8px] bg-amber-300 text-sm font-semibold text-gray-950 hover:bg-amber-200"
        >
          {uploading ? <Loader2 className="size-4 animate-spin" /> : null}
          Create voice clone
        </Button>

        {createdVoiceName ? <p className="text-xs text-emerald-200">Ready: {createdVoiceName}</p> : null}
      </CardContent>
    </Card>
  );
}

