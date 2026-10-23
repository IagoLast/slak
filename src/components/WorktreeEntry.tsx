"use client";

import useSWR from "swr";
import Link from "next/link";
import { GitBranch, Loader2 } from "lucide-react";
import { api } from "@/lib/client";
import { worktreeName } from "@/lib/workspaces";
import WorkConversation from "@/components/WorkConversation";
import { Button } from "@/components/ui/button";

export default function WorktreeEntry({
  machineId,
  worktree,
}: {
  machineId: string;
  worktree: string;
}) {
  const { data, error, mutate } = useSWR(
    ["open-worktree", machineId, worktree],
    () =>
      api<{ threadId: string; sessionId: string }>("/api/work/open", "POST", {
        machineId,
        worktree,
      }),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
    },
  );
  if (data)
    return (
      <WorkConversation
        key={`${data.threadId}:${data.sessionId}`}
        threadId={data.threadId}
        sessionId={data.sessionId}
      />
    );
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <GitBranch className="size-8 text-muted-foreground" />
      <h1 className="text-lg font-semibold">{worktreeName(worktree)}</h1>
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
