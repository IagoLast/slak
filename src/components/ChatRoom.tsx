"use client";

import { useEffect, useRef } from "react";
import useSWR from "swr";
import AddMemberButton from "@/components/AddMemberButton";
import Composer from "@/components/Composer";
import MessageItem from "@/components/MessageItem";
import { ChannelIcon } from "@/components/Sidebar";
import { ChatMessage, fetcher } from "@/lib/client";
import { SessionUser } from "@/lib/session";

type Props = {
  channelId: string;
  channelName: string;
  channelType: "public" | "private" | "dm";
  channelDescription: string | null;
  currentUser: SessionUser;
};

export default function ChatRoom({
  channelId,
  channelName,
  channelType,
  channelDescription,
  currentUser,
}: Props) {
  const { data, mutate } = useSWR<{ messages: ChatMessage[] }>(
    `/api/channels/${channelId}/messages`,
    fetcher,
    { refreshInterval: 2500 },
  );
  const messages = data?.messages ?? [];

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 sm:px-5">
        <h1 className="flex items-center gap-1.5 text-base font-bold text-gray-900">
          <span className="text-gray-400">
            <ChannelIcon type={channelType} size={15} />
          </span>
          {channelName}
        </h1>
        {channelDescription && (
          <p className="hidden truncate text-sm text-gray-500 sm:block">
            {channelDescription}
          </p>
        )}
        {channelType !== "dm" && currentUser.role !== "guest" && (
          <AddMemberButton channelId={channelId} />
        )}
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
        channelId={channelId}
        placeholder={
          channelType === "dm" ? `Mensaje a ${channelName}` : `Mensaje a #${channelName}`
        }
        onSent={() => {
          stickToBottom.current = true;
          mutate();
        }}
      />
    </div>
  );
}
