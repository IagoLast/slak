"use client";
import { Button } from "@/components/ui/button";

import { useCallback } from "react";
import { FiX } from "react-icons/fi";
import useSWR from "swr";
import Composer from "@/components/Composer";
import MessageItem from "@/components/MessageItem";
import { ChatMessage, fetcher, MessagePayload } from "@/lib/client";
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
  const { data, mutate } = useSWR<{
    root: ChatMessage & { channelId: string };
    replies: ChatMessage[];
  }>(`/api/messages/${rootId}/thread`, fetcher, { refreshInterval: 2500 });

  const sendReply = useCallback(
    async (payload: MessagePayload) => {
      const optimistic: ChatMessage = {
        id: `optimistic-${Date.now()}`,
        content: payload.content ?? null,
        attachmentUrl: payload.attachmentUrl ?? null,
        attachmentName: payload.attachmentName ?? null,
        attachmentType: payload.attachmentType ?? null,
        createdAt: new Date().toISOString(),
        user: { id: currentUser.id, name: currentUser.name },
      };
      await mutate(
        async (current) => {
          const res = await fetch(`/api/messages/${rootId}/thread`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => null);
            throw new Error(data?.error ?? "No se pudo enviar la respuesta.");
          }
          return current
            ? { ...current, replies: [...current.replies, optimistic] }
            : current;
        },
        {
          optimisticData: (current) =>
            current
              ? { ...current, replies: [...current.replies, optimistic] }
              : current!,
          rollbackOnError: true,
          revalidate: true,
        },
      );
    },
    [rootId, currentUser.id, currentUser.name, mutate],
  );

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background md:static md:z-auto md:w-96 md:shrink-0 md:border-l md:border-border">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-base font-bold text-foreground">Hilo</h2>
        <Button
          variant="ghost"
          onClick={onClose}
          title="Cerrar hilo"
          className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-muted-foreground"
        >
          <FiX size={16} />
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {!data ? (
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Cargando…
          </p>
        ) : (
          <>
            <MessageItem
              message={data.root}
              isOwn={data.root.user.id === currentUser.id}
              showHeader
            />
            <div className="my-3 flex items-center gap-2 text-xs text-muted-foreground">
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

      <Composer placeholder="Responder en el hilo" compact onSend={sendReply} />
    </div>
  );
}
