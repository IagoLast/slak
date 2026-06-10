"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FiHeadphones, FiMic, FiMicOff, FiPhoneOff } from "react-icons/fi";
import useSWR from "swr";
import { fetcher } from "@/lib/client";

type Participant = { id: string; name: string };
type Signal =
  | { kind: "offer"; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; sdp: RTCSessionDescriptionInit }
  | { kind: "candidate"; candidate: RTCIceCandidateInit };

type Peer = {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  pendingCandidates: RTCIceCandidateInit[];
};

const SYNC_INTERVAL_MS = 2000;
const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

/**
 * Huddle de audio por canal: malla WebRTC entre los participantes,
 * con señalización por polling contra /huddle/sync.
 */
export default function Huddle({
  channelId,
  userId,
}: {
  channelId: string;
  userId: string;
}) {
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, Peer>>(new Map());
  const outboxRef = useRef<{ to: string; data: Signal }[]>([]);

  // Cuando NO estamos dentro, solo consultamos si hay un huddle en marcha.
  const { data: idle } = useSWR<{ participants: Participant[] }>(
    joined ? null : `/api/channels/${channelId}/huddle`,
    fetcher,
    { refreshInterval: 6000 },
  );
  const idleCount = idle?.participants.length ?? 0;

  const closePeer = useCallback((peerId: string) => {
    const peer = peersRef.current.get(peerId);
    if (!peer) return;
    peer.pc.close();
    peer.audio.srcObject = null;
    peer.audio.remove();
    peersRef.current.delete(peerId);
  }, []);

  const ensurePeer = useCallback(
    (peerId: string): Peer => {
      const existing = peersRef.current.get(peerId);
      if (existing) return existing;

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      for (const track of streamRef.current?.getTracks() ?? []) {
        pc.addTrack(track, streamRef.current!);
      }

      const audio = document.createElement("audio");
      audio.autoplay = true;
      document.body.appendChild(audio);
      pc.ontrack = (e) => {
        audio.srcObject = e.streams[0];
      };
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          outboxRef.current.push({
            to: peerId,
            data: { kind: "candidate", candidate: e.candidate.toJSON() },
          });
        }
      };
      // Si la conexión muere, se descarta; el siguiente sync la recrea.
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          closePeer(peerId);
        }
      };

      const peer: Peer = { pc, audio, pendingCandidates: [] };
      peersRef.current.set(peerId, peer);
      return peer;
    },
    [closePeer],
  );

  const handleSignal = useCallback(
    async (from: string, data: Signal) => {
      if (data.kind === "offer") {
        const peer = ensurePeer(from);
        await peer.pc.setRemoteDescription(data.sdp);
        for (const c of peer.pendingCandidates.splice(0)) {
          await peer.pc.addIceCandidate(c).catch(() => {});
        }
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        outboxRef.current.push({ to: from, data: { kind: "answer", sdp: answer } });
      } else if (data.kind === "answer") {
        const peer = peersRef.current.get(from);
        if (!peer) return;
        await peer.pc.setRemoteDescription(data.sdp);
        for (const c of peer.pendingCandidates.splice(0)) {
          await peer.pc.addIceCandidate(c).catch(() => {});
        }
      } else if (data.kind === "candidate") {
        const peer = peersRef.current.get(from);
        if (!peer) return;
        if (peer.pc.remoteDescription) {
          await peer.pc.addIceCandidate(data.candidate).catch(() => {});
        } else {
          peer.pendingCandidates.push(data.candidate);
        }
      }
    },
    [ensurePeer],
  );

  // Bucle principal mientras estamos dentro del huddle.
  useEffect(() => {
    if (!joined) return;
    let stopped = false;
    const peers = peersRef.current;

    async function tick() {
      const signals = outboxRef.current.splice(0);
      let res: Response;
      try {
        res = await fetch(`/api/channels/${channelId}/huddle/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signals }),
        });
      } catch {
        outboxRef.current.unshift(...signals);
        return;
      }
      if (!res.ok || stopped) return;
      const data: {
        participants: Participant[];
        signals: { from: string; data: Signal }[];
      } = await res.json();

      setParticipants(data.participants);

      const activeIds = new Set(data.participants.map((p) => p.id));
      // Para evitar ofertas cruzadas, inicia la conexión quien tenga el id menor.
      for (const p of data.participants) {
        if (p.id === userId || peersRef.current.has(p.id) || userId > p.id) continue;
        const peer = ensurePeer(p.id);
        const offer = await peer.pc.createOffer();
        await peer.pc.setLocalDescription(offer);
        outboxRef.current.push({ to: p.id, data: { kind: "offer", sdp: offer } });
      }
      for (const peerId of [...peersRef.current.keys()]) {
        if (!activeIds.has(peerId)) closePeer(peerId);
      }
      for (const s of data.signals) {
        if (stopped) break;
        await handleSignal(s.from, s.data).catch(() => {});
      }
    }

    tick();
    const interval = setInterval(tick, SYNC_INTERVAL_MS);
    const onUnload = () => {
      navigator.sendBeacon(`/api/channels/${channelId}/huddle/leave`);
    };
    window.addEventListener("pagehide", onUnload);

    return () => {
      stopped = true;
      clearInterval(interval);
      window.removeEventListener("pagehide", onUnload);
      for (const peerId of [...peers.keys()]) closePeer(peerId);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      outboxRef.current = [];
      fetch(`/api/channels/${channelId}/huddle/leave`, { method: "POST" }).catch(
        () => {},
      );
    };
  }, [joined, channelId, userId, ensurePeer, closePeer, handleSignal]);

  async function join() {
    setError(null);
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      setError("No se pudo acceder al micrófono.");
      return;
    }
    const res = await fetch(`/api/channels/${channelId}/huddle/join`, {
      method: "POST",
    });
    if (!res.ok) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setError("No se pudo entrar al huddle.");
      return;
    }
    const data = await res.json();
    setParticipants(data.participants);
    setMuted(false);
    setJoined(true);
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    streamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
  }

  if (!joined) {
    return (
      <div className="flex items-center gap-2">
        {error && <span className="hidden text-xs text-red-600 sm:inline">{error}</span>}
        <button
          onClick={join}
          title={idleCount > 0 ? "Unirse al huddle" : "Iniciar un huddle"}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium ${
            idleCount > 0
              ? "border-green-600 bg-green-600 text-white hover:bg-green-700"
              : "border-gray-300 text-gray-600 hover:bg-gray-50"
          }`}
        >
          <FiHeadphones size={13} />
          {idleCount > 0 ? `Unirse · ${idleCount}` : "Huddle"}
        </button>
      </div>
    );
  }

  const others = participants.filter((p) => p.id !== userId);

  return (
    <div className="flex items-center gap-1.5">
      <span className="flex items-center gap-1.5 rounded-lg bg-green-100 px-2 py-1 text-xs font-medium text-green-800">
        <FiHeadphones size={13} />
        {participants.length}
        <span className="hidden max-w-40 truncate sm:inline">
          {others.length > 0 ? `· ${others.map((p) => p.name).join(", ")}` : "· solo tú"}
        </span>
      </span>
      <button
        onClick={toggleMute}
        title={muted ? "Activar micrófono" : "Silenciar micrófono"}
        className={`rounded-lg p-1.5 ${
          muted
            ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
            : "text-gray-500 hover:bg-gray-100"
        }`}
      >
        {muted ? <FiMicOff size={15} /> : <FiMic size={15} />}
      </button>
      <button
        onClick={() => setJoined(false)}
        title="Salir del huddle"
        className="rounded-lg bg-red-600 p-1.5 text-white hover:bg-red-700"
      >
        <FiPhoneOff size={15} />
      </button>
    </div>
  );
}
