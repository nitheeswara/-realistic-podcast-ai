"use client";

import { doc, getDoc } from "firebase/firestore";
import { motion } from "framer-motion";
import type { Variants } from "framer-motion";
import {
  AudioLines,
  BadgeCheck,
  Clapperboard,
  LogOut,
  Plus,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

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

interface UserProfile {
  name?: unknown;
}

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.12,
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
    description: "Queue avatar scenes, camera style, and final rendering.",
    icon: Clapperboard,
  },
] as const;

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading, signOut } = useAuth();
  const [profileName, setProfileName] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, router, user]);

  useEffect(() => {
    let isMounted = true;

    const loadProfile = async () => {
      if (!user) {
        setProfileName(null);
        setProfileLoading(false);
        return;
      }

      setProfileLoading(true);

      try {
        const snapshot = await getDoc(doc(db, "users", user.uid));
        const data = snapshot.exists()
          ? (snapshot.data() as UserProfile)
          : null;
        const storedName =
          typeof data?.name === "string" && data.name.trim().length > 0
            ? data.name.trim()
            : null;

        if (isMounted) {
          setProfileName(storedName ?? user.displayName ?? user.email);
        }
      } catch {
        if (isMounted) {
          setProfileName(user.displayName ?? user.email);
        }
      } finally {
        if (isMounted) {
          setProfileLoading(false);
        }
      }
    };

    void loadProfile();

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
    <main className="min-h-screen bg-gray-950 text-white">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 py-8 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-6 border-b border-white/10 pb-8 md:flex-row md:items-center md:justify-between">
          <div className="space-y-3">
            <div className="flex w-fit items-center gap-2 rounded-[8px] border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">
              <BadgeCheck className="size-3.5" />
              Free plan
            </div>
            <div className="space-y-2">
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-white md:text-5xl">
                {greeting}
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-gray-400 md:text-base">
                Shape scripts, voices, and video episodes from one focused
                production desk.
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
              asChild
              className="h-11 rounded-[8px] border-white/10 bg-white/5 px-5 text-sm text-white hover:bg-white/10"
              variant="outline"
            >
              <Link href="/dashboard/clones">
                <AudioLines className="size-4" />
                Clone Library
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
                No podcasts yet. Start with a fresh episode when you are ready.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex min-h-64 flex-col items-center justify-center gap-4 px-6 py-14 text-center">
              <div className="flex size-14 items-center justify-center rounded-[8px] border border-white/10 bg-gray-900 text-amber-200">
                <AudioLines className="size-7" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold text-white">
                  Empty studio shelf
                </h2>
                <p className="max-w-md text-sm leading-6 text-gray-400">
                  Your generated podcasts will appear here with status, assets,
                  and export links.
                </p>
              </div>
              <Button
                asChild
                className="mt-2 h-11 rounded-[8px] bg-amber-300 px-5 text-sm font-semibold text-gray-950 hover:bg-amber-200"
              >
                <Link href="/dashboard/create">
                  <Plus className="size-4" />
                  Create New Podcast
                </Link>
              </Button>
            </CardContent>
          </Card>
        </motion.section>
      </section>
    </main>
  );
}


