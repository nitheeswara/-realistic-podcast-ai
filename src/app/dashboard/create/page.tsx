"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { SubmitHandler } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { db } from "@/config/firebase-client";
import { useAuth } from "@/hooks/useAuth";
import { languageOptions, podcastFormatOptions } from "@/lib/podcast/constants";
import { createPodcastSchema } from "@/lib/podcast/schemas";
import type { CreatePodcastInput } from "@/lib/podcast/schemas";
import { cn } from "@/lib/utils";

const stepVariants = {
  initial: { opacity: 0, x: 28 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -28 },
};

const defaultValues: CreatePodcastInput = {
  topic: "",
  audience: "",
  format: "educational",
  language: "english",
  durationMinutes: 5,
  tone: "Warm, premium, and conversational",
  keywords: [],
  avoid: "",
};

export default function CreatePodcastPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [step, setStep] = useState<1 | 2>(1);
  const [keywordText, setKeywordText] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    control,
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<CreatePodcastInput>({
    resolver: zodResolver(createPodcastSchema),
    defaultValues,
  });

  const selectedFormat = useWatch({ control, name: "format" });
  const selectedLanguage = useWatch({ control, name: "language" });
  const durationMinutes = useWatch({ control, name: "durationMinutes" });

  const groupedLanguages = useMemo(
    () => ({
      Indian: languageOptions.filter((language) => language.group === "Indian"),
      Global: languageOptions.filter((language) => language.group === "Global"),
    }),
    []
  );

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, router, user]);

  const goToStepTwo = async () => {
    const valid = await trigger(["topic", "audience", "format"]);
    if (valid) {
      setStep(2);
    }
  };

  const onSubmit: SubmitHandler<CreatePodcastInput> = async (values) => {
    if (!user) {
      setSubmitError("Sign in before creating a podcast.");
      return;
    }

    setSubmitError(null);

    const normalizedKeywords = keywordText
      .split(",")
      .map((keyword) => keyword.trim())
      .filter((keyword) => keyword.length > 0)
      .slice(0, 20);

    const parsed = createPodcastSchema.safeParse({
      ...values,
      keywords: normalizedKeywords,
    });

    if (!parsed.success) {
      setSubmitError("Check the brief. A field needs a little more detail.");
      return;
    }

    const podcastRef = doc(collection(db, "podcasts"));

    await setDoc(podcastRef, {
      id: podcastRef.id,
      ...parsed.data,
      userId: user.uid,
      ownerId: user.uid,
      title: parsed.data.topic,
      description: `${parsed.data.format} podcast for ${parsed.data.audience}`,
      status: "draft",
      speakers: [],
      creditsSpent: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    router.push(`/dashboard/podcasts/${podcastRef.id}/script`);
  };

  if (loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <p className="text-sm text-gray-400">Opening the studio brief...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 px-4 py-8 text-white sm:px-6 lg:px-8">
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <div className="flex flex-col gap-3">
          <p className="w-fit rounded-[8px] border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">
            New production
          </p>
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
                Create a podcast brief
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-400">
                Give the AI a tight creative direction before the script room opens.
              </p>
            </div>
            <div className="flex gap-2 text-xs text-gray-400">
              <span className={cn("rounded-[8px] px-3 py-2", step === 1 ? "bg-amber-300 text-gray-950" : "bg-white/5")}>
                1 Brief
              </span>
              <span className={cn("rounded-[8px] px-3 py-2", step === 2 ? "bg-amber-300 text-gray-950" : "bg-white/5")}>
                2 Direction
              </span>
            </div>
          </div>
        </div>

        <Card className="rounded-[8px] border border-white/10 bg-white/[0.04] py-0 text-white ring-1 ring-white/5">
          <CardContent className="p-6">
            <form onSubmit={handleSubmit(onSubmit)}>
              <AnimatePresence mode="wait">
                {step === 1 ? (
                  <motion.div
                    key="step-one"
                    variants={stepVariants}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    transition={{ duration: 0.28, ease: "easeOut" }}
                    className="space-y-6"
                  >
                    <div className="grid gap-5 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-200" htmlFor="topic">
                          Topic
                        </label>
                        <Input
                          id="topic"
                          placeholder="Example: The future of electric vehicles in India"
                          className="h-11 rounded-[8px] border-white/10 bg-white/5 text-sm text-white placeholder:text-gray-500 focus-visible:border-amber-300/70"
                          aria-invalid={Boolean(errors.topic)}
                          {...register("topic")}
                        />
                        {errors.topic ? <p className="text-sm text-red-300">{errors.topic.message}</p> : null}
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-200" htmlFor="audience">
                          Audience
                        </label>
                        <Input
                          id="audience"
                          placeholder="Example: urban professionals, founders, students"
                          className="h-11 rounded-[8px] border-white/10 bg-white/5 text-sm text-white placeholder:text-gray-500 focus-visible:border-amber-300/70"
                          aria-invalid={Boolean(errors.audience)}
                          {...register("audience")}
                        />
                        {errors.audience ? <p className="text-sm text-red-300">{errors.audience.message}</p> : null}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="text-sm font-medium text-gray-200">Format</label>
                      <div className="grid gap-3 md:grid-cols-3">
                        {podcastFormatOptions.map((format) => (
                          <motion.button
                            key={format.value}
                            type="button"
                            whileHover={{ y: -3 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => setValue("format", format.value, { shouldValidate: true })}
                            className={cn(
                              "min-h-36 rounded-[8px] border p-4 text-left transition-colors",
                              selectedFormat === format.value
                                ? "border-amber-300 bg-amber-300/10 text-white"
                                : "border-white/10 bg-white/[0.03] text-gray-300 hover:border-white/25"
                            )}
                          >
                            <div className="mb-6 flex items-center justify-between">
                              <span className="text-lg font-semibold text-white">{format.label}</span>
                              {selectedFormat === format.value ? <Check className="size-4 text-amber-200" /> : null}
                            </div>
                            <p className="text-sm leading-6 text-gray-400">{format.description}</p>
                          </motion.button>
                        ))}
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <Button
                        type="button"
                        onClick={goToStepTwo}
                        className="h-11 rounded-[8px] bg-amber-300 px-5 text-sm font-semibold text-gray-950 hover:bg-amber-200"
                      >
                        Continue
                        <ArrowRight className="size-4" />
                      </Button>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="step-two"
                    variants={stepVariants}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    transition={{ duration: 0.28, ease: "easeOut" }}
                    className="space-y-6"
                  >
                    <div className="grid gap-5 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-200">Language</label>
                        <Select
                          value={selectedLanguage}
                          onValueChange={(value) =>
                            setValue("language", value as CreatePodcastInput["language"], {
                              shouldValidate: true,
                            })
                          }
                        >
                          <SelectTrigger className="h-11 w-full rounded-[8px] border-white/10 bg-white/5 text-sm text-white">
                            <SelectValue placeholder="Select language" />
                          </SelectTrigger>
                          <SelectContent className="rounded-[8px] border-white/10 bg-gray-950 text-white">
                            <SelectGroup>
                              <SelectLabel>Indian</SelectLabel>
                              {groupedLanguages.Indian.map((language) => (
                                <SelectItem key={language.value} value={language.value}>
                                  {language.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                            <SelectGroup>
                              <SelectLabel>Global</SelectLabel>
                              {groupedLanguages.Global.map((language) => (
                                <SelectItem key={language.value} value={language.value}>
                                  {language.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-medium text-gray-200" htmlFor="durationMinutes">
                            Duration
                          </label>
                          <span className="rounded-[8px] bg-white/10 px-2 py-1 text-xs text-amber-100">
                            {durationMinutes} min
                          </span>
                        </div>
                        <input
                          id="durationMinutes"
                          type="range"
                          min={1}
                          max={15}
                          step={1}
                          value={durationMinutes}
                          onChange={(event) =>
                            setValue("durationMinutes", Number(event.target.value), {
                              shouldValidate: true,
                            })
                          }
                          className="h-2 w-full accent-amber-300"
                        />
                      </div>
                    </div>

                    <div className="grid gap-5 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-200" htmlFor="tone">
                          Tone
                        </label>
                        <Input
                          id="tone"
                          placeholder="Energetic, witty, serious, premium"
                          className="h-11 rounded-[8px] border-white/10 bg-white/5 text-sm text-white placeholder:text-gray-500 focus-visible:border-amber-300/70"
                          aria-invalid={Boolean(errors.tone)}
                          {...register("tone")}
                        />
                        {errors.tone ? <p className="text-sm text-red-300">{errors.tone.message}</p> : null}
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-200" htmlFor="keywords">
                          Keywords
                        </label>
                        <Input
                          id="keywords"
                          value={keywordText}
                          onChange={(event) => setKeywordText(event.target.value)}
                          placeholder="comma, separated, ideas"
                          className="h-11 rounded-[8px] border-white/10 bg-white/5 text-sm text-white placeholder:text-gray-500 focus-visible:border-amber-300/70"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-200" htmlFor="avoid">
                        Avoid
                      </label>
                      <Textarea
                        id="avoid"
                        placeholder="Things the episode should avoid saying or doing"
                        className="min-h-28 rounded-[8px] border-white/10 bg-white/5 text-sm text-white placeholder:text-gray-500 focus-visible:border-amber-300/70"
                        {...register("avoid")}
                      />
                      {errors.avoid ? <p className="text-sm text-red-300">{errors.avoid.message}</p> : null}
                    </div>

                    {submitError ? (
                      <p className="rounded-[8px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                        {submitError}
                      </p>
                    ) : null}

                    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setStep(1)}
                        className="h-11 rounded-[8px] border-white/10 bg-white/5 px-5 text-sm text-white hover:bg-white/10"
                      >
                        <ArrowLeft className="size-4" />
                        Back
                      </Button>
                      <Button
                        type="submit"
                        disabled={isSubmitting}
                        className="h-11 rounded-[8px] bg-amber-300 px-5 text-sm font-semibold text-gray-950 hover:bg-amber-200"
                      >
                        {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
                        Create script room
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </form>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}


