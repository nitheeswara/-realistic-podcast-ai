import "server-only";

import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

import { serverEnv } from "@/config/env";

const ADMIN_APP_NAME = "admin";

const getAdminApp = () => {
  const existingAdminApp = getApps().find((app) => app.name === ADMIN_APP_NAME);

  if (existingAdminApp) {
    return getApp(ADMIN_APP_NAME);
  }

  return initializeApp(
    {
      credential: cert({
        projectId: serverEnv.FIREBASE_PROJECT_ID,
        clientEmail: serverEnv.FIREBASE_CLIENT_EMAIL,
        privateKey: serverEnv.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
    },
    ADMIN_APP_NAME
  );
};

export const logAdminStorageUploadError = (operation: string, error: unknown) => {
  console.error(`[Storage] ${operation}`, error);
};

export const adminApp = getAdminApp();
export const adminDb = getFirestore(adminApp);
export const adminAuth = getAuth(adminApp);
export const adminStorage = null;
