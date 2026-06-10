"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  FiHeadphones,
  FiMic,
  FiMicOff,
  FiMonitor,
  FiPhoneOff,
  FiVideo,
  FiVideoOff,
} from "react-icons/fi";
import useSWR from "swr";
import { fetcher } from "@/lib/client";

type Participant = { id: string; name: string };
type Signal =
  | { kind: "description"; sdp: RTCSessionDescriptionInit }
  | { kind: "candidate"; candidate: RTCIceCandidateInit };

type Peer = {
  pc: RTCPeerConnection;
  // Negociación "perfecta": el par polite cede si dos ofertas se cruzan.
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  pendingCandidates: RTCIceCandidateInit[];
};

const SYNC_INTERVAL_MS = 2000;
const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

/**
 * Huddle por canal: audio, cámara y pantalla compartida sobre una malla
 * WebRTC, con señalización por polling contra /huddle/sync. Al unirse se
 * abre un panel flotante con los vídeos y los controles.
 */
export default function Huddle({
  channelId,
  channelName,
  userId,
}: {
  channelId: string;
  channelName: string;
  userId: string;
}) {
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [localVideoTrack, setLocalVideoTrack] = useState<MediaStreamTrack | null>(
    null,
  );
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(
    new Map(),
  );
  const [error, setError] = useState<string | null>(null);
  // Cambia cuando entran/salen pistas remotas para refrescar las tarjetas.
  const [, setTrackVersion] = useState(0);

  const micStreamRef = useRef<MediaStream | null>(null);
  const camTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  // Stream saliente único: así el receptor agrupa nuestras pistas.
  const sendStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, Peer>>(new Map());
  const outboxRef = useRef<{ to: string; data: Signal }[]>([]);

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
    peersRef.current.delete(peerId);
    setRemoteStreams((prev) => {
      const next = new Map(prev);
      next.delete(peerId);
      return next;
    });
  }, []);

  const ensurePeer = useCallback(
    (peerId: string): Peer => {
      const existing = peersRef.current.get(peerId);
      if (existing) return existing;

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const peer: Peer = {
        pc,
        polite: userId > peerId,
        makingOffer: false,
        ignoreOffer: false,
        pendingCandidates: [],
      };

      const sendStream = sendStreamRef.current;
      for (const track of sendStream?.getTracks() ?? []) {
        pc.addTrack(track, sendStream!);
      }

      pc.onnegotiationneeded = async () => {
        try {
          peer.makingOffer = true;
          await pc.setLocalDescription();
          outboxRef.current.push({
            to: peerId,
            data: { kind: "description", sdp: pc.localDescription!.toJSON() },
          });
        } catch {
          // la siguiente renegociación lo reintenta
        } finally {
          peer.makingOffer = false;
        }
      };
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          outboxRef.current.push({
            to: peerId,
            data: { kind: "candidate", candidate: e.candidate.toJSON() },
          });
        }
      };
      pc.ontrack = (e) => {
        const stream = e.streams[0];
        if (!stream) return;
        stream.onaddtrack = () => setTrackVersion((v) => v + 1);
        stream.onremovetrack = () => setTrackVersion((v) => v + 1);
        setRemoteStreams((prev) => {
          if (prev.get(peerId) === stream) return prev;
          const next = new Map(prev);
          next.set(peerId, stream);
          return next;
        });
        setTrackVersion((v) => v + 1);
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          closePeer(peerId);
        }
      };

      peersRef.current.set(peerId, peer);
      return peer;
    },
    [userId, closePeer],
  );

  const handleSignal = useCallback(
    async (from: string, data: Signal) => {
      const peer = ensurePeer(from);
      const { pc } = peer;

      if (data.kind === "description") {
        const desc = data.sdp;
        const collision =
          desc.type === "offer" &&
          (peer.makingOffer || pc.signalingState !== "stable");
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;

        await pc.setRemoteDescription(desc);
        for (const c of peer.pendingCandidates.splice(0)) {
          await pc.addIceCandidate(c).catch(() => {});
        }
        if (desc.type === "offer") {
          await pc.setLocalDescription();
          outboxRef.current.push({
            to: from,
            data: { kind: "description", sdp: pc.localDescription!.toJSON() },
          });
        }
      } else if (data.kind === "candidate") {
        if (pc.remoteDescription) {
          await pc.addIceCandidate(data.candidate).catch(() => {
            if (!peer.ignoreOffer) throw new Error("candidato inválido");
          });
        } else {
          peer.pendingCandidates.push(data.candidate);
        }
      }
    },
    [ensurePeer],
  );

  // Bucle principal mientras estamos dentro.
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
      for (const p of data.participants) {
        if (p.id !== userId && !peers.has(p.id)) ensurePeer(p.id);
      }
      for (const peerId of [...peers.keys()]) {
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
      for (const ref of [micStreamRef]) {
        ref.current?.getTracks().forEach((t) => t.stop());
        ref.current = null;
      }
      camTrackRef.current?.stop();
      camTrackRef.current = null;
      screenTrackRef.current?.stop();
      screenTrackRef.current = null;
      sendStreamRef.current = null;
      outboxRef.current = [];
      setLocalVideoTrack(null);
      setRemoteStreams(new Map());
      fetch(`/api/channels/${channelId}/huddle/leave`, { method: "POST" }).catch(
        () => {},
      );
    };
  }, [joined, channelId, userId, ensurePeer, closePeer, handleSignal]);

  async function join() {
    setError(null);
    try {
      micStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      setError("No se pudo acceder al micrófono.");
      return;
    }
    sendStreamRef.current = new MediaStream(micStreamRef.current.getTracks());

    const res = await fetch(`/api/channels/${channelId}/huddle/join`, {
      method: "POST",
    });
    if (!res.ok) {
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      setError("No se pudo entrar al huddle.");
      return;
    }
    setParticipants((await res.json()).participants);
    setMuted(false);
    setCamOn(false);
    setSharing(false);
    setJoined(true);
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    micStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
  }

  function addVideoTrackToPeers(track: MediaStreamTrack) {
    sendStreamRef.current?.addTrack(track);
    for (const { pc } of peersRef.current.values()) {
      pc.addTrack(track, sendStreamRef.current!);
    }
  }

  function removeVideoTrack(track: MediaStreamTrack) {
    track.stop();
    sendStreamRef.current?.removeTrack(track);
    for (const { pc } of peersRef.current.values()) {
      const sender = pc.getSenders().find((s) => s.track === track);
      if (sender) pc.removeTrack(sender);
    }
  }

  function stopCamera() {
    if (camTrackRef.current) removeVideoTrack(camTrackRef.current);
    camTrackRef.current = null;
    setCamOn(false);
    setLocalVideoTrack(null);
  }

  function stopShare() {
    if (screenTrackRef.current) removeVideoTrack(screenTrackRef.current);
    screenTrackRef.current = null;
    setSharing(false);
    setLocalVideoTrack(null);
  }

  async function toggleCamera() {
    if (camOn) {
      stopCamera();
      return;
    }
    if (sharing) stopShare();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
      });
      const track = stream.getVideoTracks()[0];
      camTrackRef.current = track;
      addVideoTrackToPeers(track);
      setCamOn(true);
      setLocalVideoTrack(track);
    } catch {
      setError("No se pudo acceder a la cámara.");
    }
  }

  async function toggleShare() {
    if (sharing) {
      stopShare();
      return;
    }
    if (camOn) stopCamera();
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
      });
      const track = stream.getVideoTracks()[0];
      track.onended = () => stopShare();
      screenTrackRef.current = track;
      addVideoTrackToPeers(track);
      setSharing(true);
      setLocalVideoTrack(track);
    } catch {
      // el usuario canceló el selector
    }
  }

  const canShare =
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function";

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

  return (
    <>
      <span className="flex items-center gap-1.5 rounded-lg bg-green-100 px-2 py-1 text-xs font-medium text-green-800">
        <FiHeadphones size={13} />
        En el huddle · {participants.length}
      </span>
      {typeof document !== "undefined" &&
        createPortal(
          <HuddlePanel
            channelName={channelName}
            participants={participants}
            userId={userId}
            remoteStreams={remoteStreams}
            localVideoTrack={localVideoTrack}
            muted={muted}
            camOn={camOn}
            sharing={sharing}
            canShare={canShare}
            error={error}
            onToggleMute={toggleMute}
            onToggleCamera={toggleCamera}
            onToggleShare={toggleShare}
            onLeave={() => setJoined(false)}
          />,
          document.body,
        )}
    </>
  );
}

function HuddlePanel({
  channelName,
  participants,
  userId,
  remoteStreams,
  localVideoTrack,
  muted,
  camOn,
  sharing,
  canShare,
  error,
  onToggleMute,
  onToggleCamera,
  onToggleShare,
  onLeave,
}: {
  channelName: string;
  participants: Participant[];
  userId: string;
  remoteStreams: Map<string, MediaStream>;
  localVideoTrack: MediaStreamTrack | null;
  muted: boolean;
  camOn: boolean;
  sharing: boolean;
  canShare: boolean;
  error: string | null;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onToggleShare: () => void;
  onLeave: () => void;
}) {
  const others = participants.filter((p) => p.id !== userId);
  const localStream = useMemo(
    () => (localVideoTrack ? new MediaStream([localVideoTrack]) : null),
    [localVideoTrack],
  );
  const anyVideo =
    localVideoTrack !== null ||
    [...remoteStreams.values()].some((s) =>
      s.getVideoTracks().some((t) => t.readyState === "live"),
    );

  return (
    <div className="fixed inset-x-2 bottom-2 z-40 rounded-2xl bg-gray-900 p-3 text-white shadow-2xl sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-96">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
          <FiHeadphones size={14} className="shrink-0 text-green-400" />
          <span className="truncate">{channelName}</span>
        </p>
        <span className="text-xs text-gray-400">{participants.length} dentro</span>
      </div>

      {error && <p className="mb-2 text-xs text-red-400">{error}</p>}

      <div className={`mb-3 grid gap-2 ${anyVideo ? "grid-cols-2" : "grid-cols-4"}`}>
        {localStream ? (
          <VideoTile stream={localStream} label="Tú" mirrored={camOn} />
        ) : (
          <AvatarTile name="Tú" compact={!anyVideo} />
        )}
        {others.map((p) => {
          const stream = remoteStreams.get(p.id);
          const hasVideo = stream
            ?.getVideoTracks()
            .some((t) => t.readyState === "live");
          return hasVideo && stream ? (
            <VideoTile key={p.id} stream={stream} label={p.name} />
          ) : (
            <AvatarTile key={p.id} name={p.name} compact={!anyVideo} />
          );
        })}
      </div>

      {/* Audio remoto: siempre presente aunque no haya vídeo a la vista */}
      {[...remoteStreams.entries()].map(([peerId, stream]) => (
        <RemoteAudio key={peerId} stream={stream} />
      ))}

      <div className="flex items-center justify-center gap-2">
        <ControlButton
          onClick={onToggleMute}
          active={!muted}
          title={muted ? "Activar micrófono" : "Silenciar"}
        >
          {muted ? <FiMicOff size={16} /> : <FiMic size={16} />}
        </ControlButton>
        <ControlButton
          onClick={onToggleCamera}
          active={camOn}
          title={camOn ? "Apagar cámara" : "Encender cámara"}
        >
          {camOn ? <FiVideo size={16} /> : <FiVideoOff size={16} />}
        </ControlButton>
        {canShare && (
          <ControlButton
            onClick={onToggleShare}
            active={sharing}
            title={sharing ? "Dejar de compartir" : "Compartir pantalla"}
          >
            <FiMonitor size={16} />
          </ControlButton>
        )}
        <button
          onClick={onLeave}
          title="Salir del huddle"
          className="ml-2 rounded-full bg-red-600 p-2.5 hover:bg-red-700"
        >
          <FiPhoneOff size={16} />
        </button>
      </div>
    </div>
  );
}

function ControlButton({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded-full p-2.5 ${
        active ? "bg-gray-600 hover:bg-gray-500" : "bg-gray-800 hover:bg-gray-700"
      }`}
    >
      {children}
    </button>
  );
}

function VideoTile({
  stream,
  label,
  mirrored = false,
}: {
  stream: MediaStream;
  label: string;
  mirrored?: boolean;
}) {
  // Siempre silenciado: el audio remoto lo reproduce RemoteAudio,
  // y el local no debe oírse a sí mismo.
  return (
    <div className="relative col-span-2 overflow-hidden rounded-lg bg-black">
      <video
        autoPlay
        playsInline
        muted
        className={`aspect-video w-full object-contain ${mirrored ? "-scale-x-100" : ""}`}
        ref={(el) => {
          if (el && el.srcObject !== stream) el.srcObject = stream;
        }}
      />
      <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px]">
        {label}
      </span>
    </div>
  );
}

function AvatarTile({ name, compact }: { name: string; compact: boolean }) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-1 rounded-lg bg-gray-800 ${
        compact ? "aspect-square" : "col-span-1 aspect-video"
      }`}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-600 text-sm font-bold">
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span className="max-w-full truncate px-1 text-[10px] text-gray-300">{name}</span>
    </div>
  );
}

/**
 * Reproduce el audio de un par. Un elemento <audio> ignora las pistas de
 * vídeo del stream, así que puede recibirlo entero; el vídeo va en su
 * tarjeta correspondiente, silenciada.
 */
function RemoteAudio({ stream }: { stream: MediaStream }) {
  return (
    <audio
      autoPlay
      ref={(el) => {
        if (el && el.srcObject !== stream) el.srcObject = stream;
      }}
    />
  );
}
