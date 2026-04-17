import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const timeoutSignal = (timeoutMs: number) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeout };
};

const loadBlob = async (pathOrUrl: string, fallbackType: string) => {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    const response = await fetch(pathOrUrl, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`Could not download ${pathOrUrl}.`);
    }

    return new Blob([await response.arrayBuffer()], {
      type: response.headers.get("content-type") ?? fallbackType,
    });
  }

  return new Blob([await readFile(pathOrUrl)], { type: fallbackType });
};

const postWav2Lip = async (
  videoPath: string,
  audioPath: string,
  serviceUrl: string,
  signal: AbortSignal
) => {
  const formData = new FormData();
  formData.append("video", await loadBlob(videoPath, "video/mp4"), basename(videoPath) || "video.mp4");
  formData.append("audio", await loadBlob(audioPath, "audio/mpeg"), basename(audioPath) || "audio.mp3");

  const response = await fetch(`${serviceUrl.replace(/\/$/, "")}/wav2lip`, {
    method: "POST",
    body: formData,
    signal,
  });

  if (!response.ok) {
    throw new Error(`Wav2Lip failed with status ${response.status}.`);
  }

  return response.arrayBuffer();
};

export async function callWav2Lip(
  videoPath: string,
  audioPath: string,
  serviceUrl: string
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { controller, timeout } = timeoutSignal(120_000);

    try {
      const output = await postWav2Lip(videoPath, audioPath, serviceUrl, controller.signal);
      const tempDir = await mkdtemp(join(tmpdir(), "realistic-podcast-ai-wav2lip-"));
      const outputPath = join(tempDir, "enhanced.mp4");
      await writeFile(outputPath, Buffer.from(output));
      return outputPath;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Wav2Lip failed.");
}
