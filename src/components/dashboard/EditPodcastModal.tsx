"use client";

import { useEffect, useRef, useState } from "react";
import { Check, FileText, Mic, Pause, Play, RefreshCw, Save, Tag, Users, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";

interface Voice {
  id: string;
  name: string;
  gender: string;
  provider: string;
  previewUrl?: string | null;
}

interface EditPodcastModalProps {
  open: boolean;
  onClose: () => void;
  podcast: {
    id: string;
    title: string;
    topic: string;
    audience: string;
    language?: string;
    host?: { voiceId?: string; voiceName?: string };
    guest?: { voiceId?: string; voiceName?: string };
  };
  onSaved: (updated: { title: string; topic: string; audience: string }) => void;
  onRegenerate: () => void;
}

export function EditPodcastModal({
  open,
  onClose,
  podcast,
  onSaved,
  onRegenerate,
}: EditPodcastModalProps) {
  const { user } = useAuth();
  const [title, setTitle] = useState(podcast.title ?? "");
  const [topic, setTopic] = useState(podcast.topic ?? "");
  const [audience, setAudience] = useState(podcast.audience ?? "");
  const [hostVoiceId, setHostVoiceId] = useState(podcast.host?.voiceId ?? "");
  const [guestVoiceId, setGuestVoiceId] = useState(podcast.guest?.voiceId ?? "");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [activeVoiceTab, setActiveVoiceTab] = useState<"host" | "guest">("host");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setTitle(podcast.title ?? "");
    setTopic(podcast.topic ?? "");
    setAudience(podcast.audience ?? "");
    setHostVoiceId(podcast.host?.voiceId ?? "");
    setGuestVoiceId(podcast.guest?.voiceId ?? "");
  }, [podcast.id, podcast.title, podcast.topic, podcast.audience, podcast.host?.voiceId, podcast.guest?.voiceId]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setLoadingVoices(true);
    fetch(`/api/voices/list?language=${encodeURIComponent(podcast.language ?? "en")}`)
      .then((res) => res.json())
      .then((payload) => setVoices(payload.voices ?? []))
      .catch(() => {})
      .finally(() => setLoadingVoices(false));
  }, [open, podcast.language]);

  useEffect(() => {
    if (!open) {
      audioRef.current?.pause();
      setPlayingId(null);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const handlePreview = async (voiceId: string, provider: string) => {
    if (playingId === voiceId) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }

    audioRef.current?.pause();
    setPlayingId(voiceId);

    try {
      const res = await fetch("/api/voices/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voiceId,
          provider,
          language: podcast.language,
          text: "Hello! This is a preview of my voice for your podcast.",
        }),
      });

      if (!res.ok) {
        throw new Error();
      }

      const blob = await res.blob();
      const audio = new Audio(URL.createObjectURL(blob));
      audioRef.current = audio;
      audio.play();
      audio.onended = () => setPlayingId(null);
    } catch {
      setPlayingId(null);
      toast.error("Preview unavailable");
    }
  };

  const getToken = async () => {
    try {
      return await user?.getIdToken();
    } catch {
      return null;
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/podcasts/${podcast.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          title,
          topic,
          audience,
          host: { voiceId: hostVoiceId },
          guest: { voiceId: guestVoiceId },
        }),
      });

      if (!res.ok) {
        throw new Error("Save failed");
      }

      toast.success("Changes saved successfully");
      onSaved({ title, topic, audience });
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const token = await getToken();
      await fetch(`/api/podcasts/${podcast.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          title,
          topic,
          audience,
          host: { voiceId: hostVoiceId },
          guest: { voiceId: guestVoiceId },
        }),
      });
      onSaved({ title, topic, audience });
      onRegenerate();
      onClose();
    } catch {
      toast.error("Failed to start regeneration");
    } finally {
      setRegenerating(false);
    }
  };

  const maleVoices = voices.filter((voice) => voice.gender !== "female");
  const femaleVoices = voices.filter((voice) => voice.gender !== "male");
  const hostVoices = maleVoices.length > 0 ? maleVoices : voices;
  const guestVoices = femaleVoices.length > 0 ? femaleVoices : voices;
  const activeVoices = activeVoiceTab === "host" ? hostVoices : guestVoices;
  const activeSelected = activeVoiceTab === "host" ? hostVoiceId : guestVoiceId;
  const setActiveVoice = activeVoiceTab === "host" ? setHostVoiceId : setGuestVoiceId;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="relative flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-gray-800 bg-gray-950 shadow-2xl shadow-black/50"
      >
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-amber-500/10">
              <FileText className="size-4 text-amber-400" />
            </div>
            <h2 className="text-lg font-bold text-white">Edit Podcast</h2>
          </div>
          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg bg-gray-800 text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
            type="button"
            aria-label="Close modal"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
              <Tag className="size-3.5 text-amber-400" />
              Episode Title
            </label>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Enter episode title..."
              className="h-10 rounded-lg border-gray-700 bg-gray-900 text-sm text-white placeholder:text-gray-600 focus:border-amber-500/50"
            />
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
              <FileText className="size-3.5 text-violet-400" />
              Topic
            </label>
            <Textarea
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="What is this podcast about?"
              rows={2}
              className="resize-none rounded-lg border-gray-700 bg-gray-900 text-sm text-white placeholder:text-gray-600 focus:border-violet-500/50"
            />
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
              <Users className="size-3.5 text-blue-400" />
              Target Audience
            </label>
            <Input
              value={audience}
              onChange={(event) => setAudience(event.target.value)}
              placeholder="e.g. students, professionals, general audience..."
              className="h-10 rounded-lg border-gray-700 bg-gray-900 text-sm text-white placeholder:text-gray-600 focus:border-blue-500/50"
            />
          </div>

          <div className="space-y-3">
            <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
              <Mic className="size-3.5 text-green-400" />
              Voices
            </label>

            <div className="flex gap-1 rounded-lg bg-gray-900 p-1">
              {(["host", "guest"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveVoiceTab(tab)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
                    activeVoiceTab === tab
                      ? "bg-gray-700 text-white shadow-sm"
                      : "text-gray-500 hover:text-gray-300"
                  }`}
                  type="button"
                >
                  {tab === "host" ? "Host" : "Guest"}
                  {tab === "host" && hostVoiceId ? (
                    <span className="ml-1.5 text-xs text-amber-400">
                      {voices.find((voice) => voice.id === hostVoiceId)?.name?.split(" ")[0]}
                    </span>
                  ) : null}
                  {tab === "guest" && guestVoiceId ? (
                    <span className="ml-1.5 text-xs text-violet-400">
                      {voices.find((voice) => voice.id === guestVoiceId)?.name?.split(" ")[0]}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>

            {loadingVoices ? (
              <div className="grid grid-cols-1 gap-2">
                {[1, 2, 3].map((index) => (
                  <div key={index} className="h-14 animate-pulse rounded-lg bg-gray-800" />
                ))}
              </div>
            ) : (
              <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                {activeVoices.map((voice) => {
                  const isSelected = activeSelected === voice.id;
                  const isPlaying = playingId === voice.id;

                  return (
                    <div
                      key={voice.id}
                      className={`flex items-center justify-between rounded-xl border px-4 py-3 transition-all duration-150 ${
                        isSelected
                          ? activeVoiceTab === "host"
                            ? "border-amber-500/60 bg-amber-500/10"
                            : "border-violet-500/60 bg-violet-500/10"
                          : "border-gray-800 bg-gray-900 hover:border-gray-600 hover:bg-gray-800/80"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setActiveVoice(voice.id)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <div
                          className={`size-2 shrink-0 rounded-full ${
                            voice.gender === "female" ? "bg-pink-400" : "bg-blue-400"
                          }`}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-white">
                            {voice.name}
                          </p>
                          <p className="truncate text-xs capitalize text-gray-500">
                            {voice.provider} - {voice.gender}
                          </p>
                        </div>
                      </button>

                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          onClick={() => void handlePreview(voice.id, voice.provider)}
                          className={`flex size-8 items-center justify-center rounded-lg transition-colors ${
                            isPlaying
                              ? "bg-green-500/20 text-green-400"
                              : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
                          }`}
                          type="button"
                          aria-label={`Preview ${voice.name}`}
                        >
                          {isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                        </button>
                        {isSelected ? (
                          <div
                            className={`flex size-5 items-center justify-center rounded-full ${
                              activeVoiceTab === "host" ? "bg-amber-500" : "bg-violet-500"
                            }`}
                          >
                            <Check className="size-3 text-white" />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}

                {activeVoices.length === 0 ? (
                  <div className="py-8 text-center text-sm text-gray-600">No voices available</div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-gray-800 px-5 py-4">
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={onClose}
              className="flex-1 rounded-xl border border-gray-800 text-sm text-gray-400 hover:bg-gray-800 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 rounded-xl bg-amber-500 text-sm font-semibold text-black hover:bg-amber-400"
            >
              <Save className="mr-1.5 size-4" />
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button
              onClick={handleRegenerate}
              disabled={regenerating}
              className="flex-1 rounded-xl bg-violet-600 text-sm font-semibold text-white hover:bg-violet-500"
            >
              <RefreshCw className={`mr-1.5 size-4 ${regenerating ? "animate-spin" : ""}`} />
              {regenerating ? "Starting..." : "Regenerate"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
