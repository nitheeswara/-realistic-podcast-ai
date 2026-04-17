"use client";

import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { motion } from "framer-motion";
import { ArrowRight, Check, Loader2, Play, Save, WifiOff } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AvatarCloneUpload } from "@/components/voice-avatar-setup/AvatarCloneUpload";
import { CloningModeSelector } from "@/components/voice-avatar-setup/CloningModeSelector";
import type { CloningPresetId } from "@/components/voice-avatar-setup/CloningModeSelector";
import { VoiceCloneUpload } from "@/components/voice-avatar-setup/VoiceCloneUpload";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { db } from "@/config/firebase-client";
import { useAuth } from "@/hooks/useAuth";
import {
  avatarOptions as fallbackAvatarOptions,
  languageOptions,
  voiceOptions as fallbackVoiceOptions,
} from "@/lib/podcast/constants";
import {
  avatarListResponseSchema,
  speakerConfigSchema,
  voiceListResponseSchema,
} from "@/lib/podcast/schemas";
import { cn } from "@/lib/utils";
import type { Avatar } from "@/types/avatar";
import type { SpeakerConfig, SpeakerGender, SpeakerRole, Voice, VoiceMode } from "@/types/voice";

const PREVIEW_TEXT =
  "Welcome to the studio. This is how your podcast voice will sound in the episode.";

const fallbackAvatarImage =
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=420&q=80";

const getParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const resolveLanguageCode = (value: unknown) => {
  if (typeof value !== "string") {
    return "en-US";
  }

  const configuredLanguage = languageOptions.find((option) => option.value === value);
  return configuredLanguage?.code ?? value;
};

const pickVoice = (
  voices: ReadonlyArray<Voice>,
  mode: Exclude<VoiceMode, "cloned">,
  gender: SpeakerGender
) =>
  voices.find((voice) => voice.mode === mode && voice.gender === gender) ??
  voices.find((voice) => voice.mode === mode) ??
  voices[0];

const pickAvatar = (avatars: ReadonlyArray<Avatar>, gender: SpeakerGender) =>
  avatars.find((avatar) => avatar.gender === gender) ?? avatars[0];

const defaultSpeaker = (
  role: SpeakerRole,
  voices: ReadonlyArray<Voice> = fallbackVoiceOptions,
  avatars: ReadonlyArray<Avatar> = fallbackAvatarOptions
): SpeakerConfig => {
  const preferredGender: SpeakerGender = role === "host" ? "male" : "female";
  const voice = pickVoice(voices, "ai_stock", preferredGender);
  const avatar = pickAvatar(avatars, preferredGender);

  return {
    id: role,
    role,
    name: role === "host" ? "Host" : "Guest",
    voiceMode: voice?.mode ?? "ai_stock",
    voiceId: voice?.id,
    voice,
    avatarMode: "stock",
    avatarId: avatar?.id,
    avatar,
    speakingStyle: role === "host" ? "confident and warm" : "insightful and natural",
  };
};

const coerceSpeakerConfig = (value: unknown, role: SpeakerRole) => {
  const parsed = speakerConfigSchema.safeParse(value);

  if (!parsed.success || parsed.data.id !== role || parsed.data.role !== role) {
    return null;
  }

  return parsed.data;
};

const ensureSpeakerAssets = (
  config: SpeakerConfig,
  role: SpeakerRole,
  voices: ReadonlyArray<Voice>,
  avatars: ReadonlyArray<Avatar>
): SpeakerConfig => {
  const preferredGender: SpeakerGender = role === "host" ? "male" : "female";
  const selectedVoice =
    config.voiceMode === "cloned"
      ? config.voice
      : voices.find((voice) => voice.id === config.voiceId) ??
        pickVoice(voices, config.voiceMode, preferredGender) ??
        config.voice;
  const selectedAvatar =
    config.avatarMode === "cloned"
      ? config.avatar
      : avatars.find((avatar) => avatar.id === config.avatarId) ??
        pickAvatar(avatars, preferredGender) ??
        config.avatar;

  return {
    ...config,
    voiceId: selectedVoice?.id ?? config.voiceId,
    voice: selectedVoice ?? config.voice,
    avatarMode: config.avatarMode ?? "stock",
    avatarId: selectedAvatar?.id ?? config.avatarId,
    avatar: selectedAvatar ?? config.avatar,
  };
};

const compactVoice = (voice: Voice): Voice => ({
  id: voice.id,
  name: voice.name,
  provider: voice.provider,
  mode: voice.mode,
  gender: voice.gender,
  languageCode: voice.languageCode,
  ...(voice.accent ? { accent: voice.accent } : {}),
  ...(voice.previewUrl ? { previewUrl: voice.previewUrl } : {}),
  ...(voice.externalVoiceId ? { externalVoiceId: voice.externalVoiceId } : {}),
});

const compactAvatar = (avatar: Avatar): Avatar => ({
  id: avatar.id,
  name: avatar.name,
  provider: avatar.provider,
  mode: avatar.mode,
  gender: avatar.gender,
  ...(avatar.previewImageUrl ? { previewImageUrl: avatar.previewImageUrl } : {}),
  ...(avatar.previewVideoUrl ? { previewVideoUrl: avatar.previewVideoUrl } : {}),
  ...(avatar.externalAvatarId ? { externalAvatarId: avatar.externalAvatarId } : {}),
});

const compactSpeaker = (speaker: SpeakerConfig): SpeakerConfig => ({
  id: speaker.id,
  name: speaker.name,
  role: speaker.role,
  voiceMode: speaker.voiceMode,
  ...(speaker.voiceId ? { voiceId: speaker.voiceId } : {}),
  ...(speaker.voice ? { voice: compactVoice(speaker.voice) } : {}),
  ...(speaker.clonedVoiceId ? { clonedVoiceId: speaker.clonedVoiceId } : {}),
  ...(speaker.clonedVoiceName ? { clonedVoiceName: speaker.clonedVoiceName } : {}),
  avatarMode: speaker.avatarMode ?? "stock",
  ...(speaker.avatarId ? { avatarId: speaker.avatarId } : {}),
  ...(speaker.avatar ? { avatar: compactAvatar(speaker.avatar) } : {}),
  ...(speaker.clonedAvatarId ? { clonedAvatarId: speaker.clonedAvatarId } : {}),
  ...(speaker.clonedAvatarName ? { clonedAvatarName: speaker.clonedAvatarName } : {}),
  ...(speaker.clonedAvatarPreviewUrl ? { clonedAvatarPreviewUrl: speaker.clonedAvatarPreviewUrl } : {}),
  ...(speaker.speakingStyle ? { speakingStyle: speaker.speakingStyle } : {}),
});

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

export default function VoiceAvatarPage() {
  const params = useParams();
  const router = useRouter();
  const podcastId = getParam(params.podcastId);
  const { user, loading } = useAuth();
  const [host, setHost] = useState<SpeakerConfig>(() => defaultSpeaker("host"));
  const [guest, setGuest] = useState<SpeakerConfig>(() => defaultSpeaker("guest"));
  const [voices, setVoices] = useState<Voice[]>(() => [...fallbackVoiceOptions]);
  const [avatars, setAvatars] = useState<Avatar[]>(() => [...fallbackAvatarOptions]);
  const [preset, setPreset] = useState<CloningPresetId>("full_ai");
  const [podcastLanguageCode, setPodcastLanguageCode] = useState("en-US");
  const [pageLoading, setPageLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, router, user]);

  useEffect(() => {
    const loadPodcast = async () => {
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

        const data = snapshot.data() as {
          ownerId?: unknown;
          host?: unknown;
          guest?: unknown;
          language?: unknown;
        };

        if (data.ownerId !== user.uid) {
          setMessage("This podcast belongs to another account.");
          return;
        }

        setPodcastLanguageCode(resolveLanguageCode(data.language));
        setHost(coerceSpeakerConfig(data.host, "host") ?? defaultSpeaker("host", voices, avatars));
        setGuest(coerceSpeakerConfig(data.guest, "guest") ?? defaultSpeaker("guest", voices, avatars));
      } catch {
        setMessage("Could not load speaker settings.");
      } finally {
        setPageLoading(false);
      }
    };

    void loadPodcast();
  }, [avatars, podcastId, user, voices]);

  useEffect(() => {
    const loadCatalog = async () => {
      if (!user) {
        return;
      }

      setCatalogLoading(true);
      setCatalogError(null);

      const token = await user.getIdToken();
      const failures: string[] = [];
      let nextVoices: Voice[] = [...fallbackVoiceOptions];
      let nextAvatars: Avatar[] = [...fallbackAvatarOptions];

      const [voicesResponse, avatarsResponse] = await Promise.all([
        fetch(`/api/voices/list?language=${encodeURIComponent(podcastLanguageCode)}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch("/api/avatars/list", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (voicesResponse.ok) {
        const payload: unknown = await voicesResponse.json();
        const parsed = voiceListResponseSchema.safeParse(payload);
        nextVoices = parsed.success && parsed.data.voices.length > 0 ? parsed.data.voices : nextVoices;
      } else {
        failures.push(await readApiError(voicesResponse, "Voice catalog unavailable."));
      }

      if (avatarsResponse.ok) {
        const payload: unknown = await avatarsResponse.json();
        const parsed = avatarListResponseSchema.safeParse(payload);
        nextAvatars = parsed.success && parsed.data.avatars.length > 0 ? parsed.data.avatars : nextAvatars;
      } else {
        failures.push(await readApiError(avatarsResponse, "Avatar catalog unavailable."));
      }

      setVoices(nextVoices);
      setAvatars(nextAvatars);
      setHost((current) => ensureSpeakerAssets(current, "host", nextVoices, nextAvatars));
      setGuest((current) => ensureSpeakerAssets(current, "guest", nextVoices, nextAvatars));
      setCatalogError(failures.length > 0 ? failures.join(" ") : null);
      setCatalogLoading(false);
    };

    void loadCatalog().catch(() => {
      setCatalogError("Provider catalog unavailable. Showing fallback stock selections.");
      setCatalogLoading(false);
    });
  }, [podcastLanguageCode, user]);

  const previewVoice = useCallback(
    async (voice: Voice) => {
      if (!user) {
        throw new Error("Sign in again to preview voices.");
      }

      if (voice.provider !== "elevenlabs" && voice.provider !== "sarvam") {
        throw new Error("Voice preview is unavailable for this provider.");
      }

      const token = await user.getIdToken();
      const response = await fetch("/api/voices/preview", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          voiceId: voice.externalVoiceId ?? voice.id,
          provider: voice.provider,
          lang: voice.languageCode || podcastLanguageCode,
          speaker: voice.externalVoiceId ?? voice.id,
          text: PREVIEW_TEXT,
        }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "Voice preview failed."));
      }

      return response.blob();
    },
    [podcastLanguageCode, user]
  );

  const applyPreset = (nextPreset: CloningPresetId) => {
    setPreset(nextPreset);

    if (nextPreset === "custom") {
      return;
    }

    const applySpeakerPreset = (
      speaker: SpeakerConfig,
      voiceMode: VoiceMode,
      avatarMode: "stock" | "cloned"
    ): SpeakerConfig => {
      const preferredGender: SpeakerGender = speaker.role === "host" ? "male" : "female";
      const nextVoice = voiceMode === "cloned" ? speaker.voice : pickVoice(voices, voiceMode, preferredGender);
      const nextAvatar = avatarMode === "cloned" ? speaker.avatar : pickAvatar(avatars, preferredGender);

      return {
        ...speaker,
        voiceMode,
        voiceId: nextVoice?.id ?? speaker.voiceId,
        voice: nextVoice ?? speaker.voice,
        avatarMode,
        avatarId: nextAvatar?.id ?? speaker.avatarId,
        avatar: nextAvatar ?? speaker.avatar,
      };
    };

    const table: Record<Exclude<CloningPresetId, "custom">, {
      hostVoice: VoiceMode;
      hostAvatar: "stock" | "cloned";
      guestVoice: VoiceMode;
      guestAvatar: "stock" | "cloned";
    }> = {
      full_ai: { hostVoice: "ai_premium", hostAvatar: "stock", guestVoice: "ai_premium", guestAvatar: "stock" },
      clone_host: { hostVoice: "cloned", hostAvatar: "cloned", guestVoice: "ai_premium", guestAvatar: "stock" },
      clone_guest: { hostVoice: "ai_premium", hostAvatar: "stock", guestVoice: "cloned", guestAvatar: "cloned" },
      clone_both: { hostVoice: "cloned", hostAvatar: "cloned", guestVoice: "cloned", guestAvatar: "cloned" },
      clone_host_voice: { hostVoice: "cloned", hostAvatar: "stock", guestVoice: "ai_premium", guestAvatar: "stock" },
      clone_guest_avatar: { hostVoice: "ai_premium", hostAvatar: "stock", guestVoice: "ai_premium", guestAvatar: "cloned" },
    };

    const selected = table[nextPreset];
    setHost((current) => applySpeakerPreset(current, selected.hostVoice, selected.hostAvatar));
    setGuest((current) => applySpeakerPreset(current, selected.guestVoice, selected.guestAvatar));
  };

  const saveSelections = async () => {
    if (!podcastId) {
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const nextHost = compactSpeaker(ensureSpeakerAssets(host, "host", voices, avatars));
      const nextGuest = compactSpeaker(ensureSpeakerAssets(guest, "guest", voices, avatars));

      await updateDoc(doc(db, "podcasts", podcastId), {
        host: nextHost,
        guest: nextGuest,
        speakers: [nextHost, nextGuest],
        cloningPreset: preset,
        status: "configuring",
        updatedAt: serverTimestamp(),
      });
      setHost(nextHost);
      setGuest(nextGuest);
      setMessage("Selections saved.");
    } catch {
      setMessage("Could not save selections.");
    } finally {
      setSaving(false);
    }
  };

  if (loading || pageLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <div className="flex items-center gap-3 text-sm text-gray-400">
          <Loader2 className="size-4 animate-spin text-amber-200" />
          Loading speaker studio...
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
              Clone matrix
            </p>
            <div>
              <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Cast the episode</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-400">
                Choose AI or cloned voices and avatars independently for host and guest.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              onClick={saveSelections}
              disabled={saving}
              className="h-11 rounded-[8px] border-white/10 bg-white/5 px-4 text-sm text-white hover:bg-white/10"
              variant="outline"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save selections
            </Button>
            <Button asChild className="h-11 rounded-[8px] bg-amber-300 px-4 text-sm font-semibold text-gray-950 hover:bg-amber-200">
              <Link href={`/dashboard/podcasts/${podcastId}/studio`}>
                Next: Studio Settings
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </motion.header>

        {catalogLoading ? (
          <p className="flex items-center gap-2 rounded-[8px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-300">
            <Loader2 className="size-4 animate-spin text-amber-200" />
            Refreshing provider catalog...
          </p>
        ) : null}

        {catalogError ? (
          <p className="flex items-center gap-2 rounded-[8px] border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
            <WifiOff className="size-4" />
            {catalogError}
          </p>
        ) : null}

        {message ? (
          <p className="rounded-[8px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-200">{message}</p>
        ) : null}

        <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          <h2 className="text-lg font-semibold text-white">Preset mode</h2>
          <CloningModeSelector value={preset} onChange={applyPreset} />
        </motion.section>

        <div className="grid gap-4 lg:grid-cols-2">
          <SpeakerConfigCard
            role="host"
            podcastId={podcastId ?? ""}
            config={host}
            voices={voices}
            avatars={avatars}
            onChange={setHost}
            onPreviewVoice={previewVoice}
          />
          <SpeakerConfigCard
            role="guest"
            podcastId={podcastId ?? ""}
            config={guest}
            voices={voices}
            avatars={avatars}
            onChange={setGuest}
            onPreviewVoice={previewVoice}
          />
        </div>
      </section>
    </main>
  );
}

interface SpeakerConfigCardProps {
  role: SpeakerRole;
  podcastId: string;
  config: SpeakerConfig;
  voices: Voice[];
  avatars: Avatar[];
  onChange: (config: SpeakerConfig) => void;
  onPreviewVoice: (voice: Voice) => Promise<Blob>;
}

function SpeakerConfigCard({
  role,
  podcastId,
  config,
  voices,
  avatars,
  onChange,
  onPreviewVoice,
}: SpeakerConfigCardProps) {
  const [voiceGender, setVoiceGender] = useState<SpeakerGender>(role === "host" ? "male" : "female");
  const avatarTab = config.avatarMode === "cloned" ? "cloned" : config.avatar?.gender ?? (role === "host" ? "male" : "female");

  const filteredVoices = useMemo(
    () =>
      voices.filter(
        (voice) => voice.mode === config.voiceMode && voice.gender === voiceGender
      ),
    [config.voiceMode, voiceGender, voices]
  );

  const filteredAvatars = useMemo(
    () => avatars.filter((avatar) => avatar.gender === avatarTab),
    [avatarTab, avatars]
  );

  const selectVoiceMode = (voiceMode: VoiceMode) => {
    if (voiceMode === "cloned") {
      onChange({ ...config, voiceMode });
      return;
    }

    const nextVoice = pickVoice(voices, voiceMode, voiceGender);
    onChange({
      ...config,
      voiceMode,
      voiceId: nextVoice?.id ?? config.voiceId,
      voice: nextVoice ?? config.voice,
    });
  };

  const selectVoice = (voice: Voice) => {
    onChange({
      ...config,
      voiceMode: voice.mode,
      voiceId: voice.id,
      voice,
    });
  };

  const selectAvatarGender = (gender: SpeakerGender) => {
    const nextAvatar = pickAvatar(avatars, gender);
    onChange({
      ...config,
      avatarMode: "stock",
      avatarId: nextAvatar?.id ?? config.avatarId,
      avatar: nextAvatar ?? config.avatar,
    });
  };

  const selectAvatar = (avatar: Avatar) => {
    onChange({
      ...config,
      avatarMode: "stock",
      avatarId: avatar.id,
      avatar,
    });
  };

  return (
    <motion.article
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -3 }}
      className="rounded-[8px] border border-white/10 bg-white/[0.04] ring-1 ring-white/5"
    >
      <Card className="rounded-[8px] border-0 bg-transparent text-white ring-0">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-2xl text-white">{role.toUpperCase()}</CardTitle>
              <CardDescription className="mt-2 text-sm text-gray-400">
                Voice and avatar choices are independent.
              </CardDescription>
            </div>
            <Badge className="rounded-[8px] border border-amber-300/20 bg-amber-300/10 text-amber-100" variant="outline">
              {config.voiceMode === "cloned" || config.avatarMode === "cloned" ? "Clone mix" : "Full AI"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-7">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-200">Voice selector</h2>
            <Tabs value={config.voiceMode} onValueChange={(value) => selectVoiceMode(value as VoiceMode)}>
              <TabsList className="grid w-full grid-cols-3 rounded-[8px] bg-white/10">
                <TabsTrigger value="ai_stock" className="rounded-[8px]">AI Stock</TabsTrigger>
                <TabsTrigger value="ai_premium" className="rounded-[8px]">AI Premium</TabsTrigger>
                <TabsTrigger value="cloned" className="rounded-[8px]">Clone your voice</TabsTrigger>
              </TabsList>
              <TabsContent value="ai_stock" className="mt-4 space-y-3">
                <GenderFilter value={voiceGender} onChange={setVoiceGender} />
                <VoiceGrid voices={filteredVoices} selectedId={config.voiceId} onSelect={selectVoice} onPreview={onPreviewVoice} />
              </TabsContent>
              <TabsContent value="ai_premium" className="mt-4 space-y-3">
                <GenderFilter value={voiceGender} onChange={setVoiceGender} />
                <VoiceGrid voices={filteredVoices} selectedId={config.voiceId} onSelect={selectVoice} onPreview={onPreviewVoice} />
              </TabsContent>
              <TabsContent value="cloned" className="mt-4">
                <VoiceCloneUpload
                  podcastId={podcastId}
                  speaker={role}
                  existingVoiceId={config.clonedVoiceId}
                  existingVoiceName={config.clonedVoiceName}
                  onCloneCreated={(clone) =>
                    onChange({
                      ...config,
                      voiceMode: "cloned",
                      clonedVoiceId: clone.voiceId,
                      clonedVoiceName: clone.name,
                    })
                  }
                />
              </TabsContent>
            </Tabs>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-200">Avatar selector</h2>
            <Tabs value={avatarTab} onValueChange={(value) => value === "cloned" ? onChange({ ...config, avatarMode: "cloned" }) : selectAvatarGender(value as SpeakerGender)}>
              <TabsList className="grid w-full grid-cols-3 rounded-[8px] bg-white/10">
                <TabsTrigger value="male" className="rounded-[8px]">Male Stock</TabsTrigger>
                <TabsTrigger value="female" className="rounded-[8px]">Female Stock</TabsTrigger>
                <TabsTrigger value="cloned" className="rounded-[8px]">Clone your avatar</TabsTrigger>
              </TabsList>
              <TabsContent value="male" className="mt-4">
                <AvatarGrid avatars={filteredAvatars} selectedId={config.avatarId} onSelect={selectAvatar} />
              </TabsContent>
              <TabsContent value="female" className="mt-4">
                <AvatarGrid avatars={filteredAvatars} selectedId={config.avatarId} onSelect={selectAvatar} />
              </TabsContent>
              <TabsContent value="cloned" className="mt-4">
                <AvatarCloneUpload
                  podcastId={podcastId}
                  speaker={role}
                  existingAvatarId={config.clonedAvatarId}
                  existingAvatarName={config.clonedAvatarName}
                  existingPreviewUrl={config.clonedAvatarPreviewUrl}
                  onCloneCreated={(clone) =>
                    onChange({
                      ...config,
                      avatarMode: "cloned",
                      clonedAvatarId: clone.avatarId,
                      clonedAvatarName: clone.name,
                      clonedAvatarPreviewUrl: clone.previewImageUrl,
                    })
                  }
                />
              </TabsContent>
            </Tabs>
          </section>
        </CardContent>
      </Card>
    </motion.article>
  );
}

function GenderFilter({
  value,
  onChange,
}: {
  value: SpeakerGender;
  onChange: (gender: SpeakerGender) => void;
}) {
  return (
    <div className="flex w-fit rounded-[8px] border border-white/10 bg-white/5 p-1">
      {(["male", "female"] as const).map((gender) => (
        <button
          key={gender}
          type="button"
          onClick={() => onChange(gender)}
          className={cn(
            "rounded-[8px] px-3 py-1.5 text-xs capitalize transition-colors",
            value === gender ? "bg-amber-300 text-gray-950" : "text-gray-300 hover:bg-white/10"
          )}
        >
          {gender}
        </button>
      ))}
    </div>
  );
}

function VoiceGrid({
  voices,
  selectedId,
  onSelect,
  onPreview,
}: {
  voices: Voice[];
  selectedId?: string;
  onSelect: (voice: Voice) => void;
  onPreview: (voice: Voice) => Promise<Blob>;
}) {
  if (voices.length === 0) {
    return <p className="rounded-[8px] border border-white/10 bg-gray-950/50 px-3 py-3 text-sm text-gray-400">No voices found for this filter.</p>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {voices.map((voice) => (
        <VoiceCard key={voice.id} voice={voice} selected={selectedId === voice.id} onSelect={() => onSelect(voice)} onPreview={onPreview} />
      ))}
    </div>
  );
}

function AvatarGrid({
  avatars,
  selectedId,
  onSelect,
}: {
  avatars: Avatar[];
  selectedId?: string;
  onSelect: (avatar: Avatar) => void;
}) {
  if (avatars.length === 0) {
    return <p className="rounded-[8px] border border-white/10 bg-gray-950/50 px-3 py-3 text-sm text-gray-400">No avatars found for this filter.</p>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {avatars.map((avatar) => (
        <AvatarCard key={avatar.id} avatar={avatar} selected={selectedId === avatar.id} onSelect={() => onSelect(avatar)} />
      ))}
    </div>
  );
}

function VoiceCard({
  voice,
  selected,
  onSelect,
  onPreview,
}: {
  voice: Voice;
  selected: boolean;
  onSelect: () => void;
  onPreview: (voice: Voice) => Promise<Blob>;
}) {
  const [previewing, setPreviewing] = useState(false);
  const [streamedPreviewUrl, setStreamedPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewSource = streamedPreviewUrl ?? voice.previewUrl;

  useEffect(() => {
    return () => {
      if (streamedPreviewUrl) {
        URL.revokeObjectURL(streamedPreviewUrl);
      }
    };
  }, [streamedPreviewUrl]);

  const handlePreview = async () => {
    setPreviewing(true);
    setPreviewError(null);

    try {
      const blob = await onPreview(voice);
      const objectUrl = URL.createObjectURL(blob);
      setStreamedPreviewUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current);
        }

        return objectUrl;
      });
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "Preview failed.");
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <motion.div
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        "rounded-[8px] border p-3 text-left",
        selected ? "border-amber-300 bg-amber-300/10" : "border-white/10 bg-gray-950/50"
      )}
    >
      <button type="button" onClick={onSelect} className="w-full text-left">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <p className="font-semibold text-white">{voice.name}</p>
            <p className="text-xs uppercase tracking-[0.16em] text-gray-500">{voice.provider}{voice.accent ? ` / ${voice.accent}` : ""}</p>
          </div>
          {selected ? <Check className="size-4 text-amber-200" /> : null}
        </div>
      </button>
      <div className="space-y-2">
        {previewSource ? <audio controls src={previewSource} className="h-8 w-full" /> : null}
        <Button type="button" onClick={handlePreview} disabled={previewing} variant="outline" className="h-9 w-full rounded-[8px] border-white/10 bg-white/5 text-xs text-white hover:bg-white/10">
          {previewing ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
          Stream preview
        </Button>
        {previewError ? <p className="text-xs text-amber-100">{previewError}</p> : null}
      </div>
    </motion.div>
  );
}

function AvatarCard({
  avatar,
  selected,
  onSelect,
}: {
  avatar: Avatar;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <motion.button
      type="button"
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      onClick={onSelect}
      className={cn(
        "overflow-hidden rounded-[8px] border text-left",
        selected ? "border-amber-300 bg-amber-300/10" : "border-white/10 bg-gray-950/50"
      )}
    >
      <Image
        src={avatar.previewImageUrl ?? fallbackAvatarImage}
        alt={avatar.name}
        width={420}
        height={240}
        sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
        className="h-40 w-full object-cover"
      />
      <div className="flex items-center justify-between gap-2 p-3">
        <div>
          <p className="font-semibold text-white">{avatar.name}</p>
          <p className="text-xs uppercase tracking-[0.16em] text-gray-500">HeyGen stock</p>
        </div>
        {selected ? <Check className="size-4 text-amber-200" /> : null}
      </div>
    </motion.button>
  );
}
