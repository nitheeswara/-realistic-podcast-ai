"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCcw,
  SquareX,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { jobStages } from "@/lib/podcast/constants";
import { cn } from "@/lib/utils";
import type { GenerationJob, JobStage, StageProgress } from "@/types/jobs";

const stageLabels: Record<JobStage, string> = {
  script: "Script Ready",
  audio: "Generating Dialogue",
  merge: "Merging Podcast",
  export: "Exporting MP3",
};

const stageDescriptions: Record<JobStage, string> = {
  script: "The host and guest turns are locked for this run.",
  audio: "Text-to-speech is creating each spoken turn.",
  merge: "Host and guest clips are being stitched into one MP3.",
  export: "The final Cloudinary download link is being prepared.",
};

const fallbackProgress: StageProgress = {
  status: "queued",
  progress: 0,
};

const friendlyError =
  "AI is busy right now. Retry will keep your same topic, script, and voices.";

const formatEta = (job: GenerationJob | null) => {
  if (!job || job.status === "completed") {
    return "Ready when the final export lands.";
  }

  if (job.status === "failed") {
    return "Paused until you retry.";
  }

  if (!job.startedAt || job.progress <= 3) {
    return "Estimating time remaining...";
  }

  const started = new Date(job.startedAt).getTime();
  const elapsedSeconds = Math.max(1, (Date.now() - started) / 1000);
  const remainingSeconds = Math.max(30, (elapsedSeconds / job.progress) * (100 - job.progress));
  const minutes = Math.ceil(remainingSeconds / 60);

  return minutes <= 1 ? "About 1 minute remaining" : `About ${minutes} minutes remaining`;
};

interface GenerationJobTrackerProps {
  busyAction?: string | null;
  job: GenerationJob | null;
  message?: string | null;
  onCancel: () => void;
  onRetry: (stage?: JobStage) => void;
}

export function GenerationJobTracker({
  busyAction,
  job,
  message,
  onCancel,
  onRetry,
}: GenerationJobTrackerProps) {
  const activeStage = job?.stage;
  const hasError = job?.status === "failed";

  return (
    <Card className="rounded-[8px] border border-white/10 bg-white/[0.04] text-white ring-1 ring-white/5">
      <CardHeader className="border-b border-white/10">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="text-2xl text-white">Generation Progress</CardTitle>
            <p className="mt-2 flex items-center gap-2 text-sm text-gray-400">
              <Clock3 className="size-4 text-amber-200" />
              {formatEta(job)}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {hasError ? (
              <Button
                type="button"
                onClick={() => onRetry()}
                disabled={Boolean(busyAction)}
                className="h-10 rounded-[8px] bg-amber-300 text-sm font-semibold text-gray-950 hover:bg-amber-200"
              >
                {busyAction === "retry" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
                Retry audio
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              disabled={!job || job.status === "completed" || job.status === "canceled" || busyAction === "cancel"}
              onClick={onCancel}
              className="h-10 rounded-[8px] border-white/10 bg-white/5 text-sm text-white hover:bg-white/10"
            >
              {busyAction === "cancel" ? <Loader2 className="size-4 animate-spin" /> : <SquareX className="size-4" />}
              Cancel
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-5">
        {message || hasError ? (
          <div className="rounded-[8px] border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <p>{hasError ? friendlyError : message}</p>
            </div>
          </div>
        ) : null}

        {jobStages.map((stage) => {
          const stageProgress = job?.stages?.[stage] ?? fallbackProgress;
          const progress = Math.min(100, Math.max(0, Math.round(stageProgress.progress)));
          const active = activeStage === stage && job?.status === "running";
          const failed = stageProgress.status === "failed" || (job?.status === "failed" && activeStage === stage);
          const completed = stageProgress.status === "completed" || progress >= 100;

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
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    {completed ? <CheckCircle2 className="size-4 text-emerald-300" /> : null}
                    {active ? <span className="size-2 animate-pulse rounded-full bg-amber-300" /> : null}
                    <p className="font-semibold text-white">{stageLabels[stage]}</p>
                  </div>
                  <p className="mt-1 text-xs text-gray-400">{stageDescriptions[stage]}</p>
                </div>
                <span className="text-sm font-semibold text-gray-200">{progress}%</span>
              </div>
              <Progress
                value={progress}
                className="h-2 rounded-[8px] bg-white/10 [&>div]:rounded-[8px] [&>div]:bg-amber-300"
              />
              {failed ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-red-300/20 bg-red-500/10 p-3 text-sm text-red-100">
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="size-4" />
                    {friendlyError}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onRetry(stage)}
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
  );
}
