"use client";

import { signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { fetcher, Summary, SummaryChannel } from "@/lib/client";
import { SessionUser } from "@/lib/session";

export default function Sidebar({
  currentUser,
  onNavigate,
}: {
  currentUser: SessionUser;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const activeChannelId = pathname.startsWith("/c/") ? pathname.slice(3) : null;

  const { data, mutate } = useSWR<Summary>("/api/me/summary", fetcher, {
    refreshInterval: 5000,
  });

  const [showNewChannel, setShowNewChannel] = useState(false);
  const [showDmPicker, setShowDmPicker] = useState(false);
  const [notifReady, setNotifReady] = useState(false);

  // Notificaciones del navegador cuando suben los no-leídos de otros canales.
  const prevUnread = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    if (typeof Notification !== "undefined") {
      // Lectura única de un estado externo del navegador al montar; no puede
      // hacerse en el render inicial porque rompería la hidratación SSR.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNotifReady(Notification.permission === "granted");
    }
  }, []);
  useEffect(() => {
    if (!data) return;
    const prev = prevUnread.current;
    if (prev.size > 0 && typeof Notification !== "undefined" && Notification.permission === "granted") {
      for (const channel of data.channels) {
        const before = prev.get(channel.id) ?? 0;
        const isActiveAndVisible =
          channel.id === activeChannelId && document.visibilityState === "visible";
        if (channel.unread > before && !isActiveAndVisible) {
          const title = channel.type === "dm" ? channel.name : `#${channel.name}`;
          new Notification(title, {
            body: "Tienes mensajes nuevos",
            tag: channel.id,
          });
        }
      }
    }
    prevUnread.current = new Map(data.channels.map((c) => [c.id, c.unread]));
  }, [data, activeChannelId]);

  async function requestNotifications() {
    if (typeof Notification === "undefined") return;
    const permission = await Notification.requestPermission();
    setNotifReady(permission === "granted");
  }

  async function openDm(userId: string) {
    setShowDmPicker(false);
    onNavigate?.();
    const res = await fetch("/api/dms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (res.ok) {
      const { channelId } = await res.json();
      mutate();
      router.push(`/c/${channelId}`);
    }
  }

  const channels = data?.channels.filter((c) => c.type !== "dm") ?? [];
  const dms = data?.channels.filter((c) => c.type === "dm") ?? [];
  const otherUsers = data?.users.filter((u) => u.id !== currentUser.id) ?? [];

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col bg-violet-950 text-violet-100 md:w-64">
      <div className="flex items-center justify-between border-b border-violet-900 px-4 py-3">
        <span className="text-lg font-bold text-white">Slak</span>
        {!notifReady && (
          <button
            onClick={requestNotifications}
            title="Activar notificaciones"
            className="rounded px-2 py-1 text-xs text-violet-300 hover:bg-violet-900"
          >
            🔔 Activar
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <SectionHeader
          label="Canales"
          onAdd={currentUser.role !== "guest" ? () => setShowNewChannel(true) : undefined}
        />
        <ul>
          {channels.map((channel) => (
            <ChannelLink
              key={channel.id}
              channel={channel}
              active={channel.id === activeChannelId}
              onNavigate={onNavigate}
            />
          ))}
        </ul>

        <div className="mt-5" />
        <SectionHeader label="Mensajes directos" onAdd={() => setShowDmPicker(true)} />
        <ul>
          {dms.map((channel) => (
            <ChannelLink
              key={channel.id}
              channel={channel}
              active={channel.id === activeChannelId}
              onNavigate={onNavigate}
            />
          ))}
        </ul>

        {currentUser.role === "admin" && (
          <div className="mt-6 border-t border-violet-900 pt-3">
            <Link
              href="/invites"
              onClick={onNavigate}
              className={`block rounded px-2 py-1.5 text-sm hover:bg-violet-900 ${
                pathname === "/invites" ? "bg-violet-800 text-white" : "text-violet-300"
              }`}
            >
              ✉️ Invitar personas
            </Link>
          </div>
        )}
      </nav>

      <div className="flex items-center gap-2 border-t border-violet-900 px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-700 text-sm font-semibold text-white">
          {currentUser.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{currentUser.name}</p>
          <p className="truncate text-xs text-violet-400">
            {currentUser.role === "guest" ? "Invitado externo" : currentUser.role}
          </p>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          title="Cerrar sesión"
          className="rounded px-2 py-1 text-xs text-violet-300 hover:bg-violet-900"
        >
          Salir
        </button>
      </div>

      {showNewChannel && (
        <NewChannelModal
          onClose={() => setShowNewChannel(false)}
          onCreated={(id) => {
            setShowNewChannel(false);
            onNavigate?.();
            mutate();
            router.push(`/c/${id}`);
          }}
        />
      )}

      {showDmPicker && (
        <Modal title="Nuevo mensaje directo" onClose={() => setShowDmPicker(false)}>
          {otherUsers.length === 0 ? (
            <p className="text-sm text-gray-500">No hay más personas todavía.</p>
          ) : (
            <ul className="max-h-72 divide-y divide-gray-100 overflow-y-auto">
              {otherUsers.map((u) => (
                <li key={u.id}>
                  <button
                    onClick={() => openDm(u.id)}
                    className="flex w-full items-center gap-2 px-2 py-2 text-left text-sm text-gray-800 hover:bg-gray-50"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-700">
                      {u.name.slice(0, 1).toUpperCase()}
                    </span>
                    {u.name}
                    {u.role === "guest" && (
                      <span className="ml-auto text-xs text-gray-400">externo</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </aside>
  );
}

function SectionHeader({ label, onAdd }: { label: string; onAdd?: () => void }) {
  return (
    <div className="mb-1 flex items-center justify-between px-2">
      <span className="text-xs font-semibold tracking-wide text-violet-400 uppercase">
        {label}
      </span>
      {onAdd && (
        <button
          onClick={onAdd}
          title={`Añadir ${label.toLowerCase()}`}
          className="rounded px-1.5 text-violet-300 hover:bg-violet-900"
        >
          +
        </button>
      )}
    </div>
  );
}

function ChannelLink({
  channel,
  active,
  onNavigate,
}: {
  channel: SummaryChannel;
  active: boolean;
  onNavigate?: () => void;
}) {
  const icon = channel.type === "public" ? "#" : channel.type === "private" ? "🔒" : "@";
  return (
    <li>
      <Link
        href={`/c/${channel.id}`}
        onClick={onNavigate}
        className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm ${
          active
            ? "bg-violet-800 font-semibold text-white"
            : channel.unread > 0
              ? "font-semibold text-white hover:bg-violet-900"
              : "text-violet-300 hover:bg-violet-900"
        }`}
      >
        <span className="w-4 text-center text-violet-400">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{channel.name}</span>
        {channel.unread > 0 && (
          <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-xs font-bold text-white">
            {channel.unread > 99 ? "99+" : channel.unread}
          </span>
        )}
      </Link>
    </li>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white p-5 text-gray-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function NewChannelModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, isPrivate }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error ?? "No se pudo crear el canal.");
      return;
    }
    onCreated(data.id);
  }

  return (
    <Modal title="Nuevo canal" onClose={onClose}>
      <form onSubmit={create} className="space-y-3">
        <input
          autoFocus
          placeholder="nombre-del-canal"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base outline-none sm:text-sm focus:border-violet-500"
        />
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
          />
          Canal privado (solo miembros añadidos)
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          className="w-full rounded-lg bg-violet-700 py-2 text-sm font-semibold text-white hover:bg-violet-800"
        >
          Crear canal
        </button>
      </form>
    </Modal>
  );
}
