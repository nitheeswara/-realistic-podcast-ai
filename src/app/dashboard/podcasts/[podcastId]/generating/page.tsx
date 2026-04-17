"use client";

import { doc, getDoc, onSnapshot, updateDoc } from "firebase/firestore";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Loader2, RefreshCcw, SquareX } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/config/firebase-client";
import { useAuth } from "@/hooks/useAuth";
import { jobStages } from "@/lib/podcast/constants";
import { generationJobSchema } from "@/lib/podcast/schemas";
import { cn } from "@/lib/utils";
import type { GenerationJob, JobStage, StageProgress } from "@/types/jobs";

const getParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const stageLabels: Record<JobStage, string> = {
  audio: "Audio synthesis",
  lipsync: "Lip sync",
  movement: "Movement pass",
  compose: "Compose",
  export: "Export",
};

const fallbackProgress: StageProgress = {
  status: "queued",
  progress: 0,
};

export default function GeneratingPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const podcastId = getParam(params.podcastId);
  const requestedJobId = searchParams.get("jobId");
  const { user, loading } = useAuth();
  const [jobId, setJobId] = useState<string | null>(requestedJobId);
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, router, user]);

  useEffect(() => {
    const loadCurrentJob = async () => {
      if (requestedJobId || !podcastId || !user) {
        return;
      }

      const snapshot = await getDoc(doc(db, "podcasts", podcastId));
      const data = snapshot.exists()
        ? (snapshot.data() as { ownerId?: unknown; currentJobId?: unknown })
        : null;

      if (data?.ownerId !== user.uid) {
        setMessage("This podcast belongs to another account.");
        return;
      }

      if (typeof data?.currentJobId === "string") {
        setJobId(data.currentJobId);
      } else {
        setMessage("No active generation job found.");
      }
    };

    void loadCurrentJob();
  }, [podcastId, requestedJobId, user]);

  useEffect(() => {
    if (!jobId) {
      return;
    }

    const unsubscribe = onSnapshot(
      doc(db, "jobs", jobId),
      (snapshot) => {
        if (!snapshot.exists()) {
          setMessage("Generation job not found.");
          return;
        }

        const parsed = generationJobSchema.safeParse({ id: snapshot.id, ...snapshot.data() });

        if (!parsed.success) {
          setMessage("Generation job data is incomplete.");
          return;
        }

        setJob(parsed.data);
      },
      () => setMessage("Could not subscribe to generation progress.")
    );

    return unsubscribe;
  }, [jobId]);

  const cancelJob = async () => {
    if (!jobId) {
      return;
    }

    setBusyAction("cancel");

    try {
      await updateDoc(doc(db, "jobs", jobId), {
        status: "canceled",
        updatedAt: new Date().toISOString(),
      });
    } catch {
      setMessage("Could not cancel the job.");
    } finally {
      setBusyAction(null);
    }
  };

  const retryJob = async (stage?: JobStage) => {
    if (!user || !podcastId || !jobId) {
      return;
    }

    setBusyAction(stage ?? "retry");

    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/video/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ podcastId, retryJobId: jobId }),
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error("Retry failed.");
      }

      const nextJobId =
        typeof payload === "object" &&
        payload !== null &&
        "jobId" in payload &&
        typeof (payload as { jobId: unknown }).jobId === "string"
          ? (payload as { jobId: string }).jobId
          : null;

      if (nextJobId) {
        setJobId(nextJobId);
        router.replace(`/dashboard/podcasts/${podcastId}/generating?jobId=${nextJobId}`);
      }
    } catch {
      setMessage("Could not retry generation.");
    } finally {
      setBusyAction(null);
    }
  };

  const activeStage = job?.stage;
  const completed = job?.status === "completed";

  const statusCopy = useMemo(() => {
    if (!job) {
      return "Connecting to the render job...";
    }

    if (job.status === "failed") {
      return "The render needs attention.";
    }

    if (job.status === "canceled") {
      return "Generation was canceled.";
    }

    if (job.status === "completed") {
      return "Your video is ready.";
    }

    return `${Math.round(job.progress)}% complete`;
  }, [job]);

  if (loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <Loader2 className="size-5 animate-spin text-amber-200" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 px-4 py-8 text-white sm:px-6 lg:px-8">
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <motion.header
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col gap-5 border-b border-white/10 pb-6 md:flex-row md:items-end md:justify-between"
        >
          <div className="space-y-3">
            <p className="w-fit rounded-[8px] border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">
              Rendering
            </p>
            <div>
              <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
                Generating video
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-400">
                {statusCopy}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={!job || job.status === "completed" || busyAction === "cancel"}
              onClick={cancelJob}
              className="h-11 rounded-[8px] border-white/10 bg-white/5 text-sm text-white hover:bg-white/10"
            >
              {busyAction === "cancel" ? <Loader2 className="size-4 animate-spin" /> : <SquareX className="size-4" />}
              Cancel
            </Button>
            {completed ? (
              <Button asChild className="h-11 rounded-[8px] bg-amber-300 px-5 text-sm font-semibold text-gray-950 hover:bg-amber-200">
                <Link href={`/dashboard/podcasts/${podcastId}/result`}>
                  View Result
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            ) : null}
          </div>
        </motion.header>

        {message ? (
          <p className="rounded-[8px] border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {message}
          </p>
        ) : null}

        <Card className="rounded-[8px] border border-white/10 bg-white/[0.04] text-white ring-1 ring-white/5">
          <CardHeader>
            <CardTitle className="text-2xl text-white">Pipeline stages</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {jobStages.map((stage) => {
              const stageProgress = job?.stages[stage] ?? fallbackProgress;
              const active = activeStage === stage && job?.status === "running";
              const failed = stageProgress.status === "failed";

              return (
                <motion.div
                  key={stage}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "rounded-[8px] border p-4",
                    active ? "border-amber-300/40 bg-amber-300/10" : "border-white/10 bg-gray-950/50",
                    failed && "border-red-300/40 bg-red-500/10"
                  )}
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-white">{stageLabels[stage]}</p>
                      <p className="mt-1 text-xs capitalize text-gray-400">{stageProgress.status}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      {active ? <span className="size-2 animate-pulse rounded-full bg-amber-300" /> : null}
                      <span className="text-sm text-gray-300">{Math.round(stageProgress.progress)}%</span>
                    </div>
                  </div>
                  <div className="h-2 overflow-hidden rounded-[8px] bg-white/10">
                    <motion.div
                      className={cn("h-full rounded-[8px]", failed ? "bg-red-300" : "bg-amber-300")}
                      initial={false}
                      animate={{ width: `${stageProgress.progress}%` }}
                      transition={{ duration: 0.45, ease: "easeOut" }}
                    />
                  </div>
                  {stageProgress.errorMessage ? (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-red-300/20 bg-red-500/10 p-3 text-sm text-red-100">
                      <span className="flex items-center gap-2">
                        <AlertTriangle className="size-4" />
                        {stageProgress.errorMessage}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void retryJob(stage)}
                        disabled={Boolean(busyAction)}
                        className="rounded-[8px] bg-red-200 text-gray-950 hover:bg-red-100"
                      >
                        {busyAction === stage ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
                        Retry
                      </Button>
                    </div>
                  ) : null}
                </motion.div>
              );
            })}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

