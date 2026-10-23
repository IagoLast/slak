"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { ChevronRight, Folder, GitBranch, Server } from "lucide-react";
import { fetcher, SharedMachine, WorkThreadSummary } from "@/lib/client";
import {
  workspaceGroups,
  workStateLabels,
  worktreeHref,
} from "@/lib/workspaces";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export default function WorkspaceSidebar({
  guest,
  onNavigate,
}: {
  guest: boolean;
  onNavigate?: () => void;
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
    <section aria-label="Orca" className="space-y-1">
      <h2 className="px-2 py-1 text-xs font-semibold text-muted-foreground">
        Orca
      </h2>
      {(machineError || workError) && (
        <p role="alert" className="px-2 py-1 text-xs text-destructive">
          No se pudieron actualizar los worktrees.
        </p>
      )}
      {(!machines || !work) && !machineError && !workError && (
        <Skeleton className="mx-2 h-16" />
      )}
      {machines && work && !groups.length && (
        <p className="px-2 py-1 text-xs text-muted-foreground">
          {guest ? (
            "Tus sesiones compartidas aparecerán aquí."
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
              aria-label={machine.online ? "Conectada" : "Sin conexión"}
              title={machine.online ? "Conectada" : "Sin conexión"}
              className={cn(
                "size-2 shrink-0 rounded-full",
                machine.online ? "bg-emerald-500" : "bg-muted-foreground/40",
              )}
            />
          </summary>
          {!machine.online && (
            <p className="ml-6 px-2 pb-2 text-xs text-muted-foreground">
              Sin conexión · último estado recibido
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
              <ul className="space-y-1">
                {repo.worktrees.map((tree) => {
                  const active =
                    (pathname === "/work" &&
                      query.get("machineId") === machine.id &&
                      query.get("worktree") === tree.worktree) ||
                    tree.threads.some(
                      (thread) => pathname === `/work/${thread.id}`,
                    );
                  const state = (["waiting", "error", "running"] as const).find(
                    (value) =>
                      tree.threads.some((thread) => thread.state === value),
                  );
                  return (
                    <li key={tree.worktree}>
                      <Link
                        href={worktreeHref(machine.id, tree.worktree)}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        title={tree.branch || tree.name}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2 py-2 hover:bg-sidebar-accent",
                          active && "bg-sidebar-accent",
                        )}
                      >
                        <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium">
                          {tree.name}
                        </span>
                        {state && machine.online && (
                          <span
                            className={cn(
                              "text-[10px]",
                              state === "error"
                                ? "text-destructive"
                                : "text-muted-foreground",
                            )}
                          >
                            {workStateLabels[state]}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </details>
          ))}
        </details>
      ))}
    </section>
  );
}
