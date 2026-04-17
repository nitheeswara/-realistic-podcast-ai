"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { CheckCircle2, ImagePlus, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/useAuth";
import type { SpeakerRole } from "@/types/voice";

interface AvatarCloneUploadProps {
  podcastId: string;
  speaker: SpeakerRole;
  existingAvatarId?: string;
  existingAvatarName?: string;
  existingPreviewUrl?: string;
  onCloneCreated: (clone: { avatarId: string; name: string; previewImageUrl?: string }) => void;
}

const photoRules = [
  "Clear front-facing photo looking at camera.",
  "Good even lighting with no harsh shadows.",
  "No sunglasses or face coverings.",
  "Plain or simple background preferred.",
  "Minimum 512x512 pixels.",
  "Maximum file size: 10 MB.",
  "JPG or PNG only.",
] as const;

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

export function AvatarCloneUpload({
  podcastId,
  speaker,
  existingAvatarId,
  existingAvatarName,
  existingPreviewUrl,
  onCloneCreated,
}: AvatarCloneUploadProps) {
  const { user } = useAuth();
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(existingPreviewUrl ?? null);
  const [createdAvatarId, setCreatedAvatarId] = useState(existingAvatarId ?? null);
  const [createdAvatarName, setCreatedAvatarName] = useState(existingAvatarName ?? null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const setSelectedFile = (file: File) => {
    setError(null);

    if (!file.type.includes("jpeg") && !file.type.includes("jpg") && !file.type.includes("png")) {
      setError("Upload a JPG or PNG image.");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError("Image file must be 10MB or smaller.");
      return;
    }

    if (previewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrl);
    }

    setImageFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const uploadClone = async () => {
    if (!user || !imageFile) {
      setError("Choose a photo before creating the avatar clone.");
      return;
    }

    setUploading(true);
    setProgress(20);
    setError(null);

    const timer = window.setInterval(() => {
      setProgress((current) => Math.min(current + 10, 85));
    }, 450);

    try {
      const token = await user.getIdToken();
      const formData = new FormData();
      formData.append("image", imageFile);
      formData.append("podcastId", podcastId);
      formData.append("speaker", speaker);

      const response = await fetch("/api/cloning/avatar", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "Avatar clone creation failed."));
      }

      const payload: unknown = await response.json();
      const avatarId =
        typeof payload === "object" &&
        payload !== null &&
        "avatarId" in payload &&
        typeof (payload as { avatarId: unknown }).avatarId === "string"
          ? (payload as { avatarId: string }).avatarId
          : null;
      const name =
        typeof payload === "object" &&
        payload !== null &&
        "name" in payload &&
        typeof (payload as { name: unknown }).name === "string"
          ? (payload as { name: string }).name
          : `${podcastId}_${speaker}_avatar`;
      const providerPreview =
        typeof payload === "object" &&
        payload !== null &&
        "previewImageUrl" in payload &&
        typeof (payload as { previewImageUrl: unknown }).previewImageUrl === "string"
          ? (payload as { previewImageUrl: string }).previewImageUrl
          : undefined;

      if (!avatarId) {
        throw new Error("The avatar provider did not return an avatar id.");
      }

      if (providerPreview) {
        setPreviewUrl(providerPreview);
      }

      setCreatedAvatarId(avatarId);
      setCreatedAvatarName(name);
      onCloneCreated({ avatarId, name, previewImageUrl: providerPreview ?? previewUrl ?? undefined });
      setProgress(100);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Avatar clone creation failed.");
    } finally {
      window.clearInterval(timer);
      setUploading(false);
    }
  };

  return (
    <Card className="rounded-[8px] border border-white/10 bg-gray-950/60 py-0 text-white">
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-white">Clone your avatar</p>
            <p className="text-xs text-gray-400">JPG/PNG, max 10MB.</p>
          </div>
          {createdAvatarId ? (
            <Badge className="rounded-[8px] border-emerald-300/30 bg-emerald-300/10 text-emerald-100" variant="outline">
              <CheckCircle2 className="size-3.5" />
              Clone ready
            </Badge>
          ) : null}
        </div>

        <label
          className="relative flex min-h-48 cursor-pointer items-center justify-center overflow-hidden rounded-[8px] border border-dashed border-white/15 bg-white/[0.03] text-center text-sm text-gray-300 hover:bg-white/[0.06]"
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files.item(0);
            if (file) {
              setSelectedFile(file);
            }
          }}
          onDragOver={(event) => event.preventDefault()}
        >
          {previewUrl ? (
            <Image src={previewUrl} alt="Avatar clone preview" fill sizes="320px" className="object-cover" unoptimized={previewUrl.startsWith("blob:")} />
          ) : (
            <span className="flex flex-col items-center gap-2 p-4">
              <ImagePlus className="size-7 text-amber-200" />
              Drop photo here or choose a file
            </span>
          )}
          <input
            type="file"
            accept="image/jpeg,image/png,.jpg,.jpeg,.png"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.item(0);
              if (file) {
                setSelectedFile(file);
              }
            }}
          />
        </label>

        <div className="grid gap-2 text-xs text-gray-300 sm:grid-cols-2">
          {photoRules.map((rule) => (
            <div key={rule} className="flex gap-2 rounded-[8px] bg-white/[0.03] p-2">
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-300" />
              {rule}
            </div>
          ))}
        </div>

        {uploading ? <Progress value={progress} className="bg-white/10" /> : null}
        {error ? <p className="rounded-[8px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}

        <Button
          type="button"
          onClick={uploadClone}
          disabled={uploading || !imageFile}
          className="h-10 w-full rounded-[8px] bg-amber-300 text-sm font-semibold text-gray-950 hover:bg-amber-200"
        >
          {uploading ? <Loader2 className="size-4 animate-spin" /> : null}
          Create avatar clone
        </Button>

        {createdAvatarName ? <p className="text-xs text-emerald-200">Ready: {createdAvatarName}</p> : null}
      </CardContent>
    </Card>
  );
}
