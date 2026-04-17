"use client";

import { Bot, Check, CopyPlus, Mic, Sparkles, UserRound, UsersRound } from "lucide-react";
import type { ElementType } from "react";

import { cn } from "@/lib/utils";

export type CloningPresetId =
  | "full_ai"
  | "clone_host"
  | "clone_guest"
  | "clone_both"
  | "clone_host_voice"
  | "clone_guest_avatar"
  | "custom";

interface CloningModeSelectorProps {
  value: CloningPresetId;
  onChange: (value: CloningPresetId) => void;
}

const presets = [
  {
    id: "full_ai",
    label: "Full AI",
    description: "AI voices and stock avatars for both speakers.",
    icon: Bot,
  },
  {
    id: "clone_host",
    label: "Clone Host",
    description: "Host voice and avatar cloned; guest stays AI.",
    icon: UserRound,
  },
  {
    id: "clone_guest",
    label: "Clone Guest",
    description: "Guest voice and avatar cloned; host stays AI.",
    icon: UsersRound,
  },
  {
    id: "clone_both",
    label: "Clone Both",
    description: "Clone voice and avatar for host and guest.",
    icon: CopyPlus,
  },
  {
    id: "clone_host_voice",
    label: "Clone Host Voice Only",
    description: "Host voice cloned with stock avatar coverage.",
    icon: Mic,
  },
  {
    id: "clone_guest_avatar",
    label: "Clone Guest Avatar Only",
    description: "Guest avatar cloned while voices stay AI.",
    icon: Sparkles,
  },
  {
    id: "custom",
    label: "Custom",
    description: "Configure every voice and avatar slot independently.",
    icon: Sparkles,
  },
] as const satisfies ReadonlyArray<{
  id: CloningPresetId;
  label: string;
  description: string;
  icon: ElementType;
}>;

export function CloningModeSelector({ value, onChange }: CloningModeSelectorProps) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {presets.map((preset) => {
        const Icon = preset.icon;
        const selected = preset.id === value;

        return (
          <button
            key={preset.id}
            type="button"
            onClick={() => onChange(preset.id)}
            className={cn(
              "min-h-32 rounded-[8px] border p-4 text-left transition-colors",
              selected
                ? "border-amber-300 bg-amber-300/10 ring-2 ring-amber-300/25"
                : "border-white/10 bg-white/[0.035] hover:border-white/25"
            )}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="flex size-10 items-center justify-center rounded-[8px] bg-white/10 text-amber-100">
                <Icon className="size-5" />
              </span>
              {selected ? <Check className="size-4 text-amber-200" /> : null}
            </div>
            <p className="font-semibold text-white">{preset.label}</p>
            <p className="mt-2 text-sm leading-5 text-gray-400">{preset.description}</p>
          </button>
        );
      })}
    </div>
  );
}
