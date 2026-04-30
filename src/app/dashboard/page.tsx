"use client";

import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { motion } from "framer-motion";
import type { Variants } from "framer-motion";
import {
  AudioLines,
  BadgeCheck,
  Clapperboard,
  Film,
  LogOut,
  Plus,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

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
import type { PodcastStatus } from "@/types/podcast";

interface UserProfile {
  credits?: unknown;
  name?: unknown;
  videosGenerated?: unknown;
}

interface DashboardPodcast {
  id: string;
  title: string;
  status: PodcastStatus;
  posterUrl?: string;
  videoUrl?: string;
  durationSeconds?: number;
  createdAt?: unknown;
  updatedAt?: unknown;
  language?: string;
}

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
    },
  },
};

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.45,
      ease: "easeOut",
    },
  },
};

const featureCards = [
  {
    title: "Script Lab",
    description: "Draft structured episodes with speaker turns and pacing.",
    icon: Sparkles,
  },
  {
    title: "Voice Studio",
    description: "Prepare natural voice profiles for lifelike narration.",
    icon: AudioLines,
  },
  {
    title: "Video Stage",
    description: "Render HeyGen avatar scenes and final MP4 exports.",
    icon: Clapperboard,
  },
] as const;

const statusClass: Record<PodcastStatus, string> = {
  canceled: "border-gray-300/20 bg-gray-300/10 text-gray-200",
  completed: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  configuring: "border-sky-300/30 bg-sky-300/10 text-sky-100",
  draft: "border-white/15 bg-white/10 text-gray-200",
  failed: "border-red-300/30 bg-red-400/10 text-red-100",
  generating: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  queued: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  script_ready: "border-violet-300/30 bg-violet-300/10 text-violet-100",
  scripting: "border-violet-300/30 bg-violet-300/10 text-violet-100",
};

const knownStatuses = new Set(Object.keys(statusClass));

const stringFromData = (data: Record<string, unknown>, key: string, fallback = "") => {
  const value = data[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
};

const numberFromData = (data: Record<string, unknown>, key: string) => {
  const value = data[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const dateMs = (value: unknown) => {
  if (typeof value === "object" && value !== null && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate().getTime();
  }

  if (typeof value === "string") {
    return new Date(value).getTime();
  }

  return 0;
};

const formatDate = (value: unknown) => {
  const ms = dateMs(value);
  return ms > 0 ? new Date(ms).toLocaleDateString() : "Recently";
};

const formatDuration = (seconds?: number) => {
  if (!seconds) {
    return "Not rendered yet";
  }

  const rounded = Math.max(1, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
};

const firstFrameFromCloudinary = (videoUrl?: string) => {
  if (!videoUrl || !videoUrl.includes("/video/upload/")) {
    return undefined;
  }

  return videoUrl
    .replace("/video/upload/", "/video/upload/so_0/")
    .replace(/\.(mp4|mov|webm)(\?.*)?$/i, ".jpg");
};

const podcastHref = (podcast: DashboardPodcast) => {
  if (podcast.status === "completed") {
    return `/dashboard/podcasts/${podcast.id}/result`;
  }

  if (podcast.status === "generating" || podcast.status === "queued") {
    return `/dashboard/podcasts/${podcast.id}/generating`;
  }

  if (podcast.status === "failed") {
    return `/dashboard/podcasts/${podcast.id}/result`;
  }

  return `/dashboard/podcasts/${podcast.id}/script`;
};

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading, signOut } = useAuth();
  const [profileName, setProfileName] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [videosGenerated, setVideosGenerated] = useState(0);
  const [credits, setCredits] = useState(3);
  const [podcasts, setPodcasts] = useState<DashboardPodcast[]>([]);
  const [podcastsLoading, setPodcastsLoading] = useState(true);
  const [loadMessage, setLoadMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, router, user]);

  useEffect(() => {
    let isMounted = true;

    const loadDashboard = async () => {
      if (!user) {
        setProfileName(null);
        setProfileLoading(false);
        setPodcastsLoading(false);
        return;
      }

      setProfileLoading(true);
      setPodcastsLoading(true);
      setLoadMessage(null);

      try {
        const [profileSnapshot, podcastSnapshot] = await Promise.all([
          getDoc(doc(db, "users", user.uid)),
          getDocs(query(collection(db, "podcasts"), where("ownerId", "==", user.uid))),
        ]);

        if (!isMounted) {
          return;
        }

        const profile = profileSnapshot.exists()
          ? (profileSnapshot.data() as UserProfile)
          : null;
        const storedName =
          typeof profile?.name === "string" && profile.name.trim().length > 0
            ? profile.name.trim()
            : null;
        const generated =
          typeof profile?.videosGenerated === "number" && Number.isFinite(profile.videosGenerated)
            ? profile.videosGenerated
            : 0;
        const creditLimit =
          typeof profile?.credits === "number" && Number.isFinite(profile.credits)
            ? profile.credits
            : 3;

        const nextPodcasts = podcastSnapshot.docs
          .map((item): DashboardPodcast => {
            const data = item.data() as Record<string, unknown>;
            const rawStatus = stringFromData(data, "status", "draft");
            const status = knownStatuses.has(rawStatus)
              ? (rawStatus as PodcastStatus)
              : "draft";

            return {
              id: item.id,
              title: stringFromData(data, "title", "Untitled podcast"),
              status,
              posterUrl: stringFromData(data, "posterUrl") || stringFromData(data, "thumbnailUrl") || undefined,
              videoUrl: stringFromData(data, "videoUrl") || undefined,
              durationSeconds: numberFromData(data, "durationSeconds"),
              createdAt: data.createdAt,
              updatedAt: data.updatedAt,
              language: stringFromData(data, "language") || undefined,
            };
          })
          .sort((a, b) => dateMs(b.updatedAt ?? b.createdAt) - dateMs(a.updatedAt ?? a.createdAt));

        setProfileName(storedName ?? user.displayName ?? user.email);
        setVideosGenerated(generated);
        setCredits(creditLimit);
        setPodcasts(nextPodcasts);
      } catch {
        if (isMounted) {
          setProfileName(user.displayName ?? user.email);
          setLoadMessage("Could not refresh your studio. AI is busy, retrying...");
        }
      } finally {
        if (isMounted) {
          setProfileLoading(false);
          setPodcastsLoading(false);
        }
      }
    };

    void loadDashboard();

    return () => {
      isMounted = false;
    };
  }, [user]);

  const greeting = useMemo(() => {
    if (profileLoading || loading) {
      return "Warming up the studio...";
    }

    return `Welcome back${profileName ? `, ${profileName}` : ""}`;
  }, [loading, profileLoading, profileName]);

  const creditsRemaining = Math.max(0, credits - videosGenerated);

  const handleSignOut = async () => {
    await signOut();
    router.replace("/login");
  };

  if (loading || (!user && !loading)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <p className="text-sm text-gray-400">Checking studio access...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#33240d,transparent_34%),linear-gradient(135deg,#05070f,#111827_55%,#05070f)] text-white">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 py-8 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-6 border-b border-white/10 pb-8 md:flex-row md:items-center md:justify-between">
          <div className="space-y-3">
            <div className="flex w-fit items-center gap-2 rounded-[8px] border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">
              <BadgeCheck className="size-3.5" />
              Studio dashboard
            </div>
            <div className="space-y-2">
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-white md:text-5xl">
                {greeting}
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-gray-400 md:text-base">
                Shape scripts, voices, HeyGen avatar videos, and final podcast exports from one focused production desk.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              asChild
              className="h-11 rounded-[8px] bg-amber-300 px-5 text-sm font-semibold text-gray-950 hover:bg-amber-200"
            >
              <Link href="/dashboard/create">
                <Plus className="size-4" />
                Create New Podcast
              </Link>
            </Button>
            <Button
              className="h-11 rounded-[8px] border-white/10 bg-white/5 px-5 text-sm text-white hover:bg-white/10"
              type="button"
              variant="outline"
              onClick={handleSignOut}
            >
              <LogOut className="size-4" />
              Sign out
            </Button>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <MetricCard label="Videos generated" value={String(videosGenerated)} description="Successful MP4 exports" />
          <MetricCard label="Credits remaining" value={String(creditsRemaining)} description={`${videosGenerated}/${credits} credits used`} />
          <MetricCard label="Active projects" value={String(podcasts.length)} description="Drafts, renders, and results" />
        </section>

        {loadMessage ? (
          <p className="rounded-[8px] border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
            {loadMessage}
          </p>
        ) : null}

        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="show"
          className="grid gap-4 md:grid-cols-3"
        >
          {featureCards.map((feature) => {
            const Icon = feature.icon;

            return (
              <motion.div key={feature.title} variants={cardVariants}>
                <Card className="h-full rounded-[8px] border border-white/10 bg-white/[0.04] text-white ring-1 ring-white/5 backdrop-blur">
                  <CardHeader className="gap-4">
                    <div className="flex size-11 items-center justify-center rounded-[8px] border border-amber-300/20 bg-amber-300/10 text-amber-200">
                      <Icon className="size-5" />
                    </div>
                    <div className="space-y-2">
                      <CardTitle className="text-lg text-white">
                        {feature.title}
                      </CardTitle>
                      <CardDescription className="text-sm leading-6 text-gray-400">
                        {feature.description}
                      </CardDescription>
                    </div>
                  </CardHeader>
                </Card>
              </motion.div>
            );
          })}
        </motion.div>

        <motion.section variants={cardVariants} initial="hidden" animate="show">
          <Card className="rounded-[8px] border border-white/10 bg-white/[0.04] py-0 text-white ring-1 ring-white/5">
            <CardHeader className="border-b border-white/10 px-6 py-5">
              <CardTitle className="text-xl text-white">Your podcasts</CardTitle>
              <CardDescription className="text-sm text-gray-400">
                Completed renders open directly to the result page. Drafts continue where you left off.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              {podcastsLoading ? (
                <div className="flex min-h-64 items-center justify-center text-sm text-gray-400">
                  Loading podcasts...
                </div>
              ) : podcasts.length === 0 ? (
                <EmptyState />
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {podcasts.map((podcast) => (
                    <PodcastCard key={podcast.id} podcast={podcast} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.section>
      </section>
    </main>
  );
}

function MetricCard({
  description,
  label,
  value,
}: {
  description: string;
  label: string;
  value: string;
}) {
  return (
    <Card className="rounded-[8px] border border-white/10 bg-black/20 text-white ring-1 ring-white/5">
      <CardContent className="p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{label}</p>
        <p className="mt-3 text-3xl font-semibold text-white">{value}</p>
        <p className="mt-1 text-sm text-gray-400">{description}</p>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-4 px-6 py-14 text-center">
      <div className="flex size-14 items-center justify-center rounded-[8px] border border-white/10 bg-gray-900 text-amber-200">
        <AudioLines className="size-7" />
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold text-white">Create your first podcast</h2>
        <p className="max-w-md text-sm leading-6 text-gray-400">
          Start with a topic and we will walk it through script, voices, avatars, and final video.
        </p>
      </div>
      <Button
        asChild
        className="mt-2 h-11 rounded-[8px] bg-amber-300 px-5 text-sm font-semibold text-gray-950 hover:bg-amber-200"
      >
        <Link href="/dashboard/create">
          <Plus className="size-4" />
          Create your first podcast
        </Link>
      </Button>
    </div>
  );
}

function PodcastCard({ podcast }: { podcast: DashboardPodcast }) {
  const href = podcastHref(podcast);
  const thumbnail = firstFrameFromCloudinary(podcast.videoUrl) ?? podcast.posterUrl;

  return (
    <Link
      href={href}
      className={cn(
        "group overflow-hidden rounded-[10px] border border-white/10 bg-gray-950/70 transition hover:-translate-y-0.5 hover:border-amber-300/40 hover:bg-gray-900",
        podcast.status !== "completed" && "hover:border-white/20"
      )}
    >
      <div className="relative aspect-video overflow-hidden bg-gradient-to-br from-gray-900 via-gray-800 to-amber-950/40">
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnail}
            alt=""
            className="size-full object-cover opacity-90 transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-amber-200">
            <Film className="size-10" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/10" />
        <Badge className={cn("absolute left-3 top-3 rounded-[8px] border capitalize", statusClass[podcast.status])} variant="outline">
          {podcast.status.replace("_", " ")}
        </Badge>
      </div>
      <div className="space-y-3 p-4">
        <div>
          <h3 className="line-clamp-2 text-lg font-semibold text-white">{podcast.title}</h3>
          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-gray-500">
            {podcast.language ?? "Podcast"} / {formatDate(podcast.updatedAt ?? podcast.createdAt)}
          </p>
        </div>
        <div className="flex items-center justify-between text-sm text-gray-400">
          <span>{formatDuration(podcast.durationSeconds)}</span>
          <span className="text-amber-200">
            {podcast.status === "completed" ? "View result" : podcast.status === "failed" ? "Retry" : "Continue"}
          </span>
        </div>
      </div>
    </Link>
  );
}
