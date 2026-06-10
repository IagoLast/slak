"use client";

import { FiX } from "react-icons/fi";
import useSWR from "swr";
import Composer from "@/components/Composer";
import MessageItem from "@/components/MessageItem";
import { ChatMessage, fetcher } from "@/lib/client";
import { SessionUser } from "@/lib/session";

/**
 * Panel de hilo: lateral en escritorio, a pantalla completa en móvil.
 */
export default function ThreadPanel({
  rootId,
  currentUser,
  onClose,
}: {
  rootId: string;
  currentUser: SessionUser;
  onClose: () => void;
}) {
  const { data, mutate } = useSWR<{ root: ChatMessage; replies: ChatMessage[] }>(
    `/api/messages/${rootId}/thread`,
    fetcher,
    { refreshInterval: 2500 },
  );

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-white md:static md:z-auto md:w-96 md:shrink-0 md:border-l md:border-gray-200">
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h2 className="text-base font-bold text-gray-900">Hilo</h2>
        <button
          onClick={onClose}
          title="Cerrar hilo"
          className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <FiX size={16} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {!data ? (
          <p className="mt-6 text-center text-sm text-gray-400">Cargando…</p>
        ) : (
          <>
            <MessageItem message={data.root} isOwn={data.root.user.id === currentUser.id} showHeader />
            <div className="my-3 flex items-center gap-2 text-xs text-gray-400">
              <span className="h-px flex-1 bg-gray-200" />
              {data.replies.length === 0
                ? "Sin respuestas todavía"
                : data.replies.length === 1
                  ? "1 respuesta"
                  : `${data.replies.length} respuestas`}
              <span className="h-px flex-1 bg-gray-200" />
            </div>
            {data.replies.map((reply, i) => (
              <MessageItem
                key={reply.id}
                message={reply}
                isOwn={reply.user.id === currentUser.id}
                showHeader={
                  i === 0 ||
                  data.replies[i - 1].user.id !== reply.user.id ||
                  new Date(reply.createdAt).getTime() -
                    new Date(data.replies[i - 1].createdAt).getTime() >
                    5 * 60 * 1000
                }
              />
            ))}
          </>
        )}
      </div>

      <Composer
        endpoint={`/api/messages/${rootId}/thread`}
        placeholder="Responder en el hilo"
        compact
        onSent={() => mutate()}
      />
    </div>
  );
}
