"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import AddMemberButton from "@/components/AddMemberButton";
import Composer from "@/components/Composer";
import Huddle from "@/components/Huddle";
import MessageItem from "@/components/MessageItem";
import { ChannelIcon, PresenceDot } from "@/components/Sidebar";
import ThreadPanel from "@/components/ThreadPanel";
import { ChatMessage, fetcher, MessagePayload } from "@/lib/client";
import { SessionUser } from "@/lib/session";

type Props = {
  channelId: string;
  channelName: string;
  channelType: "public" | "private" | "dm";
  channelDescription: string | null;
  dmOnline?: boolean;
  currentUser: SessionUser;
};

export default function ChatRoom({
  channelId,
  channelName,
  channelType,
  channelDescription,
  dmOnline,
  currentUser,
}: Props) {
  const { data, mutate } = useSWR<{ messages: ChatMessage[] }>(
    `/api/channels/${channelId}/messages`,
    fetcher,
    { refreshInterval: 2500 },
  );
  const messages = data?.messages ?? [];
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMessageId = messages[messages.length - 1]?.id;

  // Bajar al final cuando llegan mensajes (si ya estábamos cerca del final).
  const stickToBottom = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lastMessageId]);

  // Marcar como leído al entrar y cuando llegan mensajes con la pestaña visible.
  useEffect(() => {
    if (!lastMessageId) return;
    if (document.visibilityState === "visible") {
      fetch(`/api/channels/${channelId}/read`, { method: "POST" });
    }
  }, [channelId, lastMessageId]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  // Envío optimista: el mensaje aparece al instante y la revalidación
  // posterior lo sustituye por el real (o lo retira si el envío falló).
  const sendMessage = useCallback(
    async (payload: MessagePayload) => {
      const optimistic: ChatMessage = {
        id: `optimistic-${Date.now()}`,
        content: payload.content ?? null,
        attachmentUrl: payload.attachmentUrl ?? null,
        attachmentName: payload.attachmentName ?? null,
        attachmentType: payload.attachmentType ?? null,
        createdAt: new Date().toISOString(),
        replyCount: 0,
        user: { id: currentUser.id, name: currentUser.name },
      };
      stickToBottom.current = true;
      await mutate(
        async (current) => {
          const res = await fetch(`/api/channels/${channelId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => null);
            throw new Error(data?.error ?? "No se pudo enviar el mensaje.");
          }
          return { messages: [...(current?.messages ?? []), optimistic] };
        },
        {
          optimisticData: (current) => ({
            messages: [...(current?.messages ?? []), optimistic],
          }),
          rollbackOnError: true,
          revalidate: true,
        },
      );
    },
    [channelId, currentUser.id, currentUser.name, mutate],
  );

  return (
    <div className="flex h-full min-h-0">
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 sm:px-5">
          <h1 className="flex items-center gap-1.5 text-base font-bold text-gray-900">
            <span className="text-gray-400">
              <ChannelIcon type={channelType} size={15} />
            </span>
            {channelName}
            {channelType === "dm" && (
              <span className="ml-1 flex items-center gap-1 text-xs font-normal text-gray-500">
                <PresenceDot online={dmOnline} />
                {dmOnline ? "En línea" : "Desconectado"}
              </span>
            )}
          </h1>
          {channelDescription && (
            <p className="hidden truncate text-sm text-gray-500 sm:block">
              {channelDescription}
            </p>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Huddle
              channelId={channelId}
              channelName={channelName}
              userId={currentUser.id}
            />
            {channelType !== "dm" && currentUser.role !== "guest" && (
              <AddMemberButton channelId={channelId} />
            )}
          </div>
        </header>

        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex-1 overflow-y-auto px-3 py-4 sm:px-5"
        >
          {messages.length === 0 && (
            <p className="mt-10 text-center text-sm text-gray-400">
              No hay mensajes todavía. ¡Escribe el primero!
            </p>
          )}
          {messages.map((message, i) => (
            <MessageItem
              key={message.id}
              message={message}
              isOwn={message.user.id === currentUser.id}
              onOpenThread={setOpenThreadId}
              showHeader={
                i === 0 ||
                messages[i - 1].user.id !== message.user.id ||
                new Date(message.createdAt).getTime() -
                  new Date(messages[i - 1].createdAt).getTime() >
                  5 * 60 * 1000
              }
            />
          ))}
        </div>

        <Composer
          placeholder={
            channelType === "dm" ? `Mensaje a ${channelName}` : `Mensaje a #${channelName}`
          }
          onSend={sendMessage}
        />
      </div>

      {openThreadId && (
        <ThreadPanel
          key={openThreadId}
          rootId={openThreadId}
          currentUser={currentUser}
          onClose={() => setOpenThreadId(null)}
        />
      )}
    </div>
  );
}
