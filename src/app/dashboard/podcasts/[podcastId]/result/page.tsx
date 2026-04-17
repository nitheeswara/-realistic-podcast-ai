"use client";

import { doc, getDoc } from "firebase/firestore";
import { getDownloadURL, ref } from "firebase/storage";
import { motion } from "framer-motion";
import { Calendar, Copy, Download, Loader2, RefreshCcw, Settings } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { db, storage } from "@/config/firebase-client";
import { useAuth } from "@/hooks/useAuth";
import { generationJobSchema } from "@/lib/podcast/schemas";
import type { GenerationJob } from "@/types/jobs";

const getParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

interface ResultPodcast {
  title: string;
  language: string;
  durationMinutes?: number;
  createdAt?: unknown;
  currentJobId?: string;
  ownerId?: string;
}

const formatDuration = (seconds?: number, minutes?: number) => {
  if (typeof seconds === "number") {
    const rounded = Math.max(1, Math.round(seconds));
    const mins = Math.floor(rounded / 60);
    const secs = rounded % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  return minutes ? `${minutes} min` : "Pending";
};

const formatDate = (value: unknown) => {
  if (typeof value === "object" && value !== null && "toDate" in value) {
    const date = (value as { toDate: () => Date }).toDate();
    return date.toLocaleDateString();
  }

  if (typeof value === "string") {
    return new Date(value).toLocaleDateString();
  }

  return new Date().toLocaleDateString();
};

export default function ResultPage() {
  const params = useParams();
  const router = useRouter();
  const podcastId = getParam(params.podcastId);
  const { user, loading } = useAuth();
  const [podcast, setPodcast] = useState<ResultPodcast | null>(null);
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

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
          setMessage("Podcast not found.");
          return;
        }

        const podcastData = podcastSnapshot.data() as ResultPodcast;

        if (podcastData.ownerId !== user.uid) {
          setMessage("This podcast belongs to another account.");
          return;
        }

        setPodcast({
          title: typeof podcastData.title === "string" ? podcastData.title : "Untitled podcast",
          language: typeof podcastData.language === "string" ? podcastData.language : "unknown",
          durationMinutes:
            typeof podcastData.durationMinutes === "number" ? podcastData.durationMinutes : undefined,
          createdAt: podcastData.createdAt,
          currentJobId:
            typeof podcastData.currentJobId === "string" ? podcastData.currentJobId : undefined,
          ownerId: podcastData.ownerId,
        });

        if (!podcastData.currentJobId) {
          setMessage("No completed generation job found.");
          return;
        }

        const jobSnapshot = await getDoc(doc(db, "jobs", podcastData.currentJobId));
        const parsedJob = jobSnapshot.exists()
          ? generationJobSchema.safeParse({ id: jobSnapshot.id, ...jobSnapshot.data() })
          : null;

        if (parsedJob?.success) {
          setJob(parsedJob.data);

          if (parsedJob.data.outputUrl) {
            setVideoUrl(parsedJob.data.outputUrl);
          } else if (parsedJob.data.outputStoragePath) {
            setVideoUrl(await getDownloadURL(ref(storage, parsedJob.data.outputStoragePath)));
          }
        }
      } catch {
        setMessage("Could not load the result.");
      } finally {
        setPageLoading(false);
      }
    };

    void loadResult();
  }, [podcastId, user]);

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined" || !podcastId) {
      return "";
    }

    return `${window.location.origin}/dashboard/podcasts/${podcastId}/result`;
  }, [podcastId]);

  const copyShareLink = async () => {
    if (!shareUrl) {
      return;
    }

    await navigator.clipboard.writeText(shareUrl);
    setMessage("Share link copied.");
  };

  const regenerateVideo = async () => {
    if (!user || !podcastId) {
      return;
    }

    setGenerating(true);
    setMessage(null);

    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/video/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ podcastId, retryJobId: job?.id }),
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error("Could not start regeneration.");
      }

      const nextJobId =
        typeof payload === "object" &&
        payload !== null &&
        "jobId" in payload &&
        typeof (payload as { jobId: unknown }).jobId === "string"
          ? (payload as { jobId: string }).jobId
          : null;

      if (nextJobId) {
        router.push(`/dashboard/podcasts/${podcastId}/generating?jobId=${nextJobId}`);
      }
    } catch {
      setMessage("Could not regenerate the video.");
    } finally {
      setGenerating(false);
    }
  };

  if (loading || pageLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <div className="flex items-center gap-3 text-sm text-gray-400">
          <Loader2 className="size-4 animate-spin text-amber-200" />
          Loading final cut...
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
          className="flex flex-col gap-5 border-b border-white/10 pb-6 md:flex-row md:items-end md:justify-between"
        >
          <div className="space-y-3">
            <p className="w-fit rounded-[8px] border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">
              Final cut
            </p>
            <div>
              <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
                {podcast?.title ?? "Podcast result"}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-400">
                Review, download, share, or regenerate the render.
              </p>
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
              Copy share link
            </Button>
            {videoUrl ? (
              <Button asChild className="h-11 rounded-[8px] bg-amber-300 px-5 text-sm font-semibold text-gray-950 hover:bg-amber-200">
                <a href={videoUrl} download>
                  <Download className="size-4" />
                  Download
                </a>
              </Button>
            ) : null}
          </div>
        </motion.header>

        {message ? (
          <p className="rounded-[8px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-200">
            {message}
          </p>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[1.4fr_0.6fr]">
          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="overflow-hidden rounded-[8px] border border-white/10 bg-black py-0 text-white ring-1 ring-white/5">
              <div className="border-b border-white/10 bg-white/5 px-4 py-3 text-xs uppercase tracking-[0.18em] text-gray-400">
                Preview monitor
              </div>
              <div className="bg-black p-3">
                <video
                  controls
                  poster={job?.posterUrl}
                  src={videoUrl ?? undefined}
                  className="aspect-video w-full rounded-[8px] bg-gray-900 object-contain"
                />
              </div>
            </Card>
          </motion.div>

          <div className="space-y-4">
            <Card className="rounded-[8px] border border-white/10 bg-white/[0.04] text-white ring-1 ring-white/5">
              <CardHeader>
                <CardTitle className="text-2xl text-white">Metadata</CardTitle>
                <CardDescription className="text-sm text-gray-400">
                  Production details for this render.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-gray-300">
                <MetaRow label="Duration" value={formatDuration(job?.durationSeconds, podcast?.durationMinutes)} />
                <MetaRow label="Language" value={podcast?.language ?? "unknown"} />
                <MetaRow label="Date" value={formatDate(podcast?.createdAt)} icon={<Calendar className="size-4" />} />
                <MetaRow label="Status" value={job?.status ?? "unknown"} />
              </CardContent>
            </Card>

            <Card className="rounded-[8px] border border-white/10 bg-white/[0.04] text-white ring-1 ring-white/5">
              <CardHeader>
                <CardTitle className="text-2xl text-white">Regenerate</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  type="button"
                  onClick={regenerateVideo}
                  disabled={generating}
                  className="h-11 w-full rounded-[8px] bg-amber-300 text-sm font-semibold text-gray-950 hover:bg-amber-200"
                >
                  {generating ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
                  Regenerate video
                </Button>
                <Button asChild variant="outline" className="h-11 w-full rounded-[8px] border-white/10 bg-white/5 text-sm text-white hover:bg-white/10">
                  <Link href={`/dashboard/podcasts/${podcastId}/studio`}>
                    <Settings className="size-4" />
                    Change studio settings
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
    </main>
  );
}

function MetaRow({
  icon,
  label,
  value,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[8px] border border-white/10 bg-gray-950/60 px-3 py-2">
      <span className="flex items-center gap-2 text-gray-500">
        {icon}
        {label}
      </span>
      <span className="text-right font-medium capitalize text-white">{value}</span>
    </div>
  );
}

