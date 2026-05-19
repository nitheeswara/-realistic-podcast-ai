"use client";

import { collection, getDocs, query, where } from "firebase/firestore";
import { motion } from "framer-motion";
import type { Variants } from "framer-motion";
import {
  ArrowLeft,
  AudioLines,
  Calendar,
  ExternalLink,
  Loader2,
  Mic2,
  Trash2,
  Wand2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { db } from "@/config/firebase-client";
import { useAuth } from "@/hooks/useAuth";
import { cloneListResponseSchema } from "@/lib/podcast/schemas";
import { cn } from "@/lib/utils";
import type { CloningConfig } from "@/types/cloning";

interface PodcastOption {
  id: string;
  title: string;
  topic: string;
  status: string;
  updatedAt?: string;
}

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.38, ease: "easeOut" },
  },
};

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

const formatDate = (value?: string) => {
  if (!value) {
    return "Just now";
  }

  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return "Just now";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(timestamp));
};

const titleFromData = (data: Record<string, unknown>, fallback: string) =>
  typeof data.title === "string" && data.title.trim().length > 0
    ? data.title.trim()
    : fallback;

const stringFromData = (data: Record<string, unknown>, key: string, fallback: string) =>
  typeof data[key] === "string" && data[key].trim().length > 0
    ? data[key].trim()
    : fallback;

export default function ClonesPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [clones, setClones] = useState<CloningConfig[]>([]);
  const [clonesLoading, setClonesLoading] = useState(true);
  const [clonesError, setClonesError] = useState<string | null>(null);
  const [selectedClone, setSelectedClone] = useState<CloningConfig | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [podcasts, setPodcasts] = useState<PodcastOption[]>([]);
  const [podcastsLoaded, setPodcastsLoaded] = useState(false);
  const [podcastsLoading, setPodcastsLoading] = useState(false);
  const [deletingCloneId, setDeletingCloneId] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, router, user]);

  const loadClones = useCallback(async () => {
    if (!user) {
      return;
    }

    setClonesLoading(true);
    setClonesError(null);

    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/cloning/list", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "Clone library unavailable."));
      }

      const payload: unknown = await response.json();
      const parsed = cloneListResponseSchema.safeParse(payload);

      if (!parsed.success) {
        throw new Error("Clone library returned an unexpected response.");
      }

      setClones(parsed.data.clones.filter((clone) => clone.type === "voice"));
    } catch (error) {
      setClonesError(error instanceof Error ? error.message : "Clone library unavailable.");
    } finally {
      setClonesLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadClones();
  }, [loadClones]);

  const loadPodcasts = useCallback(async () => {
    if (!user || podcastsLoaded) {
      return;
    }

    setPodcastsLoading(true);

    try {
      const podcastsQuery = query(
        collection(db, "podcasts"),
        where("ownerId", "==", user.uid)
      );
      const snapshot = await getDocs(podcastsQuery);
      const nextPodcasts = snapshot.docs
        .map((documentSnapshot): PodcastOption => {
          const data = documentSnapshot.data() as Record<string, unknown>;

          return {
            id: documentSnapshot.id,
            title: titleFromData(data, "Untitled podcast"),
            topic: stringFromData(data, "topic", "No topic saved"),
            status: stringFromData(data, "status", "draft"),
            updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : undefined,
          };
        })
        .sort((first, second) => (second.updatedAt ?? "").localeCompare(first.updatedAt ?? ""));

      setPodcasts(nextPodcasts);
      setPodcastsLoaded(true);
    } catch {
      setPodcasts([]);
      setPodcastsLoaded(true);
    } finally {
      setPodcastsLoading(false);
    }
  }, [podcastsLoaded, user]);

  useEffect(() => {
    if (selectorOpen) {
      void loadPodcasts();
    }
  }, [loadPodcasts, selectorOpen]);

  const handleDelete = async (clone: CloningConfig) => {
    if (!user) {
      return;
    }

    setDeletingCloneId(clone.id);
    setClonesError(null);

    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/cloning/list?cloneId=${encodeURIComponent(clone.id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "Clone delete failed."));
      }

      setClones((current) => current.filter((item) => item.id !== clone.id));
      setSelectedClone((current) => (current?.id === clone.id ? null : current));
    } catch (error) {
      setClonesError(error instanceof Error ? error.message : "Clone delete failed.");
    } finally {
      setDeletingCloneId(null);
    }
  };

  const groupedCounts = useMemo(
    () => ({
      voices: clones.filter((clone) => clone.type === "voice").length,
    }),
    [clones]
  );

  if (loading || (!user && !loading)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <p className="text-sm text-gray-400">Checking studio access...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 px-4 py-8 text-white sm:px-6 lg:px-8">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-7">
        <motion.header
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col gap-5 border-b border-white/10 pb-6 lg:flex-row lg:items-end lg:justify-between"
        >
          <div className="space-y-3">
            <Button
              asChild
              variant="outline"
              className="h-9 w-fit rounded-[8px] border-white/10 bg-white/5 px-3 text-xs text-white hover:bg-white/10"
            >
              <Link href="/dashboard">
                <ArrowLeft className="size-3.5" />
                Dashboard
              </Link>
            </Button>
            <div className="flex w-fit items-center gap-2 rounded-[8px] border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">
              <Wand2 className="size-3.5" />
              Clone library
            </div>
            <div>
              <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Your cloned assets</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-400">
                Keep approved voices ready for any episode cast.
              </p>
            </div>
          </div>
          <div className="grid gap-3">
            <MetricPill icon={Mic2} label="Voice clones" value={groupedCounts.voices} />
          </div>
        </motion.header>

        {clonesError ? (
          <p className="rounded-[8px] border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
            {clonesError}
          </p>
        ) : null}

        {clonesLoading ? (
          <div className="flex min-h-72 items-center justify-center rounded-[8px] border border-white/10 bg-white/[0.03] text-sm text-gray-400">
            <Loader2 className="mr-2 size-4 animate-spin text-amber-200" />
            Loading clone library...
          </div>
        ) : clones.length === 0 ? (
          <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="rounded-[8px] border border-white/10 bg-white/[0.04] text-white ring-1 ring-white/5">
              <CardContent className="flex min-h-80 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
                <div className="flex size-14 items-center justify-center rounded-[8px] border border-white/10 bg-gray-900 text-amber-200">
                  <AudioLines className="size-7" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-2xl font-semibold text-white">No clones yet</h2>
                  <p className="max-w-md text-sm leading-6 text-gray-400">
                    Add a cloned voice from a podcast voice screen, then reuse it here.
                  </p>
                </div>
                <Button asChild className="mt-2 h-11 rounded-[8px] bg-amber-300 px-5 text-sm font-semibold text-gray-950 hover:bg-amber-200">
                  <Link href="/dashboard/create">Create Podcast</Link>
                </Button>
              </CardContent>
            </Card>
          </motion.section>
        ) : (
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
          >
            {clones.map((clone) => (
              <CloneCard
                key={clone.id}
                clone={clone}
                deleting={deletingCloneId === clone.id}
                onDelete={() => void handleDelete(clone)}
                onUse={() => {
                  setSelectedClone(clone);
                  setSelectorOpen(true);
                }}
              />
            ))}
          </motion.div>
        )}
      </section>

      <Dialog open={selectorOpen} onOpenChange={setSelectorOpen}>
        <DialogContent className="rounded-[8px] border border-white/10 bg-gray-950 p-0 text-white sm:max-w-xl">
          <DialogHeader className="border-b border-white/10 px-5 py-4">
            <DialogTitle className="text-lg text-white">Use this clone</DialogTitle>
            <DialogDescription className="text-sm text-gray-400">
              Pick an episode and finish the host or guest assignment in voice selection.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-5 pb-5">
            {selectedClone ? (
              <div className="rounded-[8px] border border-white/10 bg-white/[0.04] p-3">
                <p className="text-sm font-semibold text-white">{selectedClone.name}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.16em] text-gray-500">
                  {selectedClone.provider} / {selectedClone.type}
                </p>
              </div>
            ) : null}

            {podcastsLoading ? (
              <p className="flex items-center gap-2 rounded-[8px] border border-white/10 bg-white/[0.04] px-3 py-4 text-sm text-gray-400">
                <Loader2 className="size-4 animate-spin text-amber-200" />
                Loading podcasts...
              </p>
            ) : podcasts.length === 0 ? (
              <div className="rounded-[8px] border border-white/10 bg-white/[0.04] px-3 py-4 text-sm text-gray-400">
                No podcasts are ready for assignment.
              </div>
            ) : (
              <div className="space-y-2">
                {podcasts.map((podcast) => (
                  <div
                    key={podcast.id}
                    className="flex flex-col gap-3 rounded-[8px] border border-white/10 bg-white/[0.04] p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-semibold text-white">{podcast.title}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-400">{podcast.topic}</p>
                      <p className="mt-2 text-xs uppercase tracking-[0.16em] text-gray-500">{podcast.status}</p>
                    </div>
                    <Button
                      asChild
                      className="h-9 rounded-[8px] bg-amber-300 px-3 text-xs font-semibold text-gray-950 hover:bg-amber-200"
                    >
                      <Link href={`/dashboard/podcasts/${podcast.id}/voice`}>
                        Open voices
                        <ExternalLink className="size-3.5" />
                      </Link>
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function MetricPill({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-[8px] border border-white/10 bg-white/[0.04] px-4 py-3 ring-1 ring-white/5">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-[8px] border border-amber-300/20 bg-amber-300/10 text-amber-200">
          <Icon className="size-4" />
        </div>
        <div>
          <p className="text-2xl font-semibold text-white">{value}</p>
          <p className="text-xs uppercase tracking-[0.16em] text-gray-500">{label}</p>
        </div>
      </div>
    </div>
  );
}

function CloneCard({
  clone,
  deleting,
  onDelete,
  onUse,
}: {
  clone: CloningConfig;
  deleting: boolean;
  onDelete: () => void;
  onUse: () => void;
}) {
  const Icon = Mic2;
  const previewImage = clone.previewImageUrl;
  const previewAudio = clone.previewUrl;

  return (
    <motion.article variants={cardVariants} whileHover={{ y: -3 }}>
      <Card className="h-full overflow-hidden rounded-[8px] border border-white/10 bg-white/[0.04] text-white ring-1 ring-white/5">
        <div className="relative flex h-44 items-center justify-center bg-gray-900">
          {previewImage ? (
            <Image
              src={previewImage}
              alt={clone.name}
              width={520}
              height={300}
              unoptimized
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex size-16 items-center justify-center rounded-[8px] border border-amber-300/20 bg-amber-300/10 text-amber-200">
              <Icon className="size-8" />
            </div>
          )}
          <Badge
            variant="outline"
            className={cn(
              "absolute left-3 top-3 rounded-[8px] border text-xs capitalize",
              clone.status === "ready"
                ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100"
                : "border-amber-300/30 bg-amber-300/10 text-amber-100"
            )}
          >
            {clone.status}
          </Badge>
        </div>
        <CardHeader className="gap-3">
          <div>
            <CardTitle className="line-clamp-1 text-xl text-white">{clone.name}</CardTitle>
            <CardDescription className="mt-2 flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-gray-500">
              <Icon className="size-3.5" />
              {clone.provider} / {clone.type}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {clone.speaker ? (
              <Badge variant="outline" className="rounded-[8px] border-white/10 bg-white/5 text-gray-200">
                {clone.speaker}
              </Badge>
            ) : null}
            {clone.trainingStatus ? (
              <Badge variant="outline" className="rounded-[8px] border-white/10 bg-white/5 text-gray-200">
                training {clone.trainingStatus}
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {previewAudio ? <audio controls src={previewAudio} className="h-9 w-full" /> : null}
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Calendar className="size-3.5" />
            {formatDate(clone.createdAt)}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              onClick={onUse}
              className="h-10 rounded-[8px] bg-amber-300 text-sm font-semibold text-gray-950 hover:bg-amber-200"
            >
              Use in podcast
            </Button>
            <Button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              variant="outline"
              className="h-10 rounded-[8px] border-white/10 bg-white/5 text-sm text-white hover:bg-white/10"
            >
              {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Delete
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.article>
  );
}
