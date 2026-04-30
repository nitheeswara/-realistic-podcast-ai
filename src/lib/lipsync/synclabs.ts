const isHttpsUrl = (url: string) => url.startsWith("https://");
const SYNCSO_MODELS = ["wav2lip++", "lipsync-1.7.0", "sync-1.5.0"] as const;

const getMessageFromPayload = (payload: unknown) => {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "message" in payload &&
    typeof (payload as { message?: unknown }).message === "string"
  ) {
    return (payload as { message: string }).message;
  }

  return JSON.stringify(payload);
};

const pollSyncJob = async (
  apiKey: string,
  jobId: string,
  turnId: string
): Promise<string | null> => {
  const startTime = Date.now();

  while (Date.now() - startTime < 120_000) {
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const statusRes = await fetch(`https://api.sync.so/v2/generate/${encodeURIComponent(jobId)}`, {
      headers: { "x-api-key": apiKey },
      cache: "no-store",
    });

    if (!statusRes.ok) {
      continue;
    }

    const job: unknown = await statusRes.json();
    const status = typeof job === "object" &&
      job !== null &&
      "status" in job &&
      typeof (job as { status?: unknown }).status === "string"
      ? (job as { status: string }).status
      : null;
    const outputUrl = typeof job === "object" &&
      job !== null &&
      "outputUrl" in job &&
      typeof (job as { outputUrl?: unknown }).outputUrl === "string"
      ? (job as { outputUrl: string }).outputUrl
      : null;

    if (status === "COMPLETED" && outputUrl) {
      return outputUrl;
    }

    if (status === "FAILED") {
      const error = typeof job === "object" && job !== null && "error" in job
        ? (job as { error?: unknown }).error
        : undefined;
      console.error(`Sync.so job failed for ${turnId}:`, error);
      return null;
    }
  }

  console.error(`Sync.so timeout for ${turnId}`);
  return null;
};

export async function applySyncLabsLipSync(
  videoUrl: string,
  audioUrl: string,
  turnId: string
): Promise<string | null> {
  const apiKey = process.env.SYNCLABS_API_KEY;

  if (!apiKey) {
    return null;
  }

  if (!isHttpsUrl(videoUrl) || !isHttpsUrl(audioUrl)) {
    console.warn(`Sync.so skipped for ${turnId}: video and audio URLs must be public HTTPS URLs.`);
    return null;
  }

  try {
    for (const model of SYNCSO_MODELS) {
      const createRes = await fetch("https://api.sync.so/v2/generate", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          audioUrl,
          videoUrl,
          model,
          synergize: true,
        }),
      });

      if (createRes.status === 400) {
        const errorText = await createRes.text();
        let modelError = errorText;

        try {
          modelError = getMessageFromPayload(JSON.parse(errorText));
        } catch {
          modelError = errorText;
        }

        if (modelError.includes("model") || modelError.includes("Unsupported")) {
          console.warn(`Sync.so model "${model}" not supported, trying next...`);
          continue;
        }

        console.error(`Sync.so rejected request for ${turnId} with model "${model}":`, modelError);
        continue;
      }

      if (!createRes.ok) {
        const errorText = await createRes.text();
        console.error(`Sync.so failed with model "${model}": ${createRes.status}`, errorText);
        continue;
      }

      const createPayload: unknown = await createRes.json();
      const jobId = typeof createPayload === "object" &&
        createPayload !== null &&
        "id" in createPayload &&
        typeof (createPayload as { id?: unknown }).id === "string"
        ? (createPayload as { id: string }).id
        : null;

      if (!jobId) {
        console.error(`Sync.so create did not return a job id for ${turnId}.`, createPayload);
        continue;
      }

      const outputUrl = await pollSyncJob(apiKey, jobId, turnId);

      if (outputUrl) {
        return outputUrl;
      }
    }

    console.error(`Sync.so could not create a lip-sync result for ${turnId}`);
    return null;
  } catch (error) {
    console.error(`Sync.so exception for ${turnId}:`, error);
    return null;
  }
}
