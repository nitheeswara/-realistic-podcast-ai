"use client";

import { doc, getDoc } from "firebase/firestore";
import { motion } from "framer-motion";
import type WaveSurfer from "wavesurfer.js";
import {
  Calendar,
  Copy,
  Download,
  Loader2,
  MoreVertical,
  Pause,
  Play,
  Plus,
  Trash2,
  Pencil,
  Volume2,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { db } from "@/config/firebase-client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import type { AudioTurnTiming } from "@/types/jobs";
import type { PodcastScript } from "@/types/script";

const speeds = [0.75, 1, 1.25, 1.5, 2] as const;

interface ResultPodcast {
  title: string;
  topic?: string;
  audience?: string;
  language: string;
  durationMinutes?: number;
  durationSeconds?: number;
  createdAt?: unknown;
  currentJobId?: string;
  ownerId?: string;
  status?: string;
  audioUrl?: string;
  audioTurns?: AudioTurnTiming[];
  script?: PodcastScript;
  hostName?: string;
  guestName?: string;
}

const getParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const estimateDuration = (text: string) =>
  Math.max(2, Math.ceil(text.split(/\s+/).filter(Boolean).length / 2.5));

const buildFallbackTurns = (script?: PodcastScript): AudioTurnTiming[] => {
  if (!script) {
    return [];
  }

  let cursor = 0;
  return script.segments
    .slice()
    .sort((a, b) => a.order - b.order)
    .flatMap((segment) => segment.turns)
    .map((turn) => {
      const durationSeconds = turn.estimatedDurationSeconds ?? estimateDuration(turn.text);
      const startSeconds = cursor;
      const endSeconds = startSeconds + durationSeconds;
      cursor = endSeconds;

      return {
        turnId: turn.id,
        speakerId: turn.speakerId,
        text: turn.text,
        durationSeconds,
        startSeconds,
        endSeconds,
      };
    });
};

const formatDuration = (seconds?: number, minutes?: number) => {
  if (typeof seconds === "number" && Number.isFinite(seconds)) {
    const rounded = Math.max(0, Math.round(seconds));
    const mins = Math.floor(rounded / 60);
    const secs = rounded % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  return minutes ? `${minutes} min` : "Pending";
};

const formatDate = (value: unknown) => {
  if (typeof value === "object" && value !== null && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate().toLocaleDateString();
  }

  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Recently" : date.toLocaleDateString();
  }

  return "Recently";
};

const readString = (data: Record<string, unknown>, key: string) => {
  const value = data[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
};

const readNumber = (data: Record<string, unknown>, key: string) => {
  const value = data[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const readSpeakerName = (data: Record<string, unknown>, key: "host" | "guest") => {
  const value = data[key];

  if (typeof value === "object" && value !== null && "name" in value) {
    const name = (value as { name?: unknown }).name;
    return typeof name === "string" && name.trim().length > 0 ? name.trim() : undefined;
  }

  return undefined;
};

const readAudioTurns = (value: unknown): AudioTurnTiming[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((turn): turn is AudioTurnTiming => {
    if (typeof turn !== "object" || turn === null) {
      return false;
    }

    const item = turn as Partial<AudioTurnTiming>;
    return (
      typeof item.turnId === "string" &&
      (item.speakerId === "host" || item.speakerId === "guest") &&
      typeof item.text === "string" &&
      typeof item.durationSeconds === "number" &&
      typeof item.startSeconds === "number" &&
      typeof item.endSeconds === "number"
    );
  });
};

export default function ResultPage() {
  const params = useParams();
  const router = useRouter();
  const podcastId = getParam(params.podcastId);
  const { user, loading } = useAuth();
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const volumeRef = useRef(0.9);
  const playbackRateRef = useRef(1);
  const [podcast, setPodcast] = useState<ResultPodcast | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioTurns, setAudioTurns] = useState<AudioTurnTiming[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.9);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftTopic, setDraftTopic] = useState("");
  const [draftAudience, setDraftAudience] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, router, user]);

  useEffect(() => {
    const loadResult = async () => {
      if (!user || !podcastId) {
        return;
      }

      setPageLoading(true);
      setMessage(null);

      try {
        const podcastSnapshot = await getDoc(doc(db, "podcasts", podcastId));

        if (!podcastSnapshot.exists()) {
          setMessage("We could not find that podcast.");
          return;
        }

        const data = podcastSnapshot.data() as Record<string, unknown>;

        if (readString(data, "ownerId") !== user.uid) {
          setMessage("We could not open this result from your account.");
          return;
        }

        let jobAudioUrl: string | undefined;
        let jobAudioTurns: AudioTurnTiming[] = [];
        let jobDuration: number | undefined;
        const currentJobId = readString(data, "currentJobId");

        if (currentJobId) {
          const jobSnapshot = await getDoc(doc(db, "jobs", currentJobId));

          if (jobSnapshot.exists()) {
            const jobData = jobSnapshot.data() as Record<string, unknown>;
            jobAudioUrl = readString(jobData, "audioUrl");
            jobAudioTurns = readAudioTurns(jobData.audioTurns);
            jobDuration = readNumber(jobData, "durationSeconds");
          }
        }

        const script = data.script as PodcastScript | undefined;
        const podcastAudioTurns = readAudioTurns(data.audioTurns);
        const nextPodcast: ResultPodcast = {
          title: readString(data, "title") ?? "Untitled podcast",
          topic: readString(data, "topic"),
          audience: readString(data, "audience"),
          language: readString(data, "language") ?? "unknown",
          durationMinutes: readNumber(data, "durationMinutes"),
          durationSeconds: jobDuration ?? readNumber(data, "durationSeconds"),
          createdAt: data.createdAt,
          currentJobId,
          ownerId: readString(data, "ownerId"),
          status: readString(data, "status"),
          audioUrl: jobAudioUrl ?? readString(data, "audioUrl"),
          audioTurns: jobAudioTurns.length > 0 ? jobAudioTurns : podcastAudioTurns,
          script,
          hostName: readSpeakerName(data, "host") ?? "Host",
          guestName: readSpeakerName(data, "guest") ?? "Guest",
        };

        const turns = nextPodcast.audioTurns && nextPodcast.audioTurns.length > 0
          ? nextPodcast.audioTurns
          : buildFallbackTurns(script);

        setPodcast(nextPodcast);
        setAudioUrl(nextPodcast.audioUrl ?? null);
        setAudioTurns(turns);
        setDraftTitle(nextPodcast.title);
        setDraftTopic(nextPodcast.topic ?? "");
        setDraftAudience(nextPodcast.audience ?? "");
      } catch {
        setMessage("Could not load the result. AI is busy, retrying may help.");
      } finally {
        setPageLoading(false);
      }
    };

    void loadResult();
  }, [podcastId, user]);

  useEffect(() => {
    if (!waveformRef.current || !audioUrl) {
      return;
    }

    let canceled = false;
    let cleanupFns: Array<() => void> = [];
    let instance: WaveSurfer | null = null;

    const setup = async () => {
      const { default: WaveSurferFactory } = await import("wavesurfer.js");

      if (canceled || !waveformRef.current) {
        return;
      }

      instance = WaveSurferFactory.create({
        container: waveformRef.current,
        url: audioUrl,
        height: 96,
        waveColor: "rgba(251, 191, 36, 0.35)",
        progressColor: "#fbbf24",
        cursorColor: "#c084fc",
        barWidth: 2,
        barGap: 2,
        barRadius: 2,
        normalize: true,
      });

      wavesurferRef.current = instance;
      instance.setVolume(volumeRef.current);
      instance.setPlaybackRate(playbackRateRef.current);

      cleanupFns = [
        instance.on("ready", () => {
          const nextDuration = instance?.getDuration() ?? 0;
          setDuration(nextDuration);
        }),
        instance.on("play", () => setIsPlaying(true)),
        instance.on("pause", () => setIsPlaying(false)),
        instance.on("finish", () => {
          setIsPlaying(false);
          setCurrentTime(0);
        }),
        instance.on("timeupdate", (time) => setCurrentTime(time)),
        instance.on("audioprocess", (time) => setCurrentTime(time)),
      ];
    };

    void setup();

    return () => {
      canceled = true;
      cleanupFns.forEach((cleanup) => cleanup());
      instance?.destroy();
      wavesurferRef.current = null;
    };
  }, [audioUrl]);

  useEffect(() => {
    volumeRef.current = volume;
    wavesurferRef.current?.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    playbackRateRef.current = playbackRate;
    wavesurferRef.current?.setPlaybackRate(playbackRate);
  }, [playbackRate]);

  const activeTurnId = useMemo(() => {
    const active = audioTurns.find(
      (turn) => currentTime >= turn.startSeconds && currentTime < turn.endSeconds
    );

    if (active) {
      return active.turnId;
    }

    return currentTime >= duration && audioTurns.length > 0
      ? audioTurns[audioTurns.length - 1]?.turnId
      : null;
  }, [audioTurns, currentTime, duration]);

  const totalDuration = duration || podcast?.durationSeconds || audioTurns[audioTurns.length - 1]?.endSeconds || 0;

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined" || !podcastId) {
      return "";
    }

    return `${window.location.origin}/dashboard/podcasts/${podcastId}/result`;
  }, [podcastId]);

  const togglePlayback = () => {
    void wavesurferRef.current?.playPause();
  };

  const seekTo = (value: number) => {
    if (!wavesurferRef.current || totalDuration <= 0) {
      return;
    }

    const nextTime = Math.min(totalDuration, Math.max(0, value));
    wavesurferRef.current.seekTo(nextTime / totalDuration);
    setCurrentTime(nextTime);
  };

  const copyShareLink = async () => {
    if (!shareUrl) {
      return;
    }

    await navigator.clipboard.writeText(shareUrl);
    setMessage("Share link copied.");
  };

  const saveEdits = async () => {
    if (!user || !podcastId) {
      return;
    }

    setSavingEdit(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/podcasts/${podcastId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: draftTitle,
          topic: draftTopic,
          audience: draftAudience,
        }),
      });

      if (!response.ok) {
        throw new Error("Update failed");
      }

      setPodcast((prev) => prev
        ? { ...prev, title: draftTitle, topic: draftTopic, audience: draftAudience }
        : prev);
      toast.success("Podcast updated");
      setIsEditing(false);
    } catch {
      toast.error("Failed to update podcast");
    } finally {
      setSavingEdit(false);
    }
  };

  const deletePodcast = async () => {
    if (!user || !podcastId) {
      return;
    }

    if (!window.confirm("Delete this podcast? This cannot be undone.")) {
      return;
    }

    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/podcasts/${podcastId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error("Delete failed");
      }

      toast.success("Podcast deleted");
      router.push("/dashboard");
    } catch {
      toast.error("Failed to delete podcast");
    }
  };

  if (loading || pageLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <div className="flex items-center gap-3 text-sm text-gray-400">
          <Loader2 className="size-4 animate-spin text-amber-200" />
          Loading podcast audio...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 px-4 py-8 text-white sm:px-6 lg:px-8">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <motion.header
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col gap-5 border-b border-white/10 pb-6 lg:flex-row lg:items-end lg:justify-between"
        >
          <div className="space-y-3">
            <p className="w-fit rounded-[8px] border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">
              Final MP3
            </p>
            <div>
              <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
                {isEditing ? (
                  <input
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void saveEdits();
                      }
                    }}
                    aria-label="Podcast title"
                    className="w-full rounded-[8px] border border-white/10 bg-white/5 px-3 py-2 text-3xl text-white"
                  />
                ) : (
                  <span className="inline-flex items-center gap-2">
                    {podcast?.title ?? "Podcast result"}
                    <button
                      type="button"
                      onClick={() => setIsEditing(true)}
                      className="rounded-[6px] border border-white/10 bg-white/5 p-1 text-white hover:bg-white/10"
                      aria-label="Edit podcast title"
                    >
                      <Pencil className="size-4" />
                    </button>
                  </span>
                )}
              </h1>
              {isEditing ? (
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <input
                    value={draftTopic}
                    onChange={(event) => setDraftTopic(event.target.value)}
                    className="w-full rounded-[8px] border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
                    placeholder="Topic"
                  />
                  <input
                    value={draftAudience}
                    onChange={(event) => setDraftAudience(event.target.value)}
                    className="w-full rounded-[8px] border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
                    placeholder="Audience"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={savingEdit}
                    onClick={() => void saveEdits()}
                    className="h-9 rounded-[8px] bg-emerald-300 px-3 text-xs font-semibold text-gray-950 hover:bg-emerald-200"
                  >
                    {savingEdit ? "Saving..." : "Save"}
                  </Button>
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <MetaPill label="Duration" value={formatDuration(totalDuration, podcast?.durationMinutes)} />
                <MetaPill label="Language" value={podcast?.language ?? "unknown"} />
                <MetaPill label="Date" value={formatDate(podcast?.createdAt)} icon={<Calendar className="size-3.5" />} />
                <MetaPill label="Status" value={podcast?.status ?? "unknown"} />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={copyShareLink}
              className="h-11 rounded-[8px] border-white/10 bg-white/5 text-sm text-white hover:bg-white/10"
            >
              <Copy className="size-4" />
              Share link
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 rounded-[8px] border-white/10 bg-white/5 text-sm text-white hover:bg-white/10"
                >
                  <MoreVertical className="size-4" />
                  Options
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onClick={() => setIsEditing(true)}>
                  <Pencil className="size-4" />
                  Edit metadata
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={deletePodcast}>
                  <Trash2 className="size-4" />
                  Delete podcast
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {audioUrl ? (
              <Button asChild className="h-11 rounded-[8px] bg-amber-300 px-5 text-sm font-semibold text-gray-950 hover:bg-amber-200">
                <a href={audioUrl} download>
                  <Download className="size-4" />
                  Download MP3
                </a>
              </Button>
            ) : null}
            <Button asChild variant="outline" className="h-11 rounded-[8px] border-white/10 bg-white/5 text-sm text-white hover:bg-white/10">
              <Link href="/dashboard/create">
                <Plus className="size-4" />
                Create New Podcast
              </Link>
            </Button>
          </div>
        </motion.header>

        {message ? (
          <p className="rounded-[8px] border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
            {message}
          </p>
        ) : null}

        <section className="rounded-[8px] border border-white/10 bg-white/[0.04] p-5 ring-1 ring-white/5">
          {audioUrl ? (
            <div className="space-y-5">
              <div ref={waveformRef} className="overflow-hidden rounded-[8px] bg-gray-950/70 px-2 py-4" />
              <div className="grid gap-4 lg:grid-cols-[auto_1fr_auto] lg:items-center">
                <Button
                  type="button"
                  onClick={togglePlayback}
                  className="size-12 rounded-[8px] bg-amber-300 p-0 text-gray-950 hover:bg-amber-200"
                  aria-label={isPlaying ? "Pause" : "Play"}
                >
                  {isPlaying ? <Pause className="size-5" /> : <Play className="size-5" />}
                </Button>
                <div className="space-y-2">
                  <input
                    type="range"
                    min={0}
                    max={Math.max(1, totalDuration)}
                    step={0.1}
                    value={Math.min(currentTime, totalDuration)}
                    onChange={(event) => seekTo(Number(event.target.value))}
                    className="h-2 w-full accent-amber-300"
                    aria-label="Audio progress"
                  />
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>{formatDuration(currentTime)}</span>
                    <span>{formatDuration(totalDuration)}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-gray-400">
                    <Volume2 className="size-4 text-gray-300" />
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={volume}
                      onChange={(event) => setVolume(Number(event.target.value))}
                      className="w-24 accent-violet-300"
                      aria-label="Volume"
                    />
                  </label>
                  <div className="flex rounded-[8px] border border-white/10 bg-gray-950/70 p-1">
                    {speeds.map((speed) => (
                      <button
                        key={speed}
                        type="button"
                        onClick={() => setPlaybackRate(speed)}
                        className={cn(
                          "h-8 rounded-[6px] px-2 text-xs font-semibold transition",
                          playbackRate === speed
                            ? "bg-violet-300 text-gray-950"
                            : "text-gray-300 hover:bg-white/10"
                        )}
                      >
                        {speed}x
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-64 items-center justify-center text-center text-sm text-gray-400">
              The final MP3 is not attached yet.
            </div>
          )}
        </section>

        <section className="rounded-[8px] border border-white/10 bg-white/[0.035] p-5 ring-1 ring-white/5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold text-white">Transcript</h2>
            <Badge variant="outline" className="rounded-[8px] border-white/10 bg-white/5 text-gray-300">
              {audioTurns.length} turns
            </Badge>
          </div>
          <div className="space-y-3">
            {audioTurns.length > 0 ? (
              audioTurns.map((turn) => {
                const active = activeTurnId === turn.turnId;
                const host = turn.speakerId === "host";
                const speakerName = host
                  ? podcast?.hostName ?? "Host"
                  : podcast?.guestName ?? "Guest";

                return (
                  <article
                    key={turn.turnId}
                    className={cn(
                      "rounded-[8px] border p-4 transition",
                      active
                        ? host
                          ? "border-amber-300/50 bg-amber-300/10"
                          : "border-violet-300/50 bg-violet-300/10"
                        : "border-white/10 bg-gray-950/50"
                    )}
                  >
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          "rounded-[8px] border",
                          host
                            ? "border-amber-300/30 bg-amber-300/10 text-amber-100"
                            : "border-violet-300/30 bg-violet-300/10 text-violet-100"
                        )}
                      >
                        {speakerName}
                      </Badge>
                      <span className="text-xs text-gray-500">
                        {formatDuration(turn.startSeconds)} - {formatDuration(turn.endSeconds)}
                      </span>
                    </div>
                    <p className="text-sm leading-6 text-gray-200">{turn.text}</p>
                  </article>
                );
              })
            ) : (
              <p className="rounded-[8px] border border-white/10 bg-gray-950/50 px-4 py-8 text-center text-sm text-gray-400">
                Transcript turns are not available for this podcast.
              </p>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

function MetaPill({
  icon,
  label,
  value,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-[8px] border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-300">
      {icon}
      <span className="text-gray-500">{label}</span>
      <span className="font-semibold capitalize text-white">{value}</span>
    </span>
  );
}
