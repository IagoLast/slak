"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import useSWR from "swr";
import { fetcher, Summary } from "@/lib/client";

export default function HomePage() {
  const router = useRouter();
  const { data } = useSWR<Summary>("/api/me/summary", fetcher);

  const firstChannelId = data?.channels[0]?.id;
  useEffect(() => {
    if (firstChannelId) router.replace(`/c/${firstChannelId}`);
  }, [firstChannelId, router]);

  return (
    <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
      {data && data.channels.length === 0
        ? "Todavía no tienes acceso a ningún canal."
        : "Cargando…"}
    </div>
  );
}
