"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  ChevronRight,
  Bot,
  Folder,
  GitBranch,
  MessageSquare,
  Server,
} from "lucide-react";
import {
  fetcher,
  AgentContact,
  SharedMachine,
  WorkThreadSummary,
} from "@/lib/client";
import { Button } from "@/components/ui/button";
import { workspaceGroups, workspaceStatusLabel } from "@/lib/workspaces";
import { workStateLabels } from "@/components/WorkList";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export default function WorkspaceSidebar({
  guest,
  onNavigate,
  agents,
  onOpenAgent,
}: {
  guest: boolean;
  onNavigate?: () => void;
  agents: AgentContact[];
  onOpenAgent: (id: string) => void;
}) {
  const pathname = usePathname();
  const query = useSearchParams();
  const { data: machines, error: machineError } = useSWR<{
    machines: SharedMachine[];
  }>("/api/machines", fetcher, { refreshInterval: 5000 });
  const { data: work, error: workError } = useSWR<{
    threads: WorkThreadSummary[];
  }>("/api/work", fetcher, { refreshInterval: 3000 });
  const groups = workspaceGroups(
    machines?.machines ?? [],
    work?.threads ?? [],
    !guest,
  );
  return (
    <section aria-label="Worktrees" className="space-y-1">
      <h2 className="px-2 py-1 text-xs font-semibold text-muted-foreground">
        Worktrees
      </h2>
      {(machineError || workError) && (
        <p role="alert" className="px-2 py-1 text-xs text-destructive">
          No se pudo actualizar el estado de los worktrees.
        </p>
      )}
      {(!machines || !work) && !machineError && !workError && (
        <Skeleton className="mx-2 h-16" />
      )}
      {machines && work && !groups.length && (
        <p className="px-2 py-1 text-xs text-muted-foreground">
          {guest ? (
            "Los worktrees de tus conversaciones aparecerán aquí."
          ) : (
            <Link href="/machines" onClick={onNavigate} className="underline">
              Conecta Orca para ver tus worktrees.
            </Link>
          )}
        </p>
      )}
      {groups.map(({ machine, repositories }) => (
        <details key={machine.id} open className="group/machine">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-2 text-sm hover:bg-sidebar-accent [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-3 shrink-0 transition-transform group-open/machine:rotate-90" />
            <Server className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate" title={machine.name}>
              {machine.name}
            </span>
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                machine.online ? "bg-emerald-500" : "bg-muted-foreground/40",
              )}
            />
            <span className="text-[10px] text-muted-foreground">
              {machine.online ? "Conectada" : "Sin conexión"}
            </span>
          </summary>
          {!machine.online && (
            <p className="ml-6 px-2 pb-2 text-xs text-muted-foreground">
              {machine.enabled
                ? "El puente de Orca no está conectado. Se muestra el último estado recibido."
                : "La conexión de esta máquina está revocada."}{" "}
              {!guest && (
                <Link
                  href="/machines"
                  onClick={onNavigate}
                  className="underline"
                >
                  Revisar conexión
                </Link>
              )}
            </p>
          )}
          {!repositories.length && (
            <p className="ml-6 px-2 py-1 text-xs text-muted-foreground">
              Aún no hay worktrees compartidos.
            </p>
          )}
          {repositories.map((repo) => (
            <details
              key={repo.id}
              open
              className="group/repo ml-3 border-l pl-2"
            >
              <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium hover:bg-sidebar-accent [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-3 shrink-0 transition-transform group-open/repo:rotate-90" />
                <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{repo.name}</span>
              </summary>
              {agents
                .filter(
                  (agent) =>
                    agent.mode === "orchestrator" &&
                    agent.machineId === machine.id &&
                    agent.repository === repo.id,
                )
                .map((agent) => (
                  <Button
                    key={agent.id}
                    variant="ghost"
                    className="h-auto w-full justify-start gap-2 px-2 py-2"
                    onClick={() => onOpenAgent(agent.id)}
                  >
                    <Bot className="size-4 shrink-0" />
                    <span className="min-w-0 text-left">
                      <span className="block truncate text-xs">
                        Hablar con el agente padre
                      </span>
                      <span className="block truncate text-[10px] font-normal text-muted-foreground">
                        @{agent.handle}
                      </span>
                    </span>
                  </Button>
                ))}
              <ul className="space-y-1">
                {repo.worktrees.map((tree) => {
                  const active =
                    tree.threads.some(
                      (thread) => pathname === `/work/${thread.id}`,
                    ) ||
                    (pathname === "/work" &&
                      query.get("machineId") === machine.id &&
                      query.get("worktree") === tree.worktree);
                  const state = [
                    "waiting",
                    "error",
                    "running",
                    "idle",
                    "stopped",
                  ].find((value) =>
                    tree.threads.some((thread) => thread.state === value),
                  ) as WorkThreadSummary["state"] | undefined;
                  const href = `/work?${new URLSearchParams({ machineId: machine.id, worktree: tree.worktree })}`;
                  return (
                    <li key={tree.worktree}>
                      <Link
                        href={href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        title={`${tree.name}${tree.branch ? ` · ${tree.branch}` : ""}`}
                        className={cn(
                          "flex items-start gap-2 rounded-md px-2 py-2 hover:bg-sidebar-accent",
                          active && "bg-sidebar-accent",
                        )}
                      >
                        <GitBranch className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium">
                            {tree.name}
                          </span>
                          <span
                            className={cn(
                              "block text-[11px]",
                              state === "waiting" && machine.online
                                ? "text-amber-600 dark:text-amber-400"
                                : state === "error" && machine.online
                                  ? "text-destructive"
                                  : "text-muted-foreground",
                            )}
                          >
                            {!machine.online
                              ? "Sin conexión"
                              : state
                                ? workStateLabels[state]
                                : workspaceStatusLabel(tree.status)}
                          </span>
                        </span>
                      </Link>
                      {tree.threads.length > 0 && (
                        <ul className="ml-4 border-l pl-1">
                          {tree.threads.map((thread) => (
                            <ThreadLink
                              key={thread.id}
                              thread={thread}
                              active={pathname === `/work/${thread.id}`}
                              onNavigate={onNavigate}
                            />
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
                {repo.unassigned.length > 0 && (
                  <li>
                    <p className="px-2 pt-2 pb-1 text-[10px] text-muted-foreground">
                      Sin worktree aislado
                    </p>
                    <ul>
                      {repo.unassigned.map((thread) => (
                        <ThreadLink
                          key={thread.id}
                          thread={thread}
                          active={pathname === `/work/${thread.id}`}
                          onNavigate={onNavigate}
                        />
                      ))}
                    </ul>
                  </li>
                )}
              </ul>
            </details>
          ))}
        </details>
      ))}
    </section>
  );
}

function ThreadLink({
  thread,
  active,
  onNavigate,
}: {
  thread: WorkThreadSummary;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <li>
      <Link
        href={`/work/${thread.id}`}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-sidebar-accent",
          active && "bg-sidebar-accent",
        )}
      >
        <MessageSquare className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0">
          <span className="block truncate text-xs" title={thread.title}>
            {thread.title}
          </span>
          <span className="block text-[10px] text-muted-foreground">
            {thread.online ? workStateLabels[thread.state] : "Sin conexión"}
          </span>
        </span>
      </Link>
    </li>
  );
}
