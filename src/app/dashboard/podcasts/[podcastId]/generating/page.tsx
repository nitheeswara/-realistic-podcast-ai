"use client";

import { doc, getDoc, onSnapshot, updateDoc } from "firebase/firestore";
import { motion } from "framer-motion";
import { ArrowRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { GenerationJobTracker } from "@/components/generation-progress/GenerationJobTracker";
import { Button } from "@/components/ui/button";
import { db } from "@/config/firebase-client";
import { useAuth } from "@/hooks/useAuth";
import { generationJobSchema } from "@/lib/podcast/schemas";
import type { GenerationJob, JobStage } from "@/types/jobs";

const getParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

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
        setMessage("We could not open this render from your account.");
        return;
      }

      if (typeof data?.currentJobId === "string") {
        setJobId(data.currentJobId);
      } else {
        setMessage("No active render is running yet. You can start again from studio settings.");
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
          setMessage("We could not find this render job. Please retry from studio settings.");
          return;
        }

        const parsed = generationJobSchema.safeParse({ id: snapshot.id, ...snapshot.data() });

        if (!parsed.success) {
          setMessage("The render update is taking longer than expected. AI is busy, retrying...");
          return;
        }

        setJob(parsed.data);
      },
      () => setMessage("Live progress paused for a moment. AI is busy, retrying...")
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
      setMessage("Could not cancel just now. Please try again in a moment.");
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
      setMessage("AI is busy, retrying may work in a moment.");
    } finally {
      setBusyAction(null);
    }
  };

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

        <GenerationJobTracker
          busyAction={busyAction}
          job={job}
          message={message}
          onCancel={() => void cancelJob()}
          onRetry={(stage) => void retryJob(stage)}
        />
      </section>
    </main>
  );
}

