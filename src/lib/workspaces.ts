import type { SharedMachine, WorkThreadSummary } from "@/lib/client";

export type SharedWorktree = {
  worktree: string;
  name: string;
  repository: string;
  branch: string;
  status: string;
};

export function worktreeName(worktree: string) {
  return (
    worktree
      .replace(/^path:/, "")
      .split(/[\\/]/)
      .filter(Boolean)
      .at(-1) || worktree
  );
}

export function workspaceStatusLabel(status: string) {
  const labels: Record<string, string> = {
    todo: "Pendiente",
    "in-progress": "En curso",
    "in-review": "En revisión",
    done: "Completado",
    cancelled: "Cancelado",
  };
  return labels[status] || status || "Sin estado";
}

export function workspaceGroups(
  machines: SharedMachine[],
  threads: WorkThreadSummary[],
  includeCatalog = true,
) {
  return machines
    .map((machine) => {
      const machineThreads = threads.filter(
        (thread) => thread.machineId === machine.id,
      );
      const worktrees = new Map<string, SharedWorktree>();
      if (includeCatalog) {
        for (const tree of machine.worktrees ?? [])
          worktrees.set(tree.worktree, tree);
        // Older bridges only announce terminal sessions.
        for (const session of machine.sessions) {
          if (!worktrees.has(session.worktree))
            worktrees.set(session.worktree, {
              ...session,
              branch: "",
              status: "",
            });
        }
      }
      for (const thread of machineThreads) {
        for (const path of [
          thread.worktree,
          ...(thread.workers ?? []).map((worker) => worker.worktree),
        ]) {
          if (path && !worktrees.has(path))
            worktrees.set(path, {
              worktree: path,
              name: worktreeName(path),
              repository: thread.repository,
              branch: "",
              status: "",
            });
        }
      }
      const repositoryIds = new Set([
        ...(includeCatalog ? machine.repositories.map((repo) => repo.id) : []),
        ...[...worktrees.values()].map((tree) => tree.repository),
        ...machineThreads.map((thread) => thread.repository),
      ]);
      return {
        machine,
        repositories: [...repositoryIds].map((id) => ({
          id,
          name:
            machine.repositories.find((repo) => repo.id === id)?.name ||
            "Proyecto",
          worktrees: [...worktrees.values()]
            .filter((tree) => tree.repository === id)
            .map((tree) => ({
              ...tree,
              threads: machineThreads
                .filter(
                  (thread) =>
                    thread.worktree === tree.worktree ||
                    thread.workers?.some(
                      (worker) => worker.worktree === tree.worktree,
                    ),
                )
                .map((thread) => ({
                  ...thread,
                  state:
                    thread.workers?.find(
                      (worker) => worker.worktree === tree.worktree,
                    )?.state ?? thread.state,
                })),
            })),
          unassigned: machineThreads.filter(
            (thread) =>
              thread.repository === id &&
              !thread.worktree &&
              !thread.workers?.some((worker) => worker.worktree),
          ),
        })),
      };
    })
    .filter((group) => includeCatalog || group.repositories.length);
}
