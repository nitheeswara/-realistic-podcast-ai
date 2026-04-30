import { copyFile } from "node:fs/promises";
import { join } from "node:path";

import { getLocalAvatarPath } from "@/lib/avatars/local-avatars";
import type { SpeakerConfig, SpeakerGender, SpeakerRole } from "@/types/voice";

export const getSpeakerGender = (speaker: SpeakerConfig): SpeakerGender => {
  if (speaker.gender) {
    return speaker.gender;
  }

  if (speaker.avatar?.gender) {
    return speaker.avatar.gender;
  }

  if (speaker.voice?.gender) {
    return speaker.voice.gender;
  }

  return speaker.role === "host" ? "male" : "female";
};

export const getDefaultAvatarUrl = (role: SpeakerRole, gender: SpeakerGender) =>
  getLocalAvatarPath(role, gender);

export const getSpeakerAvatarImageUrl = (speaker: SpeakerConfig) =>
  getLocalAvatarPath(speaker.role, getSpeakerGender(speaker));

export const downloadAvatarImage = async (
  speaker: SpeakerConfig,
  tempDir: string
): Promise<string> => {
  const outputPath = join(tempDir, `avatar_${speaker.role}.jpg`);
  await copyFile(getSpeakerAvatarImageUrl(speaker), outputPath);
  return outputPath;
};
