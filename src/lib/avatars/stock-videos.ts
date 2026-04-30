import { existsSync } from "node:fs";
import { join } from "node:path";

const VIDEO_DIR = join(process.cwd(), "public", "stock-videos");
const AVATAR_DIR = join(process.cwd(), "public", "avatars", "default");

const normalizeRole = (role: string) => (role === "guest" ? "guest" : "host");
const normalizeGender = (gender?: string) => (gender === "female" ? "female" : "male");

export function getStockVideoPath(role: string, gender?: string): string {
  const filename = `${normalizeGender(gender)}-${normalizeRole(role)}`;
  const path = join(process.cwd(), "public", "stock-videos", `${filename}.mp4`);

  if (existsSync(path)) {
    return path;
  }

  const fallbacks = [
    join(VIDEO_DIR, "male-host.mp4"),
    join(VIDEO_DIR, "female-host.mp4"),
  ];

  for (const fallback of fallbacks) {
    if (existsSync(fallback)) {
      return fallback;
    }
  }

  throw new Error(`No stock video found for ${filename}. Run download script.`);
}

export function getAvatarImagePath(role: string, gender?: string): string {
  const key = `${normalizeGender(gender)}-${normalizeRole(role)}`;
  const path = join(AVATAR_DIR, `${key}.jpg`);

  if (existsSync(path)) {
    return path;
  }

  const fallback = join(AVATAR_DIR, "male-host.jpg");

  if (existsSync(fallback)) {
    return fallback;
  }

  throw new Error("No avatar image found. Run: npm run download-avatars");
}
