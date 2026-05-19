"use client";

import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { motion } from "framer-motion";
import { Check, Loader2, Play, Sparkles } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { db } from "@/config/firebase-client";
import { useAuth } from "@/hooks/useAuth";
import { languageOptions } from "@/lib/podcast/constants";
import { SARVAM_VOICES_V2, isIndianLanguage } from "@/lib/podcast/language-config";
import { speakerConfigSchema } from "@/lib/podcast/schemas";
import { cn } from "@/lib/utils";
import type { SpeakerConfig, SpeakerGender, SpeakerRole, Voice } from "@/types/voice";

type ProviderTab = "elevenlabs" | "sarvam";
type GenderFilter = "all" | "male" | "female";

interface VoiceListResponse {
  voices?: Voice[];
  elevenLabsConfigured?: boolean;
  error?: string;
}

interface PodcastVoiceDocument {
  title?: unknown;
  language?: unknown;
  ownerId?: unknown;
  host?: unknown;
  guest?: unknown;
}

const getParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const SARVAM_VOICES = SARVAM_VOICES_V2;

const findLanguageOption = (language: string) => {
  const direct = languageOptions.find((item) => item.value === language);
  if (direct) {
    return direct;
  }

  const base = language.toLowerCase().split("-")[0] ?? language;
  return languageOptions.find((item) => item.code.toLowerCase().startsWith(base));
};

const languageCodeFor = (language: string) => {
  const option = findLanguageOption(language);
  return option?.code ?? language;
};

const languageLabelFor = (language: string) => {
  const option = findLanguageOption(language);
  return option?.label ?? language;
};

const sarvamVoicesFor = (language: string): Voice[] => {
  const languageCode = languageCodeFor(language);
  const label = languageLabelFor(language);

  return SARVAM_VOICES.map((voice) => ({
    id: voice.id,
    name: voice.name,
    provider: "sarvam",
    mode: "ai_stock",
    gender: voice.gender,
    languageCode,
    accent: label,
    externalVoiceId: voice.externalVoiceId,
  }));
};

const compactSpeaker = (role: SpeakerRole, voice: Voice): SpeakerConfig => ({
  id: role,
  role,
  name: role === "host" ? "Host" : "Guest",
  gender: voice.gender,
  voiceMode: voice.mode,
  voiceId: voice.id,
  voice: {
    id: voice.id,
    name: voice.name,
    provider: voice.provider,
    mode: voice.mode,
    gender: voice.gender,
    languageCode: voice.languageCode,
    ...(voice.accent ? { accent: voice.accent } : {}),
    ...(voice.previewUrl ? { previewUrl: voice.previewUrl } : {}),
    ...(voice.externalVoiceId ? { externalVoiceId: voice.externalVoiceId } : {}),
  },
});

const selectedVoiceFromSpeaker = (value: unknown, fallback: Voice) => {
  const parsed = speakerConfigSchema.safeParse(value);
  return parsed.success && parsed.data.voice ? parsed.data.voice : fallback;
};

const voicesForTab = ({
  elevenLabsVoices,
  language,
  tab,
}: {
  elevenLabsVoices: Voice[];
  language: string;
  tab: ProviderTab;
}) => {
  if (tab === "sarvam") {
    return sarvamVoicesFor(language);
  }

  return elevenLabsVoices;
};

export default function VoiceSelectionPage() {
  const params = useParams();
  const router = useRouter();
  const podcastId = getParam(params.podcastId);
  const { user, loading } = useAuth();
  const [title, setTitle] = useState("Untitled podcast");
  const [language, setLanguage] = useState("english");
  const [hostVoice, setHostVoice] = useState<Voice>(sarvamVoicesFor("english")[0]!);
  const [guestVoice, setGuestVoice] = useState<Voice>(sarvamVoicesFor("english")[3]!);
  const [hostTab, setHostTab] = useState<ProviderTab>("elevenlabs");
  const [guestTab, setGuestTab] = useState<ProviderTab>("elevenlabs");
  const [hostGenderFilter, setHostGenderFilter] = useState<GenderFilter>("all");
  const [guestGenderFilter, setGuestGenderFilter] = useState<GenderFilter>("all");
  const [elevenLabsVoices, setElevenLabsVoices] = useState<Voice[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const isIndianLang = isIndianLanguage(language);

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
        const [podcastSnapshot, voicesResponse] = await Promise.all([
          getDoc(doc(db, "podcasts", podcastId)),
          fetch("/api/voices/list"),
        ]);

        if (!podcastSnapshot.exists()) {
          setMessage("Podcast not found.");
          return;
        }

        const data = podcastSnapshot.data() as PodcastVoiceDocument;

        if (data.ownerId !== user.uid) {
          setMessage("This podcast belongs to another account.");
          return;
        }

        const voicePayload = await voicesResponse.json() as VoiceListResponse;
        const loadedElevenLabsVoices = Array.isArray(voicePayload.voices)
          ? voicePayload.voices.filter((voice) => voice.provider === "elevenlabs")
          : [];

        const nextLanguage = typeof data.language === "string" ? data.language : "english";
        const isIndian = isIndianLanguage(nextLanguage);
        const sarvamDefaults = sarvamVoicesFor(nextLanguage);
        const sarvamHost = sarvamDefaults.find((voice) => voice.gender === "male") ?? sarvamDefaults[0]!;
        const sarvamGuest = sarvamDefaults.find((voice) => voice.gender === "female") ?? sarvamDefaults[0]!;
        const elevenHost = loadedElevenLabsVoices[0] ?? sarvamHost;
        const elevenGuest = loadedElevenLabsVoices[1] ?? loadedElevenLabsVoices[0] ?? sarvamGuest;
        setTitle(typeof data.title === "string" ? data.title : "Untitled podcast");
        setLanguage(nextLanguage);
        setElevenLabsVoices(loadedElevenLabsVoices);
        setHostVoice(selectedVoiceFromSpeaker(data.host, isIndian ? sarvamHost : elevenHost));
        setGuestVoice(selectedVoiceFromSpeaker(data.guest, isIndian ? sarvamGuest : elevenGuest));
      } catch {
        setMessage("Could not load voices. AI is busy, retrying may help.");
      } finally {
        setPageLoading(false);
      }
    };

    void loadPodcast();
  }, [podcastId, user]);

  const availableTabs = useMemo(() => {
    return isIndianLang ? ["sarvam"] : ["elevenlabs"];
  }, [isIndianLang]);

  useEffect(() => {
    if (!availableTabs.includes(hostTab)) {
      setHostTab(availableTabs[0]!);
    }

    if (!availableTabs.includes(guestTab)) {
      setGuestTab(availableTabs[0]!);
    }
  }, [availableTabs, guestTab, hostTab]);

  const previewVoice = async (voice: Voice) => {
    if (previewing) {
      return;
    }

    setPreviewing(voice.id);
    setMessage(null);

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    try {
      const response = await fetch("/api/voices/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voiceId: voice.id,
          provider: voice.provider,
          language: voice.languageCode,
          speaker: voice.externalVoiceId,
          text: "Hello, this is a quick preview for your podcast.",
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? "Preview failed.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;

      let cleanedUp = false;
      const cleanup = () => {
        if (cleanedUp) {
          return;
        }

        cleanedUp = true;
        URL.revokeObjectURL(url);
        if (audioRef.current === audio) {
          audioRef.current = null;
        }
        setPreviewing(null);
      };

      audio.addEventListener("ended", cleanup, { once: true });
      window.setTimeout(() => {
        audio.pause();
        cleanup();
      }, 5000);
      await audio.play();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Preview failed.");
      setPreviewing(null);
    }
  };

  const generatePodcast = async () => {
    if (!user || !podcastId) {
      return;
    }

    setGenerating(true);
    setMessage(null);

    try {
      const podcastRef = doc(db, "podcasts", podcastId);
      const host = compactSpeaker("host", hostVoice);
      const guest = compactSpeaker("guest", guestVoice);

      await updateDoc(podcastRef, {
        host,
        guest,
        speakers: [host, guest],
        status: "configuring",
        updatedAt: serverTimestamp(),
      });

      const token = await user.getIdToken();
      const response = await fetch("/api/podcast/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ podcastId }),
      });
      const payload = await response.json() as { jobId?: string; error?: string };

      if (!response.ok || !payload.jobId) {
        throw new Error(payload.error ?? "Could not start audio generation.");
      }

      router.push(`/dashboard/podcasts/${podcastId}/generating?jobId=${payload.jobId}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start audio generation.");
    } finally {
      setGenerating(false);
    }
  };

  if (loading || pageLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <Loader2 className="size-5 animate-spin text-amber-200" />
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
              Voice selection
            </p>
            <div>
              <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">{title}</h1>
              <p className="mt-3 text-sm uppercase tracking-[0.18em] text-gray-500">
                {languageLabelFor(language)}
              </p>
            </div>
          </div>
          <Button
            type="button"
            onClick={generatePodcast}
            disabled={generating}
            className="h-11 rounded-[8px] bg-amber-300 px-5 text-sm font-semibold text-gray-950 hover:bg-amber-200"
          >
            {generating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Generate Podcast Audio
          </Button>
        </motion.header>

        {message ? (
          <p className="rounded-[8px] border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
            {message}
          </p>
        ) : null}

        <div className="rounded-[8px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-gray-300">
          {isIndianLang
            ? "Sarvam AI voices are used for Tamil/Hindi/Telugu etc."
            : "ElevenLabs voices selected for global languages"}
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <SpeakerVoiceColumn
            activeTab={hostTab}
            availableTabs={availableTabs}
            elevenLabsVoices={elevenLabsVoices}
            language={language}
            genderFilter={hostGenderFilter}
            onGenderFilterChange={setHostGenderFilter}
            onPreview={(voice) => void previewVoice(voice)}
            onSelect={setHostVoice}
            previewing={previewing}
            role="host"
            selectedVoice={hostVoice}
            setActiveTab={setHostTab}
          />
          <SpeakerVoiceColumn
            activeTab={guestTab}
            availableTabs={availableTabs}
            elevenLabsVoices={elevenLabsVoices}
            language={language}
            genderFilter={guestGenderFilter}
            onGenderFilterChange={setGuestGenderFilter}
            onPreview={(voice) => void previewVoice(voice)}
            onSelect={setGuestVoice}
            previewing={previewing}
            role="guest"
            selectedVoice={guestVoice}
            setActiveTab={setGuestTab}
          />
        </div>
      </section>
    </main>
  );
}

function SpeakerVoiceColumn({
  activeTab,
  availableTabs,
  elevenLabsVoices,
  language,
  genderFilter,
  onGenderFilterChange,
  onPreview,
  onSelect,
  previewing,
  role,
  selectedVoice,
  setActiveTab,
}: {
  activeTab: ProviderTab;
  availableTabs: ProviderTab[];
  elevenLabsVoices: Voice[];
  language: string;
  genderFilter: GenderFilter;
  onGenderFilterChange: (value: GenderFilter) => void;
  onPreview: (voice: Voice) => void;
  onSelect: (voice: Voice) => void;
  previewing: string | null;
  role: SpeakerRole;
  selectedVoice: Voice;
  setActiveTab: (tab: ProviderTab) => void;
}) {
  const voices = voicesForTab({ elevenLabsVoices, language, tab: activeTab });
  const filteredVoices = voices.filter((voice) => {
    if (genderFilter === "all") {
      return true;
    }
    return voice.gender === genderFilter;
  });

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-[8px] border border-white/10 bg-white/[0.035] p-4 ring-1 ring-white/5"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
            {role}
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-white">
            {role === "host" ? "Host" : "Guest"}
          </h2>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "rounded-[8px] border",
            role === "host"
              ? "border-amber-300/30 bg-amber-300/10 text-amber-100"
              : "border-violet-300/30 bg-violet-300/10 text-violet-100"
          )}
        >
          {selectedVoice.name}
        </Badge>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ProviderTab)}>
        <TabsList className="rounded-[8px] border border-white/10 bg-gray-950/80 p-1">
          {availableTabs.includes("elevenlabs") ? (
            <TabsTrigger className="rounded-[6px] px-3 text-gray-300 data-active:bg-white/10 data-active:text-white" value="elevenlabs">
              ElevenLabs
            </TabsTrigger>
          ) : null}
          {availableTabs.includes("sarvam") ? (
            <TabsTrigger className="rounded-[6px] px-3 text-gray-300 data-active:bg-white/10 data-active:text-white" value="sarvam">
              Sarvam
            </TabsTrigger>
          ) : null}
        </TabsList>

        {availableTabs.map((tab) => (
          <TabsContent key={tab} value={tab} className="mt-4">
            <div className="mb-3 flex items-center gap-2">
              {(["all", "male", "female"] as GenderFilter[]).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => onGenderFilterChange(filter)}
                  className={cn(
                    "rounded-[8px] border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em]",
                    genderFilter === filter
                      ? "border-emerald-300/40 bg-emerald-300/15 text-emerald-100"
                      : "border-white/10 bg-white/5 text-gray-400 hover:border-white/25"
                  )}
                >
                  {filter}
                </button>
              ))}
            </div>
            {filteredVoices.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {filteredVoices.map((voice) => (
                  <VoiceCard
                    key={voice.id}
                    isSelected={selectedVoice.id === voice.id}
                    onPreview={() => onPreview(voice)}
                    onSelect={() => onSelect(voice)}
                    previewing={previewing === voice.id}
                    role={role}
                    voice={voice}
                  />
                ))}
              </div>
            ) : (
              <div className="flex min-h-40 items-center justify-center rounded-[8px] border border-white/10 bg-gray-950/60 px-4 text-center text-sm text-gray-400">
                No voices available for this filter.
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </motion.section>
  );
}

function VoiceCard({
  isSelected,
  onPreview,
  onSelect,
  previewing,
  role,
  voice,
}: {
  isSelected: boolean;
  onPreview: () => void;
  onSelect: () => void;
  previewing: boolean;
  role: SpeakerRole;
  voice: Voice;
}) {
  return (
    <div
      className={cn(
        "relative flex min-h-32 flex-col justify-between rounded-[8px] border p-4 text-left transition",
        isSelected
          ? "border-emerald-300/60 bg-emerald-300/10"
          : "border-white/10 bg-gray-950/60 hover:border-white/25 hover:bg-white/[0.06]"
      )}
    >
      {isSelected ? (
        <span className="absolute right-3 top-3 inline-flex size-5 items-center justify-center rounded-full bg-emerald-300/20 text-emerald-200">
          <Check className="size-4" />
        </span>
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-semibold text-white">{voice.name}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="outline" className="rounded-[8px] border-white/10 bg-white/5 text-xs capitalize text-gray-200">
              {voice.gender}
            </Badge>
            <Badge variant="outline" className="rounded-[8px] border-white/10 bg-white/5 text-xs text-gray-200">
              {voice.accent ?? voice.languageCode}
            </Badge>
            <Badge variant="outline" className="rounded-[8px] border-white/10 bg-white/5 text-xs uppercase text-gray-300">
              {voice.provider}
            </Badge>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-[0.16em] text-gray-500">Preview</span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onSelect}
            className="h-9 rounded-[8px] border-white/10 bg-white/5 px-3 text-xs text-white hover:bg-white/10"
          >
            {isSelected ? "Selected" : "Select"}
          </Button>
          <button
            type="button"
          onClick={(event) => {
            event.stopPropagation();
            onPreview();
          }}
            className="inline-flex size-9 items-center justify-center rounded-[8px] border border-white/10 bg-white/5 text-white hover:bg-white/10"
            aria-label={`Preview ${voice.name}`}
          >
            {previewing ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
