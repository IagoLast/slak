"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import ChatRoom from "@/components/ChatRoom";
import { fetcher, Summary } from "@/lib/client";

/**
 * Página de canal 100% cliente: los metadatos salen del resumen (que la
 * barra lateral ya tiene cacheado con la misma clave SWR), así que cambiar
 * de canal no toca el servidor y es instantáneo. El control de acceso real
 * lo aplican las APIs de mensajes.
 */
export default function ChannelPage() {
  const { id } = useParams<{ id: string }>();
  const { data } = useSWR<Summary>("/api/me/summary", fetcher, {
    refreshInterval: 5000,
  });

  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
        Cargando…
      </div>
    );
  }

  const channel = data.channels.find((c) => c.id === id);
  if (!channel) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-gray-500">
        <p>Este canal no existe o no tienes acceso.</p>
        <Link href="/" className="font-medium text-violet-700 hover:underline">
          Volver al inicio
        </Link>
      </div>
    );
  }

  const dmOnline =
    channel.type === "dm" && channel.dmUserId
      ? data.users.find((u) => u.id === channel.dmUserId)?.online
      : undefined;

  return (
    <ChatRoom
      key={channel.id}
      channelId={channel.id}
      channelName={channel.name}
      channelType={channel.type}
      channelDescription={channel.description}
      dmOnline={dmOnline}
      currentUser={data.user}
    />
  );
}
