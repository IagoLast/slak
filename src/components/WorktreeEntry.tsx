"use client";

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { GitBranch, Loader2, MessageSquare, Server } from "lucide-react";
import { api, WorktreeChats } from "@/lib/client";
import { worktreeName, workStateLabels } from "@/lib/workspaces";
import WorkConversation from "@/components/WorkConversation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function WorktreeEntry({
  machineId,
  worktree,
  selectedSessionId,
}: {
  machineId: string;
  worktree: string;
  selectedSessionId?: string;
}) {
  const [selectedId, setSelectedId] = useState(selectedSessionId);
  const [opening, setOpening] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const key = `/api/work/open?${new URLSearchParams({ machineId, worktree })}`;
  const { data, error, mutate } = useSWR<WorktreeChats>(
    key,
    (url: string) => api(url, "GET"),
    { refreshInterval: 3000 },
  );
  const selected =
    data?.sessions.find(
      (session) =>
        session.id === selectedId || session.sessionId === selectedId,
    ) || data?.sessions[0];
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b px-5 py-3">
        <GitBranch className="size-5 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold">
            {data?.name || worktreeName(worktree)}
          </h1>
          {data && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Server className="size-3" />
              {data.machine}
              {!data.online && " · Sin conexión"}
            </p>
          )}
        </div>
      </header>
      {!!data?.sessions.length && (
        <nav
          aria-label="Sesiones del worktree"
          className="flex shrink-0 gap-1 overflow-x-auto border-b px-3 pt-2"
        >
          {data.sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              aria-current={session.id === selected?.id ? "page" : undefined}
              onClick={() => setSelectedId(session.id)}
              title={`${session.name} · ${workStateLabels[session.state]}`}
              className={cn(
                "flex shrink-0 items-center gap-2 border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:bg-muted",
                session.id === selected?.id &&
                  "border-primary bg-muted/50 text-foreground",
              )}
            >
              {session.state === "running" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <MessageSquare className="size-3.5" />
              )}
              {session.name}
              {session.state === "waiting" && (
                <span
                  className="size-2 rounded-full bg-amber-500"
                  aria-label="Necesita respuesta"
                />
              )}
            </button>
          ))}
        </nav>
      )}
      {error && (
        <div className="p-5">
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
          <Button variant="outline" className="mt-3" onClick={() => mutate()}>
            Reintentar
          </Button>
        </div>
      )}
      {selected ? (
        <SessionEntry
          key={selected.id}
          machineId={machineId}
          worktree={worktree}
          selected={selected}
          draft={drafts[selected.id] || ""}
          onDraftChange={(draft) =>
            setDrafts((all) => ({ ...all, [selected.id]: draft }))
          }
        />
      ) : opening ? (
        <SessionEntry
          machineId={machineId}
          worktree={worktree}
          onOpen={() => void mutate()}
        />
      ) : data ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <MessageSquare className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Este worktree no tiene sesiones disponibles.
          </p>
          {data.canOpen && (
            <Button disabled={!data.online} onClick={() => setOpening(true)}>
              Abrir conversación
            </Button>
          )}
          {!data.online && (
            <p className="text-xs text-muted-foreground">
              Conecta la máquina para abrir una sesión.
            </p>
          )}
        </div>
      ) : (
        !error && (
          <p
            role="status"
            className="flex items-center gap-2 p-6 text-sm text-muted-foreground"
          >
            <Loader2 className="size-4 animate-spin" />
            Cargando sesiones…
          </p>
        )
      )}
    </div>
  );
}

function SessionEntry({
  machineId,
  worktree,
  selected,
  onOpen,
  draft,
  onDraftChange,
}: {
  machineId: string;
  worktree: string;
  selected?: WorktreeChats["sessions"][number];
  onOpen?: () => void;
  draft?: string;
  onDraftChange?: (draft: string) => void;
}) {
  const existing =
    selected?.threadId && selected.sessionId
      ? { threadId: selected.threadId, sessionId: selected.sessionId }
      : null;
  const { data, error, mutate } = useSWR(
    existing
      ? null
      : ["open-worktree", machineId, worktree, selected?.runtimeId],
    () =>
      api<{ threadId: string; sessionId: string }>("/api/work/open", "POST", {
        machineId,
        worktree,
        ...(selected?.runtimeId && { runtimeId: selected.runtimeId }),
      }),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      shouldRetryOnError: false,
      onSuccess: onOpen,
    },
  );
  const conversation = existing || data;
  if (conversation)
    return (
      <WorkConversation
        key={`${conversation.threadId}:${conversation.sessionId}`}
        {...conversation}
        draft={draft}
        onDraftChange={onDraftChange}
        embedded
      />
    );
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      {error ? (
        <>
          <p role="alert" className="max-w-md text-sm text-destructive">
            {error.message}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => mutate()}>
              Reintentar
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/machines">Ver máquinas</Link>
            </Button>
          </div>
        </>
      ) : (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 className="size-4 animate-spin" />
          Abriendo conversación…
        </p>
      )}
    </div>
  );
}
