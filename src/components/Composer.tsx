"use client";

import { useRef, useState } from "react";
import { FiFile, FiLoader, FiMic, FiPaperclip, FiSend, FiSquare, FiX } from "react-icons/fi";
import { MessagePayload } from "@/lib/client";

type Props = {
  placeholder: string;
  compact?: boolean;
  /** Envía el mensaje (el contenedor decide endpoint y update optimista). */
  onSend: (payload: MessagePayload) => Promise<void>;
};

type StagedAttachment = {
  url: string;
  name: string;
  type: "file" | "image";
};

export default function Composer({ placeholder, compact, onSend }: Props) {
  const [text, setText] = useState("");
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
      setError(e instanceof Error ? e.message : "No se pudo enviar el mensaje.");
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
          const file = new File([blob], `nota-de-voz.${ext}`, { type: mimeType });
          const data = await upload(file);
          await onSend({
            attachmentUrl: data.url,
            attachmentName: data.name,
            attachmentType: "audio",
          });
        } catch (e) {
          setError(e instanceof Error ? e.message : "No se pudo enviar el audio.");
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

  const canSend = !uploading && !recording && (text.trim().length > 0 || attachment !== null);

  return (
    <div className="border-t border-gray-200 px-3 py-3 sm:px-5">
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      {(attachment || uploading) && (
        <div className="mb-2 flex items-center gap-2">
          {uploading ? (
            <span className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
              <FiLoader size={14} className="animate-spin" /> Subiendo…
            </span>
          ) : attachment?.type === "image" ? (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={attachment.url}
                alt={attachment.name}
                className="h-20 rounded-lg border border-gray-200 object-cover"
              />
              <RemoveButton onClick={() => setAttachment(null)} />
            </div>
          ) : attachment ? (
            <div className="relative flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 py-2 pr-6 pl-3 text-xs text-gray-700">
              <FiFile size={14} className="shrink-0 text-gray-400" />
              <span className="max-w-48 truncate">{attachment.name}</span>
              <RemoveButton onClick={() => setAttachment(null)} inline />
            </div>
          ) : null}
        </div>
      )}

      <div
        className={`flex items-end gap-2 rounded-xl border px-3 py-2 ${
          recording ? "border-red-400 bg-red-50" : "border-gray-300"
        }`}
      >
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || recording}
          title="Adjuntar archivo"
          className="pb-1.5 text-gray-400 hover:text-gray-600 disabled:opacity-40"
        >
          <FiPaperclip size={18} />
        </button>
        <input ref={fileInputRef} type="file" hidden onChange={onPickFile} />

        <textarea
          rows={1}
          value={text}
          disabled={recording}
          placeholder={recording ? "Grabando audio…" : placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          className="max-h-40 flex-1 resize-none bg-transparent py-1 text-base outline-none sm:text-sm"
        />

        <button
          onClick={toggleRecording}
          disabled={sendingAudio}
          title={recording ? "Detener y enviar" : "Grabar nota de voz"}
          className={`pb-1.5 disabled:opacity-40 ${
            recording ? "animate-pulse text-red-600" : "text-gray-400 hover:text-gray-600"
          }`}
        >
          {recording ? <FiSquare size={18} /> : <FiMic size={18} />}
        </button>

        <button
          onClick={send}
          disabled={!canSend}
          title="Enviar"
          className="rounded-lg bg-violet-700 p-2 text-white hover:bg-violet-800 disabled:opacity-40"
        >
          <FiSend size={16} />
        </button>
      </div>
      {!compact && (
        <p className="mt-1 hidden text-[11px] text-gray-400 sm:block">
          **negrita** · _cursiva_ · ~~tachado~~ · `código` · ```bloque de código``` ·
          &gt; cita · Shift+Enter para salto de línea
        </p>
      )}
    </div>
  );
}

function RemoveButton({ onClick, inline }: { onClick: () => void; inline?: boolean }) {
  return (
    <button
      onClick={onClick}
      title="Quitar adjunto"
      className={
        inline
          ? "absolute top-1/2 right-1 -translate-y-1/2 rounded-full p-0.5 text-gray-400 hover:text-gray-700"
          : "absolute -top-1.5 -right-1.5 rounded-full bg-gray-700 p-0.5 text-white shadow hover:bg-gray-900"
      }
    >
      <FiX size={12} />
    </button>
  );
}
