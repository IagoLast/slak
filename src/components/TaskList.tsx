"use client";
import Link from "next/link";
import {
  CheckCircle2,
  Clock3,
  Loader2,
  CircleAlert,
  ArrowUpRight,
  ListTodo,
} from "lucide-react";
import useSWR from "swr";
import { AgentTask, fetcher } from "@/lib/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
const labels = {
  queued: "En cola",
  running: "En curso",
  completed: "Completada",
  failed: "Fallida",
};
const icons = {
  queued: Clock3,
  running: Loader2,
  completed: CheckCircle2,
  failed: CircleAlert,
};
export default function TaskList({
  channelId,
  compact = false,
}: {
  channelId?: string;
  compact?: boolean;
}) {
  const { data, error } = useSWR<{ tasks: AgentTask[] }>(
    channelId ? `/api/tasks?channelId=${channelId}` : "/api/tasks",
    fetcher,
    { refreshInterval: 3000 },
  );
  if (error)
    return (
      <p role="alert" className="p-4 text-sm text-destructive">
        No se pudieron cargar las tareas.
      </p>
    );
  if (!data) return <Skeleton className="m-4 h-20" />;
  if (!data.tasks.length)
    return compact ? null : (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <ListTodo className="size-8 text-muted-foreground" />
          <p className="font-medium">El trabajo del equipo, en un lugar</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Encarga una tarea desde un canal o habla con un agente. Aquí podrás
            seguir sus avances.
          </p>
        </CardContent>
      </Card>
    );
  if (compact) {
    const active = data.tasks.filter((t) =>
      ["queued", "running"].includes(t.status),
    );
    return active.length ? (
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-5 py-2 text-xs">
        <ListTodo className="size-3.5" />
        {active.length} pendientes
        {active.slice(0, 3).map((t) => (
          <Badge key={t.id} variant="outline">
            @{t.agentHandle} · {labels[t.status]}
          </Badge>
        ))}
        <Link href="/tasks" className="ml-auto text-primary">
          Ver tareas
        </Link>
      </div>
    ) : null;
  }
  return (
    <div className="space-y-3">
      {data.tasks.map((task) => {
        const Icon = icons[task.status];
        return (
          <Card key={task.id}>
            <CardContent className="space-y-3 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    task.status === "failed" ? "destructive" : "secondary"
                  }
                >
                  <Icon
                    className={task.status === "running" ? "animate-spin" : ""}
                  />
                  {labels[task.status]}
                </Badge>
                <span className="text-sm font-medium">@{task.agentHandle}</span>
                <span className="text-xs text-muted-foreground">
                  {task.kind === "message" ? "Conversación" : "Tarea"}
                </span>
                <Link
                  href={`/c/${task.channelId}`}
                  className="ml-auto flex items-center gap-1 text-xs text-primary"
                >
                  Conversación
                  <ArrowUpRight className="size-3" />
                </Link>
              </div>
              <p className="whitespace-pre-wrap text-sm">{task.prompt}</p>
              {task.result && (
                <div className="rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap">
                  {task.result}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {new Date(task.createdAt).toLocaleString("es")}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
