import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const AVATAR_DIR = join(process.cwd(), "public", "avatars", "default");

export function getLocalAvatarPath(role: string, gender?: string): string {
  const normalizedRole = role === "guest" ? "guest" : "host";
  const normalizedGender = gender === "female" ? "female" : "male";
  const filename = `${normalizedGender}-${normalizedRole}.jpg`;
  const fullPath = join(AVATAR_DIR, filename);
  const fallbacks = [
    fullPath,
    join(AVATAR_DIR, "male-host.jpg"),
    join(AVATAR_DIR, "female-host.jpg"),
  ];

  for (const path of fallbacks) {
    if (existsSync(path)) {
      return path;
    }
  }

  throw new Error("No avatar image found. Run: npm run download-avatars");
}

export async function getAvatarCloudinaryUrl(
  role: string,
  gender?: string
): Promise<string> {
  const { uploadImage } = await import("@/lib/server/storage");
  const localPath = getLocalAvatarPath(role, gender);
  const buffer = await readFile(localPath);
  const normalizedRole = role === "guest" ? "guest" : "host";
  const normalizedGender = gender === "female" ? "female" : "male";
  const filename = `avatar-${normalizedRole}-${normalizedGender}.jpg`;
  const result = await uploadImage(buffer, "avatars/default", filename);

  return result.url;
}

