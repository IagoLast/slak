"use client";

import { signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  FiAtSign,
  FiBell,
  FiBellOff,
  FiHash,
  FiLock,
  FiLogOut,
  FiPlus,
  FiUserPlus,
  FiX,
} from "react-icons/fi";
import useSWR from "swr";
import { fetcher, Summary, SummaryChannel } from "@/lib/client";
import { SessionUser } from "@/lib/session";

const NOTIF_PREF_KEY = "slak:notifications";

function notificationsEnabled() {
  return (
    typeof window === "undefined" ||
    window.localStorage.getItem(NOTIF_PREF_KEY) !== "off"
  );
}

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
  const [showNotifSettings, setShowNotifSettings] = useState(false);

  // Notificaciones del navegador cuando suben los no-leídos de otros canales.
  const prevUnread = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    if (!data) return;
    const prev = prevUnread.current;
    if (
      prev.size > 0 &&
      typeof Notification !== "undefined" &&
      Notification.permission === "granted" &&
      notificationsEnabled()
    ) {
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
        <button
          onClick={() => setShowNotifSettings(true)}
          title="Ajustes de notificaciones"
          className="rounded p-1.5 text-violet-300 hover:bg-violet-900 hover:text-white"
        >
          <FiBell size={16} />
        </button>
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
              className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-violet-900 ${
                pathname === "/invites" ? "bg-violet-800 text-white" : "text-violet-300"
              }`}
            >
              <FiUserPlus size={15} />
              Invitar personas
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
          className="rounded p-1.5 text-violet-300 hover:bg-violet-900 hover:text-white"
        >
          <FiLogOut size={16} />
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

      {showNotifSettings && (
        <NotificationSettingsModal onClose={() => setShowNotifSettings(false)} />
      )}
    </aside>
  );
}

function NotificationSettingsModal({ onClose }: { onClose: () => void }) {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    () => (typeof Notification === "undefined" ? "unsupported" : Notification.permission),
  );
  const [enabled, setEnabled] = useState(notificationsEnabled);

  async function requestPermission() {
    if (typeof Notification === "undefined") return;
    setPermission(await Notification.requestPermission());
  }

  function toggleEnabled() {
    const next = !enabled;
    setEnabled(next);
    window.localStorage.setItem(NOTIF_PREF_KEY, next ? "on" : "off");
  }

  function sendTest() {
    new Notification("Slak", { body: "Así se verán las notificaciones 🎉" });
  }

  const ready = permission === "granted" && enabled;

  return (
    <Modal title="Notificaciones" onClose={onClose}>
      <div className="space-y-4">
        {permission === "unsupported" && (
          <p className="text-sm text-gray-500">
            Este navegador no soporta notificaciones.
          </p>
        )}

        {permission === "default" && (
          <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            <p className="mb-2">
              El navegador aún no tiene permiso para mostrar notificaciones.
            </p>
            <button
              onClick={requestPermission}
              className="rounded-lg bg-violet-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-800"
            >
              Conceder permiso
            </button>
          </div>
        )}

        {permission === "denied" && (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
            Las notificaciones están bloqueadas. Actívalas en los ajustes del
            navegador (icono del candado junto a la dirección) y recarga la página.
          </p>
        )}

        {permission !== "unsupported" && (
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span className="text-sm text-gray-800">
              Avisarme de mensajes nuevos en otros canales
            </span>
            <button
              role="switch"
              aria-checked={enabled}
              onClick={toggleEnabled}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                enabled ? "bg-violet-600" : "bg-gray-300"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  enabled ? "translate-x-[22px]" : "translate-x-0.5"
                }`}
              />
            </button>
          </label>
        )}

        {ready ? (
          <button
            onClick={sendTest}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <FiBell size={14} /> Enviar notificación de prueba
          </button>
        ) : (
          permission !== "unsupported" && (
            <p className="flex items-center gap-2 text-xs text-gray-400">
              <FiBellOff size={13} /> Ahora mismo no recibirás notificaciones.
            </p>
          )
        )}
      </div>
    </Modal>
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
          className="rounded p-1 text-violet-300 hover:bg-violet-900 hover:text-white"
        >
          <FiPlus size={14} />
        </button>
      )}
    </div>
  );
}

export function ChannelIcon({
  type,
  size = 14,
}: {
  type: "public" | "private" | "dm";
  size?: number;
}) {
  if (type === "public") return <FiHash size={size} />;
  if (type === "private") return <FiLock size={size} />;
  return <FiAtSign size={size} />;
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
        <span className="flex w-4 justify-center text-violet-400">
          <ChannelIcon type={channel.type} />
        </span>
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
  // Portal al body: el drawer del sidebar usa transform, que convertiría
  // este `fixed` en relativo a la columna del sidebar en vez de a la pantalla.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85dvh] w-full max-w-sm overflow-y-auto rounded-xl bg-white p-5 text-gray-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <FiX size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
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
