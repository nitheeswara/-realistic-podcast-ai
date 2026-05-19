"use client";

import { doc, getDoc, increment, serverTimestamp, updateDoc } from "firebase/firestore";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { db } from "@/config/firebase-client";
import { useAuth } from "@/hooks/useAuth";
import { podcastScriptSchema } from "@/lib/podcast/schemas";
import { cn } from "@/lib/utils";
import type { PodcastScript, ScriptSegment, ScriptSpeakerId, ScriptTurn } from "@/types/script";

type SaveStatus = "idle" | "saving" | "saved" | "error";

interface PodcastShell {
  title: string;
  script: PodcastScript | null;
}

const getParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const speakerBadgeClass: Record<ScriptSpeakerId, string> = {
  host: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  guest: "border-violet-300/30 bg-violet-300/10 text-violet-100",
};

function AutosaveIndicator({ status }: { status: SaveStatus }) {
  const label = {
    idle: "Ready",
    saving: "Autosaving...",
    saved: "Saved",
    error: "Autosave failed",
  }[status];

  return (
    <div className="flex items-center gap-2 rounded-[8px] border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-300">
      <span
        className={cn(
          "size-2 rounded-full",
          status === "saving" && "animate-pulse bg-amber-300",
          status === "saved" && "bg-emerald-300",
          status === "error" && "bg-red-300",
          status === "idle" && "bg-gray-500"
        )}
      />
      {label}
    </div>
  );
}

const createBlankTurn = (speakerId: ScriptSpeakerId): ScriptTurn => ({
  id: crypto.randomUUID(),
  speakerId,
  text: "New line for this speaker.",
  emotion: "neutral",
  pauseAfterMs: 300,
  estimatedDurationSeconds: 4,
});

const normalizeScript = (script: PodcastScript): PodcastScript => ({
  ...script,
  segments: script.segments.map((segment, index) => ({
    ...segment,
    order: index,
  })),
  updatedAt: new Date().toISOString(),
});


type PodcastGenerateDocument = {
  ownerId?: unknown;
  userId?: unknown;
  topic?: unknown;
  audience?: unknown;
  format?: unknown;
  language?: unknown;
  duration?: unknown;
  durationMinutes?: unknown;
  tone?: unknown;
  keywords?: unknown;
  avoid?: unknown;
  seriesId?: unknown;
  seriesTitle?: unknown;
  episodeNumber?: unknown;
  previousEpisodeSummary?: unknown;
};

const stringValue = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const keywordsValue = (value: unknown) => {
  if (Array.isArray(value)) {
    return value
      .filter((keyword): keyword is string => typeof keyword === "string")
      .map((keyword) => keyword.trim())
      .filter((keyword) => keyword.length > 0)
      .join(", ");
  }

  return stringValue(value);
};

const durationValue = (duration: unknown, durationMinutes: unknown) => {
  const durationText = stringValue(duration);

  if (durationText) {
    return durationText;
  }

  if (typeof durationMinutes === "number" && Number.isFinite(durationMinutes)) {
    return `${durationMinutes} minutes`;
  }

  return "5-7 minutes";
};
export default function ScriptEditorPage() {
  const router = useRouter();
  const params = useParams();
  const podcastId = getParam(params.podcastId);
  const { user, loading } = useAuth();
  const [podcastTitle, setPodcastTitle] = useState("Untitled podcast");
  const [script, setScript] = useState<PodcastScript | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [generating, setGenerating] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const initialGenerateRef = useRef(false);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, router, user]);

  const loadPodcast = useCallback(async () => {
    if (!user || !podcastId) {
      return;
    }

    setPageLoading(true);
    setError(null);

    try {
      const snapshot = await getDoc(doc(db, "podcasts", podcastId));

      if (!snapshot.exists()) {
        setError("Podcast not found.");
        return;
      }

      const data = snapshot.data() as { title?: unknown; script?: unknown; ownerId?: unknown; userId?: unknown };

      if (stringValue(data.ownerId || data.userId) !== user.uid) {
        setError("This podcast belongs to another account.");
        return;
      }

      const parsedScript = data.script
        ? podcastScriptSchema.safeParse(data.script)
        : null;
      const shell: PodcastShell = {
        title: typeof data.title === "string" ? data.title : "Untitled podcast",
        script: parsedScript?.success ? parsedScript.data : null,
      };

      setPodcastTitle(shell.title);
      setScript(shell.script);
      dirtyRef.current = false;
    } catch {
      setError("Could not load the script room.");
    } finally {
      setPageLoading(false);
    }
  }, [podcastId, user]);

  useEffect(() => {
    void loadPodcast();
  }, [loadPodcast]);

  const generateScript = useCallback(
    async (segmentId?: string) => {
      if (!user || !podcastId) {
        return;
      }

      setGenerating(segmentId ?? "full");
      setError(null);

      try {
        const podcastRef = doc(db, "podcasts", podcastId);
        const snapshot = await getDoc(podcastRef);

        if (!snapshot.exists()) {
          setError("Podcast not found.");
          return;
        }

        const podcast = snapshot.data() as PodcastGenerateDocument;
        const ownerId = stringValue(podcast.ownerId || podcast.userId);

        if (ownerId !== user.uid) {
          setError("This podcast belongs to another account.");
          return;
        }

        const topic = stringValue(podcast.topic);
        const audience = stringValue(podcast.audience);
        const format = stringValue(podcast.format);

        if (!topic || !audience || !format) {
          throw new Error("Podcast brief is missing topic, audience, or format.");
        }

        const token = await user.getIdToken();
        const episodeNumber =
          typeof podcast.episodeNumber === "number" && Number.isFinite(podcast.episodeNumber)
            ? podcast.episodeNumber
            : undefined;
        const seriesId = stringValue(podcast.seriesId);
        const seriesTitle = stringValue(podcast.seriesTitle);
        const previousEpisodeSummary = stringValue(podcast.previousEpisodeSummary);

        const response = await fetch("/api/scripts/generate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            podcastId,
            segmentId,
            existingScript: script ?? undefined,
            topic,
            audience,
            format,
            language: stringValue(podcast.language) || "en",
            duration: durationValue(podcast.duration, podcast.durationMinutes),
            tone: stringValue(podcast.tone) || "conversational",
            keywords: keywordsValue(podcast.keywords),
            avoid: stringValue(podcast.avoid),
            seriesId: seriesId || undefined,
            seriesTitle: seriesTitle || undefined,
            episodeNumber,
            previousEpisodeSummary: previousEpisodeSummary || undefined,
          }),
        });

        const payload: unknown = await response.json();

        if (!response.ok) {
          const message =
            typeof payload === "object" &&
            payload !== null &&
            "error" in payload &&
            typeof (payload as { error: unknown }).error === "string"
              ? (payload as { error: string }).error
              : "Script generation failed.";
          throw new Error(message);
        }

        const parsed = podcastScriptSchema.safeParse(
          typeof payload === "object" && payload !== null && "script" in payload
            ? (payload as { script: unknown }).script
            : payload
        );

        if (!parsed.success) {
          throw new Error("Generated script did not match the expected structure.");
        }

        const nextScript = podcastScriptSchema.parse({
          ...parsed.data,
          podcastId,
          updatedAt: new Date().toISOString(),
        });

        setSaveStatus("saving");
        await updateDoc(podcastRef, {
          script: nextScript,
          status: "script_ready",
          scriptVersion: increment(1),
          updatedAt: serverTimestamp(),
        });

        setScript(nextScript);
        dirtyRef.current = false;
        setSaveStatus("saved");
      } catch {
        setError("AI is busy, retrying usually works. You can try again with the same topic.");
        setSaveStatus("error");
      } finally {
        setGenerating(null);
      }
    },
    [podcastId, script, user]
  );
  useEffect(() => {
    if (!pageLoading && !script && !initialGenerateRef.current) {
      initialGenerateRef.current = true;
      void generateScript();
    }
  }, [generateScript, pageLoading, script]);

  useEffect(() => {
    if (!script || !dirtyRef.current || !podcastId) {
      return;
    }

    setSaveStatus("saving");

    const timeoutId = window.setTimeout(async () => {
      try {
        await updateDoc(doc(db, "podcasts", podcastId), {
          script,
          status: "script_ready",
          updatedAt: serverTimestamp(),
        });
        dirtyRef.current = false;
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
      }
    }, 1500);

    return () => window.clearTimeout(timeoutId);
  }, [podcastId, script]);

  const markScript = (updater: (current: PodcastScript) => PodcastScript) => {
    setScript((current) => {
      if (!current) {
        return current;
      }

      dirtyRef.current = true;
      return normalizeScript(updater(current));
    });
  };

  const updateTurnText = (segmentId: string, turnId: string, text: string) => {
    markScript((current) => ({
      ...current,
      segments: current.segments.map((segment) =>
        segment.id === segmentId
          ? {
              ...segment,
              turns: segment.turns.map((turn) =>
                turn.id === turnId ? { ...turn, text } : turn
              ),
            }
          : segment
      ),
    }));
  };

  const deleteTurn = (segmentId: string, turnId: string) => {
    markScript((current) => ({
      ...current,
      segments: current.segments.map((segment) =>
        segment.id === segmentId
          ? {
              ...segment,
              turns: segment.turns.filter((turn) => turn.id !== turnId),
            }
          : segment
      ),
    }));
  };

  const addTurn = (segmentId: string, turnId: string, placement: "above" | "below") => {
    markScript((current) => ({
      ...current,
      segments: current.segments.map((segment) => {
        if (segment.id !== segmentId) {
          return segment;
        }

        const index = segment.turns.findIndex((turn) => turn.id === turnId);
        const anchor = segment.turns[index];
        const nextSpeaker: ScriptSpeakerId = anchor?.speakerId === "host" ? "guest" : "host";
        const insertionIndex = placement === "above" ? index : index + 1;
        const turns = [...segment.turns];
        turns.splice(Math.max(insertionIndex, 0), 0, createBlankTurn(nextSpeaker));

        return { ...segment, turns };
      }),
    }));
  };

  const moveTurn = (segmentId: string, turnId: string, direction: -1 | 1) => {
    markScript((current) => ({
      ...current,
      segments: current.segments.map((segment) => {
        if (segment.id !== segmentId) {
          return segment;
        }

        const index = segment.turns.findIndex((turn) => turn.id === turnId);
        const nextIndex = index + direction;

        if (index < 0 || nextIndex < 0 || nextIndex >= segment.turns.length) {
          return segment;
        }

        const turns = [...segment.turns];
        const [turn] = turns.splice(index, 1);
        turns.splice(nextIndex, 0, turn);
        return { ...segment, turns };
      }),
    }));
  };

  const totalTurns = useMemo(
    () => script?.segments.reduce((count, segment) => count + segment.turns.length, 0) ?? 0,
    [script]
  );

  if (loading || pageLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <div className="flex items-center gap-3 text-sm text-gray-400">
          <Loader2 className="size-4 animate-spin text-amber-200" />
          Preparing the script room...
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
              Script room
            </p>
            <div>
              <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">{podcastTitle}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-400">
                {totalTurns} editable turns across {script?.segments.length ?? 0} segments.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <AutosaveIndicator status={saveStatus} />
            <Button
              type="button"
              onClick={() => void generateScript()}
              disabled={Boolean(generating)}
              className="h-11 rounded-[8px] border-white/10 bg-white/5 px-4 text-sm text-white hover:bg-white/10"
              variant="outline"
            >
              {generating === "full" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
              Regenerate full script
            </Button>
            <Button asChild className="h-11 rounded-[8px] bg-amber-300 px-4 text-sm font-semibold text-gray-950 hover:bg-amber-200">
              <Link href={`/dashboard/podcasts/${podcastId}/voice`}>
                Next: Voices
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </motion.header>

        {error ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
            <span>{error}</span>
            <Button
              type="button"
              size="sm"
              onClick={() => void generateScript()}
              disabled={Boolean(generating)}
              className="rounded-[8px] bg-amber-200 text-gray-950 hover:bg-amber-100"
            >
              {generating === "full" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
              Try again
            </Button>
          </div>
        ) : null}

        {!script ? (
          <Card className="rounded-[8px] border border-white/10 bg-white/[0.04] text-white">
            <CardContent className="flex min-h-80 flex-col items-center justify-center gap-4 p-8 text-center">
              <Loader2 className="size-8 animate-spin text-amber-200" />
              <p className="text-sm text-gray-400">Generating the first draft...</p>
            </CardContent>
          </Card>
        ) : (
          <motion.div
            initial="hidden"
            animate="show"
            variants={{ hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08 } } }}
            className="space-y-4"
          >
            <AnimatePresence initial={false}>
              {script.segments
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((segment) => (
                  <SegmentEditor
                    key={segment.id}
                    segment={segment}
                    generating={generating === segment.id}
                    onRegenerate={() => void generateScript(segment.id)}
                    onDeleteTurn={deleteTurn}
                    onAddTurn={addTurn}
                    onMoveTurn={moveTurn}
                    onUpdateTurnText={updateTurnText}
                  />
                ))}
            </AnimatePresence>
          </motion.div>
        )}
      </section>
    </main>
  );
}

interface SegmentEditorProps {
  segment: ScriptSegment;
  generating: boolean;
  onRegenerate: () => void;
  onDeleteTurn: (segmentId: string, turnId: string) => void;
  onAddTurn: (segmentId: string, turnId: string, placement: "above" | "below") => void;
  onMoveTurn: (segmentId: string, turnId: string, direction: -1 | 1) => void;
  onUpdateTurnText: (segmentId: string, turnId: string, text: string) => void;
}

function SegmentEditor({
  segment,
  generating,
  onRegenerate,
  onDeleteTurn,
  onAddTurn,
  onMoveTurn,
  onUpdateTurnText,
}: SegmentEditorProps) {
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      className="rounded-[8px] border border-white/10 bg-white/[0.035] ring-1 ring-white/5"
    >
      <Card className="rounded-[8px] border-0 bg-transparent py-0 text-white ring-0">
        <CardHeader className="flex flex-col gap-3 border-b border-white/10 px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="text-xl text-white">{segment.title}</CardTitle>
            <CardDescription className="mt-2 text-sm text-gray-400">
              {segment.summary || "Segment notes will live here."}
            </CardDescription>
          </div>
          <Button
            type="button"
            onClick={onRegenerate}
            disabled={generating}
            className="h-10 rounded-[8px] border-white/10 bg-white/5 text-sm text-white hover:bg-white/10"
            variant="outline"
          >
            {generating ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
            Regenerate segment
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 p-5">
          {segment.turns.map((turn, index) => (
            <motion.div
              layout
              key={turn.id}
              className="rounded-[8px] border border-white/10 bg-gray-950/60 p-4"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <Badge className={cn("rounded-[8px] border", speakerBadgeClass[turn.speakerId])} variant="outline">
                  {turn.speakerId.toUpperCase()}
                </Badge>
                <div className="flex flex-wrap gap-2">
                  <ToolbarButton label="Add above" onClick={() => onAddTurn(segment.id, turn.id, "above")}>
                    <Plus className="size-3.5" />
                    Above
                  </ToolbarButton>
                  <ToolbarButton label="Add below" onClick={() => onAddTurn(segment.id, turn.id, "below")}>
                    <Plus className="size-3.5" />
                    Below
                  </ToolbarButton>
                  <ToolbarButton label="Edit" onClick={() => document.getElementById(`turn-${turn.id}`)?.focus()}>
                    <Pencil className="size-3.5" />
                  </ToolbarButton>
                  <ToolbarButton label="Move up" disabled={index === 0} onClick={() => onMoveTurn(segment.id, turn.id, -1)}>
                    <ArrowUp className="size-3.5" />
                  </ToolbarButton>
                  <ToolbarButton
                    label="Move down"
                    disabled={index === segment.turns.length - 1}
                    onClick={() => onMoveTurn(segment.id, turn.id, 1)}
                  >
                    <ArrowDown className="size-3.5" />
                  </ToolbarButton>
                  <ToolbarButton label="Delete" onClick={() => onDeleteTurn(segment.id, turn.id)}>
                    <Trash2 className="size-3.5" />
                  </ToolbarButton>
                </div>
              </div>
              <Textarea
                id={`turn-${turn.id}`}
                value={turn.text}
                onChange={(event) => onUpdateTurnText(segment.id, turn.id, event.target.value)}
                className="min-h-28 rounded-[8px] border-white/10 bg-white/5 text-sm leading-6 text-white focus-visible:border-amber-300/70"
              />
            </motion.div>
          ))}
        </CardContent>
      </Card>
    </motion.article>
  );
}

function ToolbarButton({
  children,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={disabled}
      aria-label={label}
      onClick={onClick}
      className="h-8 rounded-[8px] border-white/10 bg-white/5 px-2 text-xs text-gray-200 hover:bg-white/10"
    >
      {children}
    </Button>
  );
}



