"use client";

import { Loader2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

const getParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default function ResultRedirectPage() {
  const params = useParams();
  const router = useRouter();
  const podcastId = getParam(params.podcastId);

  useEffect(() => {
    if (podcastId) {
      router.replace(`/dashboard/podcasts/${podcastId}/result`);
    }
  }, [podcastId, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
      <div className="flex items-center gap-3 text-sm text-gray-400">
        <Loader2 className="size-4 animate-spin text-amber-200" />
        Opening result...
      </div>
    </main>
  );
}
