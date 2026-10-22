"use client";

import { signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  AtSign,
  Bell,
  Bot,
  Hash,
  ListTodo,
  Lock,
  LogOut,
  MoreHorizontal,
  Plus,
  Server,
  Trash2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import useSWR from "swr";
import {
  api,
  fetcher,
  Summary,
  SummaryChannel,
  AgentContact,
} from "@/lib/client";
import type { SessionUser } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

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
  const router = useRouter(),
    pathname = usePathname();
  const activeChannelId = pathname.startsWith("/c/") ? pathname.slice(3) : null;
  const { data, error, mutate } = useSWR<Summary>("/api/me/summary", fetcher, {
    refreshInterval: 5000,
    refreshWhenHidden: true,
  });
  const { data: agentData } = useSWR<{ agents: AgentContact[] }>(
    "/api/agents",
    fetcher,
    { refreshInterval: 5000 },
  );
  const [modal, setModal] = useState<"channel" | "dm" | "notifications" | null>(
    null,
  );
  const [deleting, setDeleting] = useState<SummaryChannel | null>(null);
  const [busy, setBusy] = useState(false);
  const prevUnread = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    if (!data) return;
    if (
      prevUnread.current.size &&
      typeof Notification !== "undefined" &&
      Notification.permission === "granted" &&
      notificationsEnabled()
    ) {
      for (const c of data.channels) {
        if (
          c.unread > (prevUnread.current.get(c.id) ?? 0) &&
          !(c.id === activeChannelId && document.visibilityState === "visible")
        ) {
          new Notification(c.type === "dm" ? c.name : `#${c.name}`, {
            body: c.lastMessage
              ? `${c.lastMessage.author}: ${c.lastMessage.preview}`
              : "Tienes mensajes nuevos",
            tag: c.id,
          });
        }
      }
    }
    prevUnread.current = new Map(data.channels.map((c) => [c.id, c.unread]));
  }, [data, activeChannelId]);

  async function openDm(userId: string) {
    try {
      const { channelId } = await api<{ channelId: string }>(
        "/api/dms",
        "POST",
        { userId },
      );
      setModal(null);
      onNavigate?.();
      await mutate();
      router.push(`/c/${channelId}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function deleteChannel() {
    if (!deleting || busy) return;
    setBusy(true);
    try {
      await api(`/api/channels/${deleting.id}`, "DELETE");
      const remaining =
        data?.channels.filter((c) => c.id !== deleting.id) ?? [];
      await mutate(data ? { ...data, channels: remaining } : undefined, {
        revalidate: false,
      });
      if (activeChannelId === deleting.id)
        router.replace(remaining[0] ? `/c/${remaining[0].id}` : "/");
      setDeleting(null);
      toast.success("Canal eliminado");
      void mutate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const humanIds = new Set(
    data?.users.filter((u) => u.kind !== "agent").map((u) => u.id),
  );
  const channels = data?.channels.filter((c) => c.type !== "dm") ?? [];
  const dms =
    data?.channels.filter(
      (c) => c.type === "dm" && c.dmUserId && humanIds.has(c.dmUserId),
    ) ?? [];
  const online = new Map(data?.users.map((u) => [u.id, u.online]));
  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center gap-3 border-b px-4">
        <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">
          s
        </div>
        <div className="flex-1">
          <p className="font-semibold tracking-tight">Slak</p>
          <p className="text-xs text-muted-foreground">Tu equipo, conectado</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Ajustes de notificaciones"
          onClick={() => setModal("notifications")}
        >
          <Bell />
        </Button>
      </div>
      <nav
        className="flex-1 space-y-5 overflow-y-auto p-3"
        aria-label="Navegación principal"
      >
        <div className="space-y-1">
          <NavLink
            href="/agents"
            active={pathname === "/agents"}
            onClick={onNavigate}
          >
            <Bot /> Agentes del equipo
          </NavLink>
          <NavLink
            href="/machines"
            active={pathname === "/machines"}
            onClick={onNavigate}
          >
            <Server /> Máquinas compartidas
          </NavLink>
          <NavLink
            href="/tasks"
            active={pathname === "/tasks"}
            onClick={onNavigate}
          >
            <ListTodo /> Tareas
          </NavLink>
        </div>
        <div>
          <SectionHeader
            label="Canales"
            onAdd={
              currentUser.role !== "guest"
                ? () => setModal("channel")
                : undefined
            }
          />
          {error && (
            <p role="alert" className="p-2 text-xs text-destructive">
              No se pudieron cargar los canales.
            </p>
          )}
          {!data && !error && (
            <div className="space-y-2 p-2">
              <Skeleton className="h-7" />
              <Skeleton className="h-7" />
            </div>
          )}
          <ul className="space-y-0.5">
            {channels.map((channel) => (
              <ChannelLink
                key={channel.id}
                channel={channel}
                active={channel.id === activeChannelId}
                onNavigate={onNavigate}
                onDelete={() => setDeleting(channel)}
              />
            ))}
          </ul>
          {data && !channels.length && (
            <p className="p-2 text-xs text-muted-foreground">
              Crea tu primer canal.
            </p>
          )}
        </div>
        <div>
          <SectionHeader label="Agentes" />
          <ul className="space-y-0.5">
            {agentData?.agents.map((agent) => (
              <li key={agent.id}>
                <Button
                  variant="ghost"
                  className="w-full justify-start font-normal"
                  onClick={() => openDm(agent.id)}
                >
                  <Bot className="text-muted-foreground" />
                  <span className="flex-1 truncate text-left">
                    {agent.name}
                  </span>
                  <PresenceDot online={agent.online} />
                </Button>
              </li>
            ))}
          </ul>
          {!agentData?.agents.length && (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              Comparte una sesión de Orca.
            </p>
          )}
        </div>
        <div>
          <SectionHeader
            label="Mensajes directos"
            onAdd={() => setModal("dm")}
          />
          <ul className="space-y-0.5">
            {dms.map((channel) => (
              <ChannelLink
                key={channel.id}
                channel={channel}
                active={channel.id === activeChannelId}
                online={online.get(channel.dmUserId!)}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        </div>
        {currentUser.role === "admin" && (
          <NavLink
            href="/invites"
            active={pathname === "/invites"}
            onClick={onNavigate}
          >
            <UserPlus /> Invitar personas
          </NavLink>
        )}
      </nav>
      <div className="flex items-center gap-3 border-t p-4">
        <Avatar>
          <AvatarFallback>
            {currentUser.name.slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{currentUser.name}</p>
          <p className="text-xs text-muted-foreground">
            {currentUser.role === "guest" ? "Invitado" : "Miembro del equipo"}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Cerrar sesión"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          <LogOut />
        </Button>
      </div>
      {modal === "channel" && (
        <NewChannelModal
          onClose={() => setModal(null)}
          onCreated={(id) => {
            setModal(null);
            onNavigate?.();
            void mutate();
            router.push(`/c/${id}`);
          }}
        />
      )}
      <Dialog
        open={modal === "dm"}
        onOpenChange={(open) => !open && setModal(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo mensaje directo</DialogTitle>
            <DialogDescription>
              Habla con una persona o un agente del equipo.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {data?.users
              .filter((u) => u.id !== currentUser.id)
              .map((u) => (
                <Button
                  key={u.id}
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => openDm(u.id)}
                >
                  {u.kind === "agent" && <Bot />}
                  {u.name}
                  <PresenceDot online={u.online} />
                </Button>
              ))}
          </div>
        </DialogContent>
      </Dialog>
      {modal === "notifications" && (
        <NotificationSettings onClose={() => setModal(null)} />
      )}
      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => !open && !busy && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar #{deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminarán el canal, sus mensajes, hilos y tareas. Esta acción
              no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                void deleteChannel();
              }}
            >
              {busy ? "Borrando…" : "Borrar canal"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
function NavLink({
  href,
  active,
  onClick,
  children,
}: {
  href: string;
  active: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      asChild
      variant={active ? "secondary" : "ghost"}
      className="w-full justify-start"
    >
      <Link href={href} onClick={onClick}>
        {children}
      </Link>
    </Button>
  );
}
function SectionHeader({
  label,
  onAdd,
}: {
  label: string;
  onAdd?: () => void;
}) {
  return (
    <div className="mb-1 flex h-7 items-center justify-between px-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {onAdd && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Añadir ${label.toLowerCase()}`}
          onClick={onAdd}
        >
          <Plus />
        </Button>
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
  const Icon = type === "public" ? Hash : type === "private" ? Lock : AtSign;
  return <Icon size={size} />;
}
export function PresenceDot({ online }: { online?: boolean }) {
  return (
    <span
      role="img"
      aria-label={online ? "En línea" : "Desconectado"}
      title={online ? "En línea" : "Desconectado"}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        online ? "bg-emerald-500" : "border border-muted-foreground/60",
      )}
    />
  );
}
function ChannelLink({
  channel,
  active,
  online,
  onNavigate,
  onDelete,
}: {
  channel: SummaryChannel;
  active: boolean;
  online?: boolean;
  onNavigate?: () => void;
  onDelete?: () => void;
}) {
  return (
    <li className="group relative">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <Link
            href={`/c/${channel.id}`}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-8 items-center gap-2 rounded-lg px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-primary/10 font-medium text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
              channel.unread > 0 && "font-semibold text-foreground",
              channel.canDelete && "pr-8",
            )}
          >
            <span className="flex w-4 justify-center">
              {channel.type === "dm" ? (
                <PresenceDot online={online} />
              ) : (
                <ChannelIcon type={channel.type} />
              )}
            </span>
            <span className="min-w-0 flex-1 truncate">{channel.name}</span>
            {channel.unread > 0 && (
              <Badge className="h-5 px-1.5">
                {channel.unread > 99 ? "99+" : channel.unread}
              </Badge>
            )}
          </Link>
        </ContextMenuTrigger>
        {channel.canDelete && (
          <ContextMenuContent>
            <ContextMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 /> Borrar canal
            </ContextMenuItem>
          </ContextMenuContent>
        )}
      </ContextMenu>
      {channel.canDelete && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Opciones de ${channel.name}`}
              className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 focus:opacity-100 max-md:opacity-100"
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 /> Borrar canal
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}
function NewChannelModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState(""),
    [isPrivate, setIsPrivate] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ id: string }>("/api/channels", "POST", {
        name,
        isPrivate,
      });
      onCreated(result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo canal</DialogTitle>
          <DialogDescription>
            Un espacio para conversar con personas y agentes.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={create} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="channel-name">Nombre</Label>
            <Input
              id="channel-name"
              autoFocus
              required
              maxLength={50}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="nombre-del-canal"
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="private-channel">Canal privado</Label>
            <Switch
              id="private-channel"
              checked={isPrivate}
              onCheckedChange={setIsPrivate}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Creando…" : "Crear canal"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function NotificationSettings({ onClose }: { onClose: () => void }) {
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >(() =>
    typeof Notification === "undefined"
      ? "unsupported"
      : Notification.permission,
  );
  const [enabled, setEnabled] = useState(notificationsEnabled);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Notificaciones</DialogTitle>
          <DialogDescription>
            Recibe avisos de mensajes nuevos en otros canales.
          </DialogDescription>
        </DialogHeader>
        {permission === "unsupported" ? (
          <p>Este navegador no soporta notificaciones.</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="notifications-enabled">
                Avisarme de nuevos mensajes
              </Label>
              <Switch
                id="notifications-enabled"
                checked={enabled}
                onCheckedChange={(value) => {
                  setEnabled(value);
                  localStorage.setItem(NOTIF_PREF_KEY, value ? "on" : "off");
                }}
              />
            </div>
            {permission === "default" && (
              <Button
                onClick={async () =>
                  setPermission(await Notification.requestPermission())
                }
              >
                Conceder permiso
              </Button>
            )}
            {permission === "denied" && (
              <p className="text-sm text-muted-foreground">
                Activa las notificaciones en los ajustes del navegador y recarga
                la página.
              </p>
            )}
            {permission === "granted" && enabled && (
              <Button
                variant="outline"
                onClick={() =>
                  new Notification("Slak", {
                    body: "Así se verán tus notificaciones",
                  })
                }
              >
                Enviar notificación de prueba
              </Button>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
