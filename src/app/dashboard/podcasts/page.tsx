"use client";

import { collection, getDocs, query, where } from "firebase/firestore";
import { motion } from "framer-motion";
import { Calendar, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { db } from "@/config/firebase-client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import type { Podcast, PodcastStatus } from "@/types/podcast";

type PodcastListItem = Pick<Podcast, "id" | "title" | "status" | "createdAt">;

type FirestoreDateLike = {
  toDate: () => Date;
};

const statusClass: Record<PodcastStatus, string> = {
  draft: "border-gray-300/20 bg-gray-300/10 text-gray-200",
  scripting: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  script_ready: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  configuring: "border-sky-300/30 bg-sky-300/10 text-sky-100",
  queued: "border-violet-300/30 bg-violet-300/10 text-violet-100",
  generating: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  completed: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  failed: "border-red-300/30 bg-red-300/10 text-red-100",
  canceled: "border-gray-300/20 bg-gray-300/10 text-gray-200",
};

const isFirestoreDateLike = (value: unknown): value is FirestoreDateLike =>
  typeof value === "object" &&
  value !== null &&
  "toDate" in value &&
  typeof (value as FirestoreDateLike).toDate === "function";

const formatDate = (value: unknown) => {
  const date = isFirestoreDateLike(value)
    ? value.toDate()
    : typeof value === "string"
      ? new Date(value)
      : null;

  if (!date || Number.isNaN(date.getTime())) {
    return "No date";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

const toPodcastListItem = (id: string, data: Record<string, unknown>): PodcastListItem => ({
  id,
  title: typeof data.title === "string" && data.title.trim().length > 0
    ? data.title.trim()
    : "Untitled podcast",
  status: typeof data.status === "string" && data.status in statusClass
    ? (data.status as PodcastStatus)
    : "draft",
  createdAt: isFirestoreDateLike(data.createdAt)
    ? data.createdAt.toDate().toISOString()
    : typeof data.createdAt === "string"
      ? data.createdAt
      : "",
});

export default function PodcastsPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [podcasts, setPodcasts] = useState<PodcastListItem[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, router, user]);

  const loadPodcasts = useCallback(async () => {
    if (!user) {
      return;
    }

    setPageLoading(true);
    setError(null);

    try {
      const podcastsQuery = query(
        collection(db, "podcasts"),
        where("userId", "==", user.uid)
      );
      const snapshot = await getDocs(podcastsQuery);
      const nextPodcasts = snapshot.docs
        .map((documentSnapshot) =>
          toPodcastListItem(documentSnapshot.id, documentSnapshot.data())
        )
        .sort((first, second) => second.createdAt.localeCompare(first.createdAt));

      setPodcasts(nextPodcasts);
    } catch {
      setError("Could not load your podcasts.");
    } finally {
      setPageLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadPodcasts();
  }, [loadPodcasts]);

  if (loading || (!user && !loading)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <Loader2 className="size-5 animate-spin text-amber-200" />
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
              Podcasts
            </p>
            <div>
              <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
                Your podcasts
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-400">
                Continue a draft, check a render, or start the next episode.
              </p>
            </div>
          </div>
          <Button asChild className="h-11 rounded-[8px] bg-amber-300 px-5 text-sm font-semibold text-gray-950 hover:bg-amber-200">
            <Link href="/dashboard/create">
              <Plus className="size-4" />
              New podcast
            </Link>
          </Button>
        </motion.header>

        {error ? (
          <p className="rounded-[8px] border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
        ) : null}

        {pageLoading ? (
          <div className="flex min-h-72 items-center justify-center rounded-[8px] border border-white/10 bg-white/[0.03] text-sm text-gray-400">
            <Loader2 className="mr-2 size-4 animate-spin text-amber-200" />
            Loading podcasts...
          </div>
        ) : podcasts.length === 0 ? (
          <Card className="rounded-[8px] border border-white/10 bg-white/[0.04] text-white ring-1 ring-white/5">
            <CardContent className="flex min-h-72 flex-col items-center justify-center gap-4 px-6 py-14 text-center">
              <h2 className="text-2xl font-semibold text-white">No podcasts yet</h2>
              <p className="max-w-md text-sm leading-6 text-gray-400">
                Create your first episode brief and the generated podcasts will appear here.
              </p>
              <Button asChild className="h-11 rounded-[8px] bg-amber-300 px-5 text-sm font-semibold text-gray-950 hover:bg-amber-200">
                <Link href="/dashboard/create">Create Podcast</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <motion.div
            initial="hidden"
            animate="show"
            variants={{
              hidden: { opacity: 0 },
              show: { opacity: 1, transition: { staggerChildren: 0.08 } },
            }}
            className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
          >
            {podcasts.map((podcast) => (
              <motion.article
                key={podcast.id}
                variants={{
                  hidden: { opacity: 0, y: 16 },
                  show: { opacity: 1, y: 0 },
                }}
                whileHover={{ y: -3 }}
              >
                <Card className="h-full rounded-[8px] border border-white/10 bg-white/[0.04] text-white ring-1 ring-white/5">
                  <CardHeader className="gap-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="line-clamp-2 text-xl text-white">
                          {podcast.title}
                        </CardTitle>
                        <CardDescription className="mt-3 flex items-center gap-2 text-sm text-gray-400">
                          <Calendar className="size-4" />
                          {formatDate(podcast.createdAt)}
                        </CardDescription>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn("shrink-0 rounded-[8px] border text-xs capitalize", statusClass[podcast.status])}
                      >
                        {podcast.status.replace("_", " ")}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <Button asChild className="h-10 w-full rounded-[8px] bg-amber-300 text-sm font-semibold text-gray-950 hover:bg-amber-200">
                      <Link href={`/dashboard/podcasts/${podcast.id}/script`}>
                        View podcast
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              </motion.article>
            ))}
          </motion.div>
        )}
      </section>
    </main>
  );
}