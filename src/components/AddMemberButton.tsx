"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher, Summary } from "@/lib/client";

/** Añadir personas a un canal (necesario para dar acceso a invitados externos). */
export default function AddMemberButton({ channelId }: { channelId: string }) {
  const [open, setOpen] = useState(false);
  const { data: summary } = useSWR<Summary>(open ? "/api/me/summary" : null, fetcher);
  const { data: membersData, mutate } = useSWR<{
    members: { id: string; name: string; role: string }[];
  }>(open ? `/api/channels/${channelId}/members` : null, fetcher);

  const memberIds = new Set(membersData?.members.map((m) => m.id) ?? []);
  const candidates = summary?.users.filter((u) => !memberIds.has(u.id)) ?? [];

  async function addMember(userId: string) {
    await fetch(`/api/channels/${channelId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    mutate();
  }

  return (
    <div className="relative ml-auto">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
      >
        👥 Miembros
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-64 rounded-xl border border-gray-200 bg-white p-3 shadow-lg">
            <p className="mb-2 text-xs font-semibold text-gray-500 uppercase">
              En este canal
            </p>
            <ul className="mb-3 max-h-40 space-y-1 overflow-y-auto">
              {membersData?.members.map((m) => (
                <li key={m.id} className="flex items-center gap-2 text-sm text-gray-800">
                  {m.name}
                  {m.role === "guest" && (
                    <span className="text-xs text-gray-400">externo</span>
                  )}
                </li>
              ))}
            </ul>
            {candidates.length > 0 && (
              <>
                <p className="mb-2 text-xs font-semibold text-gray-500 uppercase">
                  Añadir
                </p>
                <ul className="max-h-40 space-y-1 overflow-y-auto">
                  {candidates.map((u) => (
                    <li key={u.id}>
                      <button
                        onClick={() => addMember(u.id)}
                        className="flex w-full items-center justify-between rounded px-1 py-1 text-left text-sm text-gray-800 hover:bg-gray-50"
                      >
                        <span>
                          {u.name}{" "}
                          {u.role === "guest" && (
                            <span className="text-xs text-gray-400">externo</span>
                          )}
                        </span>
                        <span className="text-violet-700">+</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
