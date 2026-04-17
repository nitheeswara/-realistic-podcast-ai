"use client";

import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { motion } from "framer-motion";
import {
  Clapperboard,
  Film,
  Loader2,
  MonitorPlay,
  RectangleHorizontal,
  RectangleVertical,
  Sparkles,
  Square,
  Subtitles,
  Video,
} from "lucide-react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ElementType } from "react";

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
import {
  aspectRatios,
  backgroundOptions,
  cameraStyleOptions,
  subtitleStyles,
} from "@/lib/podcast/constants";
import { videoSettingsSchema } from "@/lib/podcast/schemas";
import { cn } from "@/lib/utils";
import type { AspectRatio, CameraStyle, StudioBackground, SubtitleStyle, VideoSettings } from "@/types/video";

const getParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const defaultSettings: VideoSettings = {
  background: "midnight",
  backgroundUrl: backgroundOptions[0].imageUrl,
  cameraStyle: "locked",
  subtitlesEnabled: true,
  subtitleStyle: "podcast",
  aspectRatio: "16:9",
  resolution: "1080p",
};

const cameraIcon: Record<CameraStyle, ElementType> = {
  locked: MonitorPlay,
  push_in: Video,
  two_shot: Clapperboard,
};

const aspectIcon: Record<AspectRatio, ElementType> = {
  "16:9": RectangleHorizontal,
  "9:16": RectangleVertical,
  "1:1": Square,
};

export default function StudioSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const podcastId = getParam(params.podcastId);
  const { user, loading } = useAuth();
  const [settings, setSettings] = useState<VideoSettings>(defaultSettings);
  const [pageLoading, setPageLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, router, user]);

  useEffect(() => {
    const loadSettings = async () => {
      if (!user || !podcastId) {
        return;
      }

      setPageLoading(true);
      setMessage(null);

      try {
        const snapshot = await getDoc(doc(db, "podcasts", podcastId));

        if (!snapshot.exists()) {
          setMessage("Podcast not found.");
          return;
        }

        const data = snapshot.data() as { ownerId?: unknown; videoSettings?: unknown };

        if (data.ownerId !== user.uid) {
          setMessage("This podcast belongs to another account.");
          return;
        }

        const parsed = videoSettingsSchema.safeParse(data.videoSettings);
        if (parsed.success) {
          setSettings(parsed.data);
        }
      } catch {
        setMessage("Could not load studio settings.");
      } finally {
        setPageLoading(false);
      }
    };

    void loadSettings();
  }, [podcastId, user]);

  const persistSettings = async (nextSettings: VideoSettings) => {
    if (!podcastId) {
      return;
    }

    setSettings(nextSettings);
    setSaving(true);
    setMessage(null);

    try {
      await updateDoc(doc(db, "podcasts", podcastId), {
        videoSettings: nextSettings,
        status: "configuring",
        updatedAt: serverTimestamp(),
      });
    } catch {
      setMessage("Could not save this setting.");
    } finally {
      setSaving(false);
    }
  };

  const setBackground = (background: StudioBackground) => {
    const option = backgroundOptions.find((item) => item.value === background);
    void persistSettings({
      ...settings,
      background,
      backgroundUrl: option?.imageUrl,
    });
  };

  const setCameraStyle = (cameraStyle: CameraStyle) => {
    void persistSettings({ ...settings, cameraStyle });
  };

  const setSubtitlesEnabled = (subtitlesEnabled: boolean) => {
    void persistSettings({ ...settings, subtitlesEnabled });
  };

  const setSubtitleStyle = (subtitleStyle: SubtitleStyle) => {
    void persistSettings({ ...settings, subtitleStyle });
  };

  const setAspectRatio = (aspectRatio: AspectRatio) => {
    void persistSettings({ ...settings, aspectRatio });
  };

  const generateVideo = async () => {
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
        body: JSON.stringify({ podcastId }),
      });

      const payload: unknown = await response.json();

      if (!response.ok) {
        const errorMessage =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof (payload as { error: unknown }).error === "string"
            ? (payload as { error: string }).error
            : "Video generation failed.";
        throw new Error(errorMessage);
      }

      const jobId =
        typeof payload === "object" &&
        payload !== null &&
        "jobId" in payload &&
        typeof (payload as { jobId: unknown }).jobId === "string"
          ? (payload as { jobId: string }).jobId
          : null;

      if (!jobId) {
        throw new Error("The video job did not return an id.");
      }

      router.push(`/dashboard/podcasts/${podcastId}/generating?jobId=${jobId}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Video generation failed.");
    } finally {
      setGenerating(false);
    }
  };

  if (loading || pageLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <div className="flex items-center gap-3 text-sm text-gray-400">
          <Loader2 className="size-4 animate-spin text-amber-200" />
          Loading studio controls...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 px-4 py-8 text-white sm:px-6 lg:px-8">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <motion.header
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col gap-5 border-b border-white/10 pb-6 lg:flex-row lg:items-end lg:justify-between"
        >
          <div className="space-y-3">
            <p className="w-fit rounded-[8px] border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">
              Studio settings
            </p>
            <div>
              <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
                Direct the final video
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-400">
                Every change saves immediately. Tune the visual language before rendering.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-[8px] border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-300">
              {saving ? "Saving..." : "Autosaved"}
            </span>
            <Button
              type="button"
              onClick={generateVideo}
              disabled={generating}
              className="h-11 rounded-[8px] bg-amber-300 px-5 text-sm font-semibold text-gray-950 hover:bg-amber-200"
            >
              {generating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              Generate Video
            </Button>
          </div>
        </motion.header>

        {message ? (
          <p className="rounded-[8px] border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {message}
          </p>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <Card className="rounded-[8px] border border-white/10 bg-white/[0.04] text-white ring-1 ring-white/5">
            <CardHeader>
              <CardTitle className="text-2xl text-white">Background</CardTitle>
              <CardDescription className="text-sm text-gray-400">
                Choose the room behind the conversation.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {backgroundOptions.map((background) => (
                <motion.button
                  key={background.value}
                  type="button"
                  whileHover={{ y: -3 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setBackground(background.value)}
                  className={cn(
                    "flex items-center overflow-hidden rounded-[8px] border text-left",
                    settings.background === background.value
                      ? "border-amber-300 bg-amber-300/10"
                      : "border-white/10 bg-gray-950/50"
                  )}
                >
                  <Image
                    src={background.imageUrl}
                    alt={background.label}
                    className="h-20 w-[120px] shrink-0 object-cover"
                    width={120}
                    height={80}
                  />
                  <div className="flex items-center justify-between p-3">
                    <span className="text-sm font-semibold text-white">{background.label}</span>
                    {settings.background === background.value ? <Sparkles className="size-4 text-amber-200" /> : null}
                  </div>
                </motion.button>
              ))}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card className="rounded-[8px] border border-white/10 bg-white/[0.04] text-white ring-1 ring-white/5">
              <CardHeader>
                <CardTitle className="text-2xl text-white">Camera style</CardTitle>
                <CardDescription className="text-sm text-gray-400">
                  Pick the edit rhythm for camera movement.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {cameraStyleOptions.map((camera) => {
                  const Icon = cameraIcon[camera.value];
                  return (
                    <motion.button
                      key={camera.value}
                      type="button"
                      whileHover={{ x: 3 }}
                      onClick={() => setCameraStyle(camera.value)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-[8px] border p-3 text-left",
                        settings.cameraStyle === camera.value
                          ? "border-amber-300 bg-amber-300/10"
                          : "border-white/10 bg-gray-950/50"
                      )}
                    >
                      <span className="flex size-11 items-center justify-center rounded-[8px] bg-white/10 text-amber-100">
                        <Icon className="size-5" />
                      </span>
                      <span>
                        <span className="block font-semibold text-white">{camera.label}</span>
                        <span className="text-sm text-gray-400">{camera.description}</span>
                      </span>
                    </motion.button>
                  );
                })}
              </CardContent>
            </Card>

            <Card className="rounded-[8px] border border-white/10 bg-white/[0.04] text-white ring-1 ring-white/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-2xl text-white">
                  <Subtitles className="size-5 text-amber-200" />
                  Subtitles
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <button
                  type="button"
                  onClick={() => setSubtitlesEnabled(!settings.subtitlesEnabled)}
                  className="flex w-full items-center justify-between rounded-[8px] border border-white/10 bg-gray-950/50 p-3 text-sm text-gray-200"
                >
                  Show subtitles
                  <span
                    className={cn(
                      "flex h-6 w-11 items-center rounded-full p-1 transition-colors",
                      settings.subtitlesEnabled ? "bg-amber-300" : "bg-white/10"
                    )}
                  >
                    <span
                      className={cn(
                        "size-4 rounded-full bg-gray-950 transition-transform",
                        settings.subtitlesEnabled && "translate-x-5"
                      )}
                    />
                  </span>
                </button>
                <div className="flex flex-wrap gap-2">
                  {subtitleStyles.map((style) => (
                    <button
                      key={style}
                      type="button"
                      onClick={() => setSubtitleStyle(style)}
                      className={cn(
                        "rounded-[8px] border px-3 py-2 text-xs capitalize",
                        settings.subtitleStyle === style
                          ? "border-amber-300 bg-amber-300 text-gray-950"
                          : "border-white/10 bg-white/5 text-gray-300"
                      )}
                    >
                      {style}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[8px] border border-white/10 bg-white/[0.04] text-white ring-1 ring-white/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-2xl text-white">
                  <Film className="size-5 text-amber-200" />
                  Aspect ratio
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-2">
                {aspectRatios.map((ratio) => {
                  const Icon = aspectIcon[ratio];
                  return (
                    <button
                      key={ratio}
                      type="button"
                      onClick={() => setAspectRatio(ratio)}
                      className={cn(
                        "flex flex-col items-center gap-2 rounded-[8px] border p-3 text-sm",
                        settings.aspectRatio === ratio
                          ? "border-amber-300 bg-amber-300/10 text-amber-100"
                          : "border-white/10 bg-gray-950/50 text-gray-300"
                      )}
                    >
                      <Icon className="size-5" />
                      {ratio}
                    </button>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
    </main>
  );
}





