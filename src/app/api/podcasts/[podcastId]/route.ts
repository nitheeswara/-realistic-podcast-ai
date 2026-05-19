import { FieldValue } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";

import { adminAuth, adminDb } from "@/lib/server/firebase-admin";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ podcastId: string }> }
) {
  try {
    const token = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const decoded = await adminAuth.verifyIdToken(token);
    const { podcastId } = await params;

    const snap = await adminDb.collection("podcasts").doc(podcastId).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (snap.get("ownerId") !== decoded.uid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const audioUrl = snap.get("audioUrl") as string | undefined;
    if (audioUrl) {
      try {
        const { deleteFile } = await import("@/lib/server/storage");
        const publicId = snap.get("audioStoragePath") as string | undefined;
        if (publicId) {
          await deleteFile(publicId, "video");
        }
      } catch (error) {
        console.warn("Cloudinary delete failed:", error);
      }
    }

    const jobs = await adminDb.collection("jobs")
      .where("podcastId", "==", podcastId)
      .get();
    const batch = adminDb.batch();
    jobs.docs.forEach((docRef) => batch.delete(docRef.ref));

    batch.delete(adminDb.collection("podcasts").doc(podcastId));
    await batch.commit();

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ podcastId: string }> }
) {
  try {
    const token = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const decoded = await adminAuth.verifyIdToken(token);
    const { podcastId } = await params;
    const body = await req.json();
    const { title, topic, audience, host, guest } = body as {
      title?: string;
      topic?: string;
      audience?: string;
      host?: Record<string, unknown>;
      guest?: Record<string, unknown>;
    };

    const snap = await adminDb.collection("podcasts").doc(podcastId).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (snap.get("ownerId") !== decoded.uid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const update: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (title !== undefined) {
      update.title = title;
    }
    if (topic !== undefined) {
      update.topic = topic;
    }
    if (audience !== undefined) {
      update.audience = audience;
    }
    if (host !== undefined) {
      const existing = snap.get("host") ?? {};
      update.host = { ...existing, ...host };
    }
    if (guest !== undefined) {
      const existing = snap.get("guest") ?? {};
      update.guest = { ...existing, ...guest };
    }

    await adminDb.collection("podcasts").doc(podcastId).update(update);

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
