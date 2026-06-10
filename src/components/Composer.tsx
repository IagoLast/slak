"use client";

import { useRef, useState } from "react";
import { FiMic, FiPaperclip, FiSend, FiSquare } from "react-icons/fi";

type Props = {
  channelId: string;
  placeholder: string;
  onSent: () => void;
};

export default function Composer({ channelId, placeholder, onSent }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);

  async function sendMessage(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/channels/${channelId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "No se pudo enviar el mensaje.");
      }
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al enviar.");
    } finally {
      setBusy(false);
    }
  }

  async function sendText() {
    const content = text.trim();
    if (!content || busy) return;
    setText("");
    await sendMessage({ content });
  }

  async function uploadAndSend(file: File, type: "file" | "image" | "audio") {
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "No se pudo subir el archivo.");
      await sendMessage({
        content: text.trim() || null,
        attachmentUrl: data.url,
        attachmentName: data.name,
        attachmentType: type,
      });
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al subir el archivo.");
      setBusy(false);
    }
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    uploadAndSend(file, file.type.startsWith("image/") ? "image" : "file");
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
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const ext = mimeType === "audio/webm" ? "webm" : "m4a";
        const blob = new Blob(chunks, { type: mimeType });
        if (blob.size > 0) {
          const file = new File([blob], `nota-de-voz.${ext}`, { type: mimeType });
          uploadAndSend(file, "audio");
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

  return (
    <div className="border-t border-gray-200 px-3 py-3 sm:px-5">
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <div
        className={`flex items-end gap-2 rounded-xl border px-3 py-2 ${
          recording ? "border-red-400 bg-red-50" : "border-gray-300"
        }`}
      >
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={busy || recording}
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
              sendText();
            }
          }}
          className="max-h-40 flex-1 resize-none bg-transparent py-1 text-base outline-none sm:text-sm"
        />

        <button
          onClick={toggleRecording}
          disabled={busy && !recording}
          title={recording ? "Detener y enviar" : "Grabar nota de voz"}
          className={`pb-1.5 disabled:opacity-40 ${
            recording ? "animate-pulse text-red-600" : "text-gray-400 hover:text-gray-600"
          }`}
        >
          {recording ? <FiSquare size={18} /> : <FiMic size={18} />}
        </button>

        <button
          onClick={sendText}
          disabled={busy || recording || !text.trim()}
          title="Enviar"
          className="rounded-lg bg-violet-700 p-2 text-white hover:bg-violet-800 disabled:opacity-40"
        >
          <FiSend size={16} />
        </button>
      </div>
    </div>
  );
}
