"use client";

import { FiPaperclip } from "react-icons/fi";
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
}: {
  message: ChatMessage;
  isOwn: boolean;
  showHeader: boolean;
}) {
  const created = new Date(message.createdAt);
  const isToday = new Date().toDateString() === created.toDateString();

  return (
    <div className={`group flex gap-3 px-1 py-0.5 hover:bg-gray-50 ${showHeader ? "mt-3" : ""}`}>
      <div className="w-9 shrink-0">
        {showHeader && (
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-semibold text-white ${
              isOwn ? "bg-violet-600" : "bg-gray-500"
            }`}
          >
            {message.user.name.slice(0, 1).toUpperCase()}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {showHeader && (
          <p className="text-sm">
            <span className="font-bold text-gray-900">{message.user.name}</span>{" "}
            <span className="text-xs text-gray-400">
              {isToday
                ? timeFormat.format(created)
                : `${dateFormat.format(created)} ${timeFormat.format(created)}`}
            </span>
          </p>
        )}
        {message.content && (
          <p className="text-sm whitespace-pre-wrap text-gray-800">{message.content}</p>
        )}
        {message.attachmentUrl && <Attachment message={message} />}
      </div>
    </div>
  );
}

function Attachment({ message }: { message: ChatMessage }) {
  const url = message.attachmentUrl!;
  const name = message.attachmentName ?? "archivo";

  if (message.attachmentType === "image") {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="mt-1 block max-w-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={name} className="max-h-72 rounded-lg border border-gray-200" />
      </a>
    );
  }

  if (message.attachmentType === "audio") {
    return <audio controls src={url} className="mt-1 h-10 max-w-xs" preload="metadata" />;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      download={name}
      className="mt-1 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-violet-700 hover:bg-gray-100"
    >
      <FiPaperclip size={14} className="shrink-0" />
      <span className="max-w-60 truncate">{name}</span>
    </a>
  );
}
