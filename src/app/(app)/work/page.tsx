import WorktreeEntry from "@/components/WorktreeEntry";
import { redirect } from "next/navigation";

export default async function WorkPage({
  searchParams,
}: {
  searchParams: Promise<{
    machineId?: string;
    worktree?: string;
    session?: string;
  }>;
}) {
  const { machineId, worktree, session } = await searchParams;
  if (!machineId || !worktree) redirect("/machines");
  return (
    <WorktreeEntry
      key={`${machineId}:${worktree}`}
      machineId={machineId}
      worktree={worktree}
      selectedSessionId={session}
    />
  );
}
