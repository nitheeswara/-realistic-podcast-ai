import { z } from "zod";

const emptyStringToUndefined = (value: unknown) => {
  if (typeof value === "string" && value.trim().length === 0) {
    return undefined;
  }

  return value;
};

const requiredString = (name: string) =>
  z
    .string()
    .trim()
    .min(1, `${name} is required and cannot be empty.`);

const requiredUrl = (name: string) =>
  requiredString(name).url(`${name} must be a valid URL.`);

const optionalSecret = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().min(1).optional()
);

const optionalUrl = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().url().optional()
);

const clientEnvSchema = z.object({
  NEXT_PUBLIC_FIREBASE_API_KEY: requiredString(
    "NEXT_PUBLIC_FIREBASE_API_KEY"
  ),
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: requiredString(
    "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"
  ),
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: requiredString(
    "NEXT_PUBLIC_FIREBASE_PROJECT_ID"
  ),
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: requiredString(
    "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"
  ),
  NEXT_PUBLIC_FIREBASE_APP_ID: requiredString("NEXT_PUBLIC_FIREBASE_APP_ID"),
});

const serverEnvSchema = z.object({
  FIREBASE_PROJECT_ID: requiredString("FIREBASE_PROJECT_ID"),
  FIREBASE_CLIENT_EMAIL: requiredString("FIREBASE_CLIENT_EMAIL").email(
    "FIREBASE_CLIENT_EMAIL must be a valid service-account email."
  ),
  FIREBASE_PRIVATE_KEY: z
    .string()
    .min(1, "FIREBASE_PRIVATE_KEY is required and cannot be empty."),
  GEMINI_API_KEY: optionalSecret,
  ELEVENLABS_API_KEY: optionalSecret,
  SARVAM_API_KEY: optionalSecret,
  HEYGEN_API_KEY: optionalSecret,
  SYNCLABS_API_KEY: optionalSecret,
  DID_API_KEY: optionalSecret,
  CLOUDINARY_CLOUD_NAME: optionalSecret,
  CLOUDINARY_API_KEY: optionalSecret,
  CLOUDINARY_API_SECRET: optionalSecret,
  APP_BASE_URL: requiredUrl("APP_BASE_URL"),
  PYTHON_SERVICE_URL: optionalUrl,
  FFMPEG_PATH: optionalSecret,
});

const formatEnvError = (label: string, error: z.ZodError) => {
  const issues = error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "ENV";
      return `- ${path}: ${issue.message}`;
    })
    .join("\n");

  return `Invalid ${label} environment configuration:\n${issues}`;
};

const rawClientEnv = {
  NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID:
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const rawServerEnv = {
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
  SARVAM_API_KEY: process.env.SARVAM_API_KEY,
  HEYGEN_API_KEY: process.env.HEYGEN_API_KEY,
  SYNCLABS_API_KEY: process.env.SYNCLABS_API_KEY,
  DID_API_KEY: process.env.DID_API_KEY,
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
  APP_BASE_URL: process.env.APP_BASE_URL,
  PYTHON_SERVICE_URL: process.env.PYTHON_SERVICE_URL,
  FFMPEG_PATH: process.env.FFMPEG_PATH,
};

const parsedClientEnv = clientEnvSchema.safeParse(rawClientEnv);

if (!parsedClientEnv.success) {
  throw new Error(formatEnvError("client", parsedClientEnv.error));
}

export const clientEnv = parsedClientEnv.data;
export type ClientEnv = z.infer<typeof clientEnvSchema>;

export type ServerEnv = z.infer<typeof serverEnvSchema>;

const parseServerEnv = (): ServerEnv => {
  const parsedServerEnv = serverEnvSchema.safeParse(rawServerEnv);

  if (!parsedServerEnv.success) {
    throw new Error(formatEnvError("server", parsedServerEnv.error));
  }

  return parsedServerEnv.data;
};

export const serverEnv =
  typeof window === "undefined" ? parseServerEnv() : ({} as ServerEnv);
