"use client";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

import { useState } from "react";
import useSWR from "swr";
import { fetcher, Summary } from "@/lib/client";
import { Invite } from "@/db/schema";

export default function InviteManager() {
  const { data: summary } = useSWR<Summary>("/api/me/summary", fetcher);
  const { data: invitesData, mutate } = useSWR<{ invites: Invite[] }>(
    "/api/invites",
    fetcher,
  );

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "guest">("member");
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const channels = summary?.channels.filter((c) => c.type !== "dm") ?? [];

  function toggleChannel(id: string) {
    setChannelIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  }

  async function createInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreatedUrl(null);
    const res = await fetch("/api/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email || null, role, channelIds }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error ?? "No se pudo crear la invitación.");
      return;
    }
    setCreatedUrl(data.url);
    setEmail("");
    mutate();
  }

  async function copy(url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(url);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="mx-auto w-full max-w-2xl overflow-y-auto px-6 py-8">
      <h1 className="mb-1 text-xl font-bold text-foreground">
        Invitar personas
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Crea un enlace de invitación y compártelo. Los invitados externos solo
        verán los canales que elijas aquí.
      </p>

      <form
        onSubmit={createInvite}
        className="mb-8 space-y-4 rounded-xl border border-border p-5"
      >
        <div>
          <Label className="mb-1 block text-sm font-medium text-foreground">
            Email{" "}
            <span className="text-muted-foreground">
              (opcional, restringe el enlace)
            </span>
          </Label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="persona@empresa.com"
            className="w-full rounded-lg border border-input px-3 py-2 text-base outline-none sm:text-sm focus:border-ring"
          />
        </div>

        <div>
          <Label className="mb-1 block text-sm font-medium text-foreground">
            Tipo
          </Label>
          <Select
            value={role}
            onValueChange={(value) => setRole(value as "member" | "guest")}
          >
            <SelectTrigger aria-label="Tipo de invitación">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="member">Miembro de la empresa</SelectItem>
              <SelectItem value="guest">Invitado externo</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="mb-1 block text-sm font-medium text-foreground">
            Canales iniciales{" "}
            {role === "guest" && (
              <span className="text-red-500">(obligatorio)</span>
            )}
          </Label>
          <div className="flex flex-wrap gap-2">
            {channels.map((c) => (
              <Button
                variant="outline"
                type="button"
                key={c.id}
                onClick={() => toggleChannel(c.id)}
                className={`rounded-full border px-3 py-1 text-sm ${
                  channelIds.includes(c.id)
                    ? "border-violet-600 bg-violet-50 text-violet-800"
                    : "border-input text-muted-foreground hover:bg-muted/50"
                }`}
              >
                #{c.name}
              </Button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button
          type="submit"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
        >
          Crear enlace de invitación
        </Button>

        {createdUrl && (
          <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2">
            <code className="min-w-0 flex-1 truncate text-xs text-green-900">
              {createdUrl}
            </code>
            <Button
              variant="outline"
              type="button"
              onClick={() => copy(createdUrl)}
              className="shrink-0 rounded bg-green-600 px-2 py-1 text-xs font-semibold text-white"
            >
              {copied === createdUrl ? "¡Copiado!" : "Copiar"}
            </Button>
          </div>
        )}
      </form>

      <h2 className="mb-3 text-sm font-semibold text-foreground uppercase">
        Invitaciones pendientes
      </h2>
      {!invitesData?.invites.length ? (
        <p className="text-sm text-muted-foreground">
          No hay invitaciones pendientes.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-border">
          {invitesData.invites.map((invite) => {
            const url = `${window.location.origin}/register?token=${invite.token}`;
            return (
              <li
                key={invite.token}
                className="flex items-center gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {invite.email ?? "Cualquier email"}{" "}
                    <span className="text-xs text-muted-foreground">
                      ·{" "}
                      {invite.role === "guest" ? "invitado externo" : "miembro"}
                    </span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {url}
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => copy(url)}
                  className="shrink-0 rounded border border-input px-2 py-1 text-xs text-muted-foreground hover:bg-muted/50"
                >
                  {copied === url ? "¡Copiado!" : "Copiar"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
