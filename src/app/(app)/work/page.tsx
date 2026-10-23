import WorkList from "@/components/WorkList";
export default function WorkPage() {
  return (
    <div className="flex-1 overflow-auto">
      <header className="border-b px-6 py-5">
        <h1 className="text-xl font-semibold tracking-tight">
          Hilos de trabajo
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Conversaciones con los bots del equipo, sus subagentes y sus
          workspaces.
        </p>
      </header>
      <div className="mx-auto max-w-5xl p-6">
        <WorkList />
      </div>
    </div>
  );
}
