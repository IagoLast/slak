import TaskList from "@/components/TaskList";
export default function TasksPage() {
  return (
    <div className="flex-1 overflow-auto">
      <header className="border-b px-6 py-5">
        <h1 className="text-xl font-semibold tracking-tight">
          Tareas del equipo
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Del encargo al resultado, con el contexto de cada conversación.
        </p>
      </header>
      <div className="mx-auto max-w-4xl p-6">
        <TaskList />
      </div>
    </div>
  );
}
