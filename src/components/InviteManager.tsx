"use client";

import { useState } from "react";
import { Copy, Link2, Lock, Trash2, UserPlus } from "lucide-react";
import useSWR from "swr";
import type { Invite } from "@/db/schema";
import { api, fetcher, type Summary } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
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

export default function InviteManager() {
  const { data: summary, error: summaryError } = useSWR<Summary>(
    "/api/me/summary",
    fetcher,
  );
  const {
    data: invitesData,
    error: invitesError,
    mutate,
  } = useSWR<{ invites: Invite[] }>("/api/invites", fetcher);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "guest">("member");
  const [channelIds, setChannelIds] = useState<string[] | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<Invite | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);

  const channels = summary?.channels.filter((c) => c.type !== "dm") ?? [];
  const general = channels.find(
    (c) => c.name === "general" && c.type === "public",
  );
  const selectedIds = channelIds ?? (general ? [general.id] : []);

  function toggleChannel(id: string) {
    setChannelIds(
      selectedIds.includes(id)
        ? selectedIds.filter((c) => c !== id)
        : [...selectedIds, id],
    );
  }

  async function createInvite(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setError(null);
    setCreatedUrl(null);
    try {
      const data = await api<{ url: string }>("/api/invites", "POST", {
        email: email.trim() || null,
        role,
        channelIds: selectedIds,
      });
      setCreatedUrl(data.url);
      setEmail("");
      void mutate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
    } catch {
      setError(
        "No se pudo copiar automáticamente. Selecciona el enlace y cópialo manualmente.",
      );
    }
  }

  async function revoke() {
    if (!revoking || revokeBusy) return;
    setRevokeBusy(true);
    setError(null);
    try {
      await api(`/api/invites/${encodeURIComponent(revoking.token)}`, "DELETE");
      if (
        createdUrl &&
        new URL(createdUrl).searchParams.get("token") === revoking.token
      )
        setCreatedUrl(null);
      setRevoking(null);
      void mutate();
    } catch (e) {
      setError((e as Error).message);
      setRevoking(null);
    } finally {
      setRevokeBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
        <UserPlus className="size-4" /> Workspace · Slak
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">
        Invitar personas
      </h1>
      <p className="mt-2 mb-6 text-sm text-muted-foreground">
        Crea un enlace, cópialo y compártelo con quien quieras añadir al
        workspace. Cada enlace sirve para crear una cuenta. No se envía ningún
        email automáticamente.
      </p>

      {error && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {error}
        </p>
      )}
      <form
        onSubmit={createInvite}
        className="mb-8 space-y-5 rounded-xl border bg-card p-4 sm:p-5"
      >
        <div className="space-y-2">
          <Label htmlFor="invite-email">
            Email de la persona{" "}
            <span className="font-normal text-muted-foreground">
              (opcional)
            </span>
          </Label>
          <Input
            id="invite-email"
            type="email"
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="persona@empresa.com"
            aria-describedby="invite-email-hint"
          />
          <p id="invite-email-hint" className="text-xs text-muted-foreground">
            Si lo indicas, solo podrá registrarse con ese email.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="invite-role">Acceso al workspace</Label>
          <Select
            value={role}
            onValueChange={(value) => setRole(value as "member" | "guest")}
          >
            <SelectTrigger id="invite-role" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="member">Miembro del equipo</SelectItem>
              <SelectItem value="guest">Invitado externo</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {role === "member"
              ? "Puede participar en los canales públicos y en los privados a los que le des acceso."
              : "Solo tendrá acceso a los canales que selecciones y a sus mensajes directos."}
          </p>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            Canales iniciales {role === "guest" && "(al menos uno)"}
          </legend>
          {summaryError ? (
            <p role="alert" className="text-sm text-destructive">
              No se pudieron cargar los canales. Recarga la página.
            </p>
          ) : !summary ? (
            <Skeleton className="h-8 w-40" />
          ) : channels.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Todavía no hay canales disponibles.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {channels.map((c) => (
                <Button
                  key={c.id}
                  type="button"
                  size="sm"
                  variant={selectedIds.includes(c.id) ? "secondary" : "outline"}
                  aria-pressed={selectedIds.includes(c.id)}
                  onClick={() => toggleChannel(c.id)}
                >
                  {c.type === "private" && <Lock className="size-3" />} #
                  {c.name}
                </Button>
              ))}
            </div>
          )}
        </fieldset>
        <Button
          type="submit"
          className="w-full sm:w-auto"
          disabled={
            creating ||
            !summary ||
            !!summaryError ||
            (role === "guest" && !selectedIds.length)
          }
        >
          <Link2 />{" "}
          {creating ? "Creando enlace…" : "Crear enlace de invitación"}
        </Button>
        {createdUrl && (
          <div
            className="space-y-2 rounded-lg border bg-muted/40 p-3"
            role="status"
          >
            <Label htmlFor="created-invite-url">
              Enlace listo para compartir
            </Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="created-invite-url"
                readOnly
                value={createdUrl}
                onFocus={(e) => e.target.select()}
                className="min-w-0 text-xs"
              />
              <Button
                variant="outline"
                type="button"
                onClick={() => copy(createdUrl)}
              >
                <Copy />
                {copied === createdUrl ? "Copiado" : "Copiar enlace"}
              </Button>
            </div>
          </div>
        )}
      </form>

      <h2 className="mb-3 text-base font-semibold">Invitaciones pendientes</h2>
      {invitesError ? (
        <p role="alert" className="text-sm text-destructive">
          No se pudieron cargar las invitaciones.
        </p>
      ) : !invitesData ? (
        <Skeleton className="h-20" />
      ) : !invitesData.invites.length ? (
        <p className="text-sm text-muted-foreground">
          No hay invitaciones pendientes.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {invitesData.invites.map((invite) => {
            const url = `${window.location.origin}/register?token=${invite.token}`;
            return (
              <li key={invite.token} className="space-y-3 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 break-all text-sm font-medium">
                    {invite.email ?? "Sin restricción de email"}
                  </p>
                  <Badge variant="secondary">
                    {invite.role === "guest" ? "Invitado externo" : "Miembro"}
                  </Badge>
                </div>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={url}
                    aria-label={`Enlace para ${invite.email ?? "cualquier email"}`}
                    onFocus={(e) => e.target.select()}
                    className="min-w-0 text-xs"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={`Copiar invitación para ${invite.email ?? "cualquier email"}`}
                    onClick={() => copy(url)}
                  >
                    <Copy />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Revocar invitación para ${invite.email ?? "cualquier email"}`}
                    onClick={() => setRevoking(invite)}
                  >
                    <Trash2 />
                  </Button>
                </div>
                {copied === url && (
                  <p role="status" className="text-xs text-muted-foreground">
                    Enlace copiado.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <AlertDialog
        open={!!revoking}
        onOpenChange={(open) => !open && !revokeBusy && setRevoking(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Revocar invitación?</AlertDialogTitle>
            <AlertDialogDescription>
              El enlace{revoking?.email ? ` para ${revoking.email}` : ""} dejará
              de permitir crear una cuenta. Puedes crear otro después.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revokeBusy}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={revokeBusy}
              onClick={(e) => {
                e.preventDefault();
                void revoke();
              }}
            >
              {revokeBusy ? "Revocando…" : "Revocar invitación"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
