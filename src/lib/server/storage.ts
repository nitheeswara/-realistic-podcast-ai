import "server-only";

import { v2 as cloudinary } from "cloudinary";

import { serverEnv } from "@/config/env";

export type CloudinaryResourceType = "image" | "video" | "raw";

export interface UploadResult {
  url: string;
  publicId: string;
  storagePath: string;
}

const sanitizeSegment = (value: string) =>
  value
    .trim()
    .replace(/\.[^/.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "asset";

const sanitizeFolder = (folder: string) =>
  folder
    .split("/")
    .map((segment) => sanitizeSegment(segment))
    .filter(Boolean)
    .join("/");

const ensureCloudinaryConfig = () => {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = serverEnv;

  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new Error(
      "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET."
    );
  }

  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
};

const uploadBuffer = async ({
  buffer,
  folder,
  format,
  filename,
  resourceType,
}: {
  buffer: Buffer;
  folder: string;
  format?: string;
  filename: string;
  resourceType: CloudinaryResourceType;
}): Promise<UploadResult> => {
  ensureCloudinaryConfig();

  const safeFolder = sanitizeFolder(folder);
  const publicId = sanitizeSegment(filename);

  return new Promise<UploadResult>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: safeFolder,
        overwrite: true,
        public_id: publicId,
        ...(format ? { format } : {}),
        resource_type: resourceType,
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        if (!result?.secure_url || !result.public_id) {
          reject(new Error("Cloudinary upload did not return a secure URL."));
          return;
        }

        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          storagePath: result.public_id,
        });
      }
    );

    stream.end(buffer);
  });
};

export const uploadAudioBuffer = async (
  buffer: Buffer,
  storagePath: string
): Promise<string> => {
  ensureCloudinaryConfig();

  return new Promise<string>((resolve, reject) => {
    const publicId = storagePath
      .replace(/^\//, "")
      .replace(/\.mp3$/, "")
      .replace(/\//g, "-");

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "video",
        public_id: publicId,
        overwrite: true,
        format: "mp3",
      },
      (error, result) => {
        if (error || !result) {
          reject(error ?? new Error("Cloudinary upload failed"));
          return;
        }

        resolve(result.secure_url);
      }
    );

    uploadStream.end(buffer);
  });
};

export const uploadAudio = (
  buffer: Buffer,
  folder: string,
  filename: string
): Promise<UploadResult> => {
  const storagePath = `${sanitizeFolder(folder)}/${sanitizeSegment(filename)}.mp3`;
  const publicId = storagePath.replace(/\//g, "-").replace(/\.mp3$/, "");

  return uploadAudioBuffer(buffer, storagePath).then((url) => ({
    url,
    publicId,
    storagePath,
  }));
};

export const uploadVideo = (
  buffer: Buffer,
  folder: string,
  filename: string
): Promise<UploadResult> =>
  uploadBuffer({
    buffer,
    folder,
    filename,
    resourceType: "video",
  });

export const uploadImage = (
  buffer: Buffer,
  folder: string,
  filename: string
): Promise<UploadResult> =>
  uploadBuffer({
    buffer,
    folder,
    filename,
    resourceType: "image",
  });

export const uploadRaw = (
  buffer: Buffer,
  folder: string,
  filename: string
): Promise<UploadResult> =>
  uploadBuffer({
    buffer,
    folder,
    filename,
    resourceType: "raw",
  });

export const deleteFile = async (
  publicId: string,
  resourceType: CloudinaryResourceType
): Promise<void> => {
  ensureCloudinaryConfig();
  await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
};
