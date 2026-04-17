import type { SpeakerGender } from "@/types/voice";

export type AvatarMode = "stock" | "premium" | "cloned";

export interface Avatar {
  id: string;
  name: string;
  provider: "heygen" | "did" | "synclabs" | "custom";
  mode: AvatarMode;
  gender: SpeakerGender;
  previewImageUrl?: string;
  previewVideoUrl?: string;
  externalAvatarId?: string;
}
