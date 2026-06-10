"use client";

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
      <h1 className="mb-1 text-xl font-bold text-gray-900">Invitar personas</h1>
      <p className="mb-6 text-sm text-gray-500">
        Crea un enlace de invitación y compártelo. Los invitados externos solo
        verán los canales que elijas aquí.
      </p>

      <form
        onSubmit={createInvite}
        className="mb-8 space-y-4 rounded-xl border border-gray-200 p-5"
      >
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Email <span className="text-gray-400">(opcional, restringe el enlace)</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="persona@empresa.com"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base outline-none sm:text-sm focus:border-violet-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Tipo</label>
          <div className="flex gap-4 text-sm text-gray-700">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={role === "member"}
                onChange={() => setRole("member")}
              />
              Miembro de la empresa
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={role === "guest"}
                onChange={() => setRole("guest")}
              />
              Invitado externo
            </label>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Canales iniciales{" "}
            {role === "guest" && <span className="text-red-500">(obligatorio)</span>}
          </label>
          <div className="flex flex-wrap gap-2">
            {channels.map((c) => (
              <button
                type="button"
                key={c.id}
                onClick={() => toggleChannel(c.id)}
                className={`rounded-full border px-3 py-1 text-sm ${
                  channelIds.includes(c.id)
                    ? "border-violet-600 bg-violet-50 text-violet-800"
                    : "border-gray-300 text-gray-600 hover:bg-gray-50"
                }`}
              >
                #{c.name}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-800"
        >
          Crear enlace de invitación
        </button>

        {createdUrl && (
          <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2">
            <code className="min-w-0 flex-1 truncate text-xs text-green-900">
              {createdUrl}
            </code>
            <button
              type="button"
              onClick={() => copy(createdUrl)}
              className="shrink-0 rounded bg-green-600 px-2 py-1 text-xs font-semibold text-white"
            >
              {copied === createdUrl ? "¡Copiado!" : "Copiar"}
            </button>
          </div>
        )}
      </form>

      <h2 className="mb-3 text-sm font-semibold text-gray-700 uppercase">
        Invitaciones pendientes
      </h2>
      {!invitesData?.invites.length ? (
        <p className="text-sm text-gray-400">No hay invitaciones pendientes.</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
          {invitesData.invites.map((invite) => {
            const url = `${window.location.origin}/register?token=${invite.token}`;
            return (
              <li key={invite.token} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800">
                    {invite.email ?? "Cualquier email"}{" "}
                    <span className="text-xs text-gray-400">
                      · {invite.role === "guest" ? "invitado externo" : "miembro"}
                    </span>
                  </p>
                  <p className="truncate text-xs text-gray-400">{url}</p>
                </div>
                <button
                  onClick={() => copy(url)}
                  className="shrink-0 rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                >
                  {copied === url ? "¡Copiado!" : "Copiar"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
