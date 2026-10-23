import WorktreeEntry from "@/components/WorktreeEntry";
import WorkList from "@/components/WorkList";
import { worktreeName } from "@/lib/workspaces";

export default async function WorkPage({
  searchParams,
}: {
  searchParams: Promise<{ machineId?: string; worktree?: string }>;
}) {
  const { machineId, worktree } = await searchParams;
  if (machineId && worktree)
    return (
      <WorktreeEntry
        key={`${machineId}:${worktree}`}
        machineId={machineId}
        worktree={worktree}
      />
    );
  return (
    <div className="flex-1 overflow-auto">
      <header className="border-b px-6 py-5">
        <h1 className="text-xl font-semibold tracking-tight">
          {worktree ? worktreeName(worktree) : "Hilos de trabajo"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {worktree
            ? "Conversaciones de este worktree y estado de sus agentes."
            : "Conversaciones con los bots del equipo, sus subagentes y sus worktrees."}
        </p>
      </header>
      <div className="mx-auto max-w-5xl p-6">
        <WorkList machineId={machineId} worktree={worktree} />
      </div>
    </div>
  );
}
