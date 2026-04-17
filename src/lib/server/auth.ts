import type { DecodedIdToken } from "firebase-admin/auth";

import { adminAuth } from "@/lib/server/firebase-admin";

export class ApiAuthError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "ApiAuthError";
  }
}

export const requireUserFromRequest = async (
  request: Request
): Promise<DecodedIdToken> => {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;

  if (!token) {
    throw new ApiAuthError();
  }

  try {
    return await adminAuth.verifyIdToken(token);
  } catch {
    throw new ApiAuthError();
  }
};

export const jsonError = (message: string, status: number) =>
  Response.json({ error: message }, { status });
