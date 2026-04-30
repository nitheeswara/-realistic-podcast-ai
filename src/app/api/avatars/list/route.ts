import { NextResponse } from "next/server";

interface AvatarListItem {
  id: string;
  name: string;
  gender: string;
  previewImage: string;
  type?: string;
}

interface HeyGenAvatarItem {
  avatar_id: string;
  avatar_name: string;
  avatar_type?: string;
  gender?: string;
  preview_image_url?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isHeyGenAvatarItem = (value: unknown): value is HeyGenAvatarItem => {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.avatar_id === "string" && typeof value.avatar_name === "string";
};

const getHeyGenAvatars = (payload: unknown) => {
  if (!isRecord(payload) || !isRecord(payload.data) || !Array.isArray(payload.data.avatars)) {
    return [];
  }

  return payload.data.avatars;
};

export async function GET() {
  try {
    const apiKey = process.env.HEYGEN_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ avatars: MOCK_AVATARS });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch("https://api.heygen.com/v2/avatars", {
        headers: { "x-api-key": apiKey },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        console.error("HeyGen avatars API error:", res.status);
        return NextResponse.json({ avatars: MOCK_AVATARS });
      }

      const avatars = getHeyGenAvatars(await res.json())
        .filter(isHeyGenAvatarItem)
        .map((avatar): AvatarListItem => ({
          id: avatar.avatar_id,
          name: avatar.avatar_name,
          gender: avatar.gender ?? "neutral",
          previewImage: avatar.preview_image_url ?? "",
          type: avatar.avatar_type,
        }));

      console.log(`HeyGen avatars loaded: ${avatars.length}`);
      return NextResponse.json({
        avatars: avatars.length > 0 ? avatars : MOCK_AVATARS,
      });
    } catch (fetchError) {
      clearTimeout(timeout);
      if (fetchError instanceof Error && fetchError.name === "AbortError") {
        console.error("HeyGen request timed out");
      }
      return NextResponse.json({ avatars: MOCK_AVATARS });
    }
  } catch (error) {
    console.error("Avatar list error:", error instanceof Error ? error.message : error);
    return NextResponse.json({ avatars: MOCK_AVATARS });
  }
}

const MOCK_AVATARS: AvatarListItem[] = [
  {
    id: "mock_male_1",
    name: "Alex",
    gender: "male",
    previewImage: "https://api.dicebear.com/7.x/avataaars/svg?seed=Alex",
  },
  {
    id: "mock_male_2",
    name: "James",
    gender: "male",
    previewImage: "https://api.dicebear.com/7.x/avataaars/svg?seed=James",
  },
  {
    id: "mock_male_3",
    name: "Marcus",
    gender: "male",
    previewImage: "https://api.dicebear.com/7.x/avataaars/svg?seed=Marcus",
  },
  {
    id: "mock_female_1",
    name: "Priya",
    gender: "female",
    previewImage: "https://api.dicebear.com/7.x/avataaars/svg?seed=Priya",
  },
  {
    id: "mock_female_2",
    name: "Sarah",
    gender: "female",
    previewImage: "https://api.dicebear.com/7.x/avataaars/svg?seed=Sarah",
  },
  {
    id: "mock_female_3",
    name: "Aisha",
    gender: "female",
    previewImage: "https://api.dicebear.com/7.x/avataaars/svg?seed=Aisha",
  },
];
