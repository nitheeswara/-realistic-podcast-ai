import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

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

export async function callSadTalker(
  imagePath: string,
  audioPath: string,
  serviceUrl: string
): Promise<string> {
  const formData = new FormData();
  formData.append("image", await loadBlob(imagePath, "image/jpeg"), basename(imagePath) || "image.jpg");
  formData.append("audio", await loadBlob(audioPath, "audio/mpeg"), basename(audioPath) || "audio.mp3");

  const response = await fetch(`${serviceUrl.replace(/\/$/, "")}/sadtalker`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`SadTalker failed with status ${response.status}.`);
  }

  const tempDir = await mkdtemp(join(tmpdir(), "realistic-podcast-ai-sadtalker-"));
  const outputPath = join(tempDir, "generated.mp4");
  await writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
  return outputPath;
}
