import { spawn } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import ffmpegStatic from "ffmpeg-static";

const AVATAR_DIR = join(process.cwd(), "public", "avatars", "default");
const STOCK_VIDEO_DIR = join(process.cwd(), "public", "stock-videos");

const AVATARS = [
  {
    name: "male-host.jpg",
    url: "https://randomuser.me/api/portraits/men/32.jpg",
  },
  {
    name: "male-guest.jpg",
    url: "https://randomuser.me/api/portraits/men/45.jpg",
  },
  {
    name: "female-host.jpg",
    url: "https://randomuser.me/api/portraits/women/44.jpg",
  },
  {
    name: "female-guest.jpg",
    url: "https://randomuser.me/api/portraits/women/68.jpg",
  },
  {
    name: "../backgrounds/studio.jpg",
    url: "https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?w=1280&q=80&fm=jpg",
  },
];

const STOCK_VIDEOS = [
  "male-host",
  "male-guest",
  "female-host",
  "female-guest",
] as const;

const resolveFfmpegPath = () => ffmpegStatic ?? "ffmpeg";

const outputPathFor = (name: string) => {
  if (name.startsWith("../backgrounds/")) {
    return join(process.cwd(), "public", "backgrounds", basename(name));
  }

  return join(AVATAR_DIR, name);
};

const runFfmpeg = async (args: string[]) => {
  const binary = resolveFfmpegPath();

  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"] });
    const stderr: Buffer[] = [];

    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(Buffer.concat(stderr).toString("utf8") || "FFmpeg stock video generation failed."));
    });
  });
};

async function downloadFile(name: string, url: string) {
  const outputPath = outputPathFor(name);
  await mkdir(dirname(outputPath), { recursive: true });

  const response = await fetch(url);

  if (!response.ok) {
    const existing = await stat(outputPath).catch(() => null);

    if (existing && existing.size > 0) {
      console.warn(`Download failed for ${name}; keeping existing local file.`);
      return;
    }

    throw new Error(`Failed: ${url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, buffer);
  console.log("Downloaded:", name);
}

async function createStockVideo(key: string) {
  const avatarPath = join(AVATAR_DIR, `${key}.jpg`);
  const outputPath = join(STOCK_VIDEO_DIR, `${key}.mp4`);
  await mkdir(STOCK_VIDEO_DIR, { recursive: true });

  await runFfmpeg([
    "-y",
    "-loop",
    "1",
    "-framerate",
    "25",
    "-i",
    avatarPath,
    "-filter_complex",
    "[0:v]scale=640:720:force_original_aspect_ratio=increase,crop=640:720,eq=brightness=0.02:saturation=1.08:contrast=1.04,format=yuv420p[v]",
    "-map",
    "[v]",
    "-t",
    "60",
    "-c:v",
    "libx264",
    "-b:v",
    "1800k",
    "-pix_fmt",
    "yuv420p",
    outputPath,
  ]);

  console.log("Created stock video:", `${key}.mp4`);
}

async function downloadAvatars() {
  await mkdir(AVATAR_DIR, { recursive: true });

  for (const avatar of AVATARS) {
    await downloadFile(avatar.name, avatar.url);
  }

  for (const stockVideo of STOCK_VIDEOS) {
    await createStockVideo(stockVideo);
  }

  console.log("All avatars saved to public/avatars/default/");
  console.log("All stock videos saved to public/stock-videos/");
}

void downloadAvatars().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
