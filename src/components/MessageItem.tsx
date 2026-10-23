"use client";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Bot } from "lucide-react";
import { FiMessageSquare, FiPaperclip } from "react-icons/fi";
import MessageContent from "@/components/MessageContent";
import { ChatMessage } from "@/lib/client";

const timeFormat = new Intl.DateTimeFormat("es", {
  hour: "2-digit",
  minute: "2-digit",
});
const dateFormat = new Intl.DateTimeFormat("es", {
  day: "numeric",
  month: "short",
});

export default function MessageItem({
  message,
  isOwn,
  showHeader,
  onOpenThread,
}: {
  message: ChatMessage;
  isOwn: boolean;
  showHeader: boolean;
  /** Si se pasa, el mensaje admite hilo (no en el propio panel de hilo). */
  onOpenThread?: (messageId: string) => void;
}) {
  const created = new Date(message.createdAt);
  const isToday = new Date().toDateString() === created.toDateString();
  const replyCount = message.replyCount ?? 0;

  return (
    <div
      className={`group relative flex gap-3 px-1 py-0.5 hover:bg-muted/50 ${showHeader ? "mt-3" : ""}`}
    >
      <div className="w-9 shrink-0">
        {showHeader && (
          <Avatar className="size-9 rounded-lg">
            <AvatarFallback
              className={
                isOwn
                  ? "rounded-lg bg-primary text-primary-foreground"
                  : "rounded-lg"
              }
            >
              {message.user.kind === "agent" ? (
                <Bot className="size-5" />
              ) : (
                message.user.name.slice(0, 1).toUpperCase()
              )}
            </AvatarFallback>
          </Avatar>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {showHeader && (
          <p className="text-sm">
            <span className="font-bold text-foreground">
              {message.user.name}
            </span>{" "}
            {message.user.kind === "agent" && (
              <Badge variant="secondary" className="mr-1 h-4 text-[10px]">
                Agente
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {isToday
                ? timeFormat.format(created)
                : `${dateFormat.format(created)} ${timeFormat.format(created)}`}
            </span>
          </p>
        )}
        {message.content && <MessageContent content={message.content} />}
        {message.attachmentUrl && <Attachment message={message} />}
        {message.workThreadId && (
          <Button asChild variant="outline" size="sm" className="my-2 gap-2">
            <Link href={`/work/${message.workThreadId}`}>
              <Bot className="size-4" />
              Abrir conversación con el orquestador
            </Link>
          </Button>
        )}
        {onOpenThread && replyCount > 0 && (
          <Button
            variant="ghost"
            onClick={() => onOpenThread(message.id)}
            className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            <FiMessageSquare size={12} />
            {replyCount === 1 ? "1 respuesta" : `${replyCount} respuestas`}
          </Button>
        )}
      </div>
      {onOpenThread && (
        <Button
          variant="ghost"
          onClick={() => onOpenThread(message.id)}
          title="Responder en hilo"
          className="absolute top-0 right-2 hidden rounded-lg border border-border bg-background p-1.5 text-muted-foreground shadow-sm group-hover:block hover:text-primary max-sm:block"
        >
          <FiMessageSquare size={14} />
        </Button>
      )}
    </div>
  );
}

function Attachment({ message }: { message: ChatMessage }) {
  const url = message.attachmentUrl!;
  const name = message.attachmentName ?? "archivo";

  if (message.attachmentType === "image") {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="mt-1 block max-w-sm"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={name}
          className="max-h-72 rounded-lg border border-border"
        />
      </a>
    );
  }

  if (message.attachmentType === "audio") {
    return (
      <audio
        controls
        src={url}
        className="mt-1 h-10 max-w-xs"
        preload="metadata"
      />
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      download={name}
      className="mt-1 inline-flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-primary hover:bg-muted"
    >
      <FiPaperclip size={14} className="shrink-0" />
      <span className="max-w-60 truncate">{name}</span>
    </a>
  );
}
