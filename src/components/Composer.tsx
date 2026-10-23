"use client";

import { useRef, useState } from "react";
import {
  FiFile,
  FiLoader,
  FiMic,
  FiPaperclip,
  FiSend,
  FiSquare,
  FiX,
} from "react-icons/fi";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Bot } from "lucide-react";
import useSWR from "swr";
import { AgentContact, fetcher } from "@/lib/client";
import { MessagePayload } from "@/lib/client";

type Props = {
  placeholder: string;
  compact?: boolean;
  channelId?: string;
  /** Envía el mensaje (el contenedor decide endpoint y update optimista). */
  onSend: (payload: MessagePayload) => Promise<void>;
};

type StagedAttachment = {
  url: string;
  name: string;
  type: "file" | "image";
};

export default function Composer({
  placeholder,
  compact,
  channelId,
  onSend,
}: Props) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [cursor, setCursor] = useState(0);
  const mention = text.slice(0, cursor).match(/(?:^|\s)@([a-z0-9_-]*)$/i);
  const { data: agents } = useSWR<{ agents: AgentContact[] }>(
    mention ? "/api/agents" : null,
    fetcher,
  );
  const { data: members } = useSWR<{ members: { id: string }[] }>(
    mention && channelId ? `/api/channels/${channelId}/members` : null,
    fetcher,
  );
  const suggestions = mention
    ? (agents?.agents
        .filter(
          (a) =>
            a.mode === "orchestrator" &&
            a.enabled &&
            a.handle.includes(mention[1].toLowerCase()) &&
            members?.members.some((m) => m.id === a.id),
        )
        .slice(0, 6) ?? [])
    : [];
  function chooseMention(handle: string) {
    const start = cursor - (mention?.[1].length ?? 0) - 1;
    const next = text.slice(0, start) + `@${handle} ` + text.slice(cursor);
    const nextCursor = start + handle.length + 2;
    setText(next);
    setCursor(nextCursor);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  }
  // Adjunto ya subido, a la espera de que el usuario pulse enviar.
  const [attachment, setAttachment] = useState<StagedAttachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sendingAudio, setSendingAudio] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);

  async function upload(file: File): Promise<{ url: string; name: string }> {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error ?? "No se pudo subir el archivo.");
    return data;
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || uploading) return;
    setError(null);
    setUploading(true);
    try {
      const data = await upload(file);
      setAttachment({
        url: data.url,
        name: data.name,
        type: file.type.startsWith("image/") ? "image" : "file",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al subir el archivo.");
    } finally {
      setUploading(false);
    }
  }

  function send() {
    const content = text.trim();
    if ((!content && !attachment) || uploading) return;
    setError(null);

    const payload: MessagePayload = {
      content: content || null,
      ...(attachment && {
        attachmentUrl: attachment.url,
        attachmentName: attachment.name,
        attachmentType: attachment.type,
      }),
    };
    const staged = attachment;
    setText("");
    setAttachment(null);
    // Optimista: no bloqueamos la caja mientras viaja el mensaje.
    onSend(payload).catch((e) => {
      setError(
        e instanceof Error ? e.message : "No se pudo enviar el mensaje.",
      );
      setText(content);
      setAttachment(staged);
    });
  }

  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const ext = mimeType === "audio/webm" ? "webm" : "m4a";
        const blob = new Blob(chunks, { type: mimeType });
        if (blob.size === 0) return;
        // Las notas de voz se envían directamente al terminar de grabar.
        setSendingAudio(true);
        try {
          const file = new File([blob], `nota-de-voz.${ext}`, {
            type: mimeType,
          });
          const data = await upload(file);
          await onSend({
            attachmentUrl: data.url,
            attachmentName: data.name,
            attachmentType: "audio",
          });
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "No se pudo enviar el audio.",
          );
        } finally {
          setSendingAudio(false);
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setError(null);
    } catch {
      setError("No se pudo acceder al micrófono.");
    }
  }

  const canSend =
    !uploading && !recording && (text.trim().length > 0 || attachment !== null);

  return (
    <div className="border-t border-border px-3 py-3 sm:px-5">
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      {(attachment || uploading) && (
        <div className="mb-2 flex items-center gap-2">
          {uploading ? (
            <span className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              <FiLoader size={14} className="animate-spin" /> Subiendo…
            </span>
          ) : attachment?.type === "image" ? (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={attachment.url}
                alt={attachment.name}
                className="h-20 rounded-lg border border-border object-cover"
              />
              <RemoveButton onClick={() => setAttachment(null)} />
            </div>
          ) : attachment ? (
            <div className="relative flex items-center gap-2 rounded-lg border border-border bg-muted/50 py-2 pr-6 pl-3 text-xs text-foreground">
              <FiFile size={14} className="shrink-0 text-muted-foreground" />
              <span className="max-w-48 truncate">{attachment.name}</span>
              <RemoveButton onClick={() => setAttachment(null)} inline />
            </div>
          ) : null}
        </div>
      )}

      {mention && channelId && (
        <div
          className="mb-2 rounded-lg border bg-popover p-1 shadow-sm"
          aria-label="Mencionar agente"
        >
          {suggestions.length ? (
            suggestions.map((a) => (
              <Button
                key={a.id}
                variant="ghost"
                className="w-full justify-start"
                onClick={() => chooseMention(a.handle)}
              >
                <Bot /> @{a.handle}
                <span className="ml-auto text-xs text-muted-foreground">
                  {a.machine || a.name}
                </span>
              </Button>
            ))
          ) : (
            <p className="p-2 text-xs text-muted-foreground">
              Añade agentes desde Miembros para mencionarlos aquí.
            </p>
          )}
        </div>
      )}
      <div
        className={`flex items-end gap-2 rounded-xl border px-3 py-2 ${
          recording ? "border-red-400 bg-red-50" : "border-input"
        }`}
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || recording}
          title="Adjuntar archivo"
          className="pb-1.5 text-muted-foreground hover:text-muted-foreground disabled:opacity-40"
        >
          <FiPaperclip size={18} />
        </Button>
        <input ref={fileInputRef} type="file" hidden onChange={onPickFile} />

        <Textarea
          ref={textareaRef}
          aria-label={placeholder}
          rows={1}
          value={text}
          disabled={recording}
          placeholder={recording ? "Grabando audio…" : placeholder}
          onChange={(e) => {
            setText(e.target.value);
            setCursor(e.target.selectionStart);
          }}
          onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              send();
            }
          }}
          className="min-h-9 max-h-40 flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
        />

        <Button
          variant="ghost"
          size="icon"
          onClick={toggleRecording}
          disabled={sendingAudio}
          title={recording ? "Detener y enviar" : "Grabar nota de voz"}
          className={`pb-1.5 disabled:opacity-40 ${
            recording
              ? "animate-pulse text-red-600"
              : "text-muted-foreground hover:text-muted-foreground"
          }`}
        >
          {recording ? <FiSquare size={18} /> : <FiMic size={18} />}
        </Button>

        <Button
          size="icon"
          onClick={send}
          disabled={!canSend}
          title="Enviar"
          aria-label="Enviar"
          className="rounded-lg bg-primary p-2 text-white hover:bg-primary/90 disabled:opacity-40"
        >
          <FiSend size={16} />
        </Button>
      </div>
      {!compact && (
        <p className="mt-1 hidden text-[11px] text-muted-foreground sm:block">
          **negrita** · _cursiva_ · ~~tachado~~ · `código` · ```bloque de
          código``` · &gt; cita · Shift+Enter para salto de línea
        </p>
      )}
    </div>
  );
}

function RemoveButton({
  onClick,
  inline,
}: {
  onClick: () => void;
  inline?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      title="Quitar adjunto"
      className={
        inline
          ? "absolute top-1/2 right-1 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:text-foreground"
          : "absolute -top-1.5 -right-1.5 rounded-full bg-gray-700 p-0.5 text-white shadow hover:bg-gray-900"
      }
    >
      <FiX size={12} />
    </Button>
  );
}
