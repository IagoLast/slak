"use client";
import Link from "next/link";
import useSWR from "swr";
import { ArrowUpRight, Bot, GitBranch, MessageSquare } from "lucide-react";
import { fetcher, WorkThreadSummary } from "@/lib/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { worktreeName } from "@/lib/workspaces";

export const workStateLabels = {
  idle: "Disponible",
  running: "Trabajando",
  waiting: "Necesita respuesta",
  stopped: "Detenido",
  error: "Revisar",
};
export default function WorkList({
  channelId,
  compact = false,
  machineId,
  worktree,
}: {
  channelId?: string;
  compact?: boolean;
  machineId?: string;
  worktree?: string;
}) {
  const query = new URLSearchParams();
  if (channelId) query.set("channelId", channelId);
  if (machineId) query.set("machineId", machineId);
  if (worktree) query.set("worktree", worktree);
  const { data, error } = useSWR<{ threads: WorkThreadSummary[] }>(
    query.size ? `/api/work?${query}` : "/api/work",
    fetcher,
    { refreshInterval: 3000 },
  );
  if (error)
    return (
      <p role="alert" className="p-4 text-sm text-destructive">
        No se pudieron cargar los hilos de trabajo.
      </p>
    );
  if (!data) return compact ? null : <Skeleton className="h-32" />;
  if (!data.threads.length)
    return compact ? null : (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <Bot className="size-9 text-muted-foreground" />
          <p className="font-medium">
            {worktree
              ? "Este worktree aún no tiene conversaciones en Slak"
              : "Una conversación para cada encargo"}
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            {worktree
              ? "Puedes compartir su sesión desde Agentes del equipo para hablar con el agente que trabaja aquí."
              : "Menciona a un bot en un canal. El orquestador responderá en un hilo donde todo el equipo podrá seguir el trabajo y hablar con sus subagentes."}
          </p>
          <Link href="/agents" className="text-sm text-primary underline">
            Ver bots del equipo
          </Link>
        </CardContent>
      </Card>
    );
  if (compact)
    return (
      <div className="flex gap-2 overflow-x-auto border-b bg-muted/20 px-5 py-2">
        {data.threads.slice(0, 4).map((t) => (
          <Link
            key={t.id}
            href={`/work/${t.id}`}
            className="flex shrink-0 items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs hover:bg-accent"
          >
            <Bot className="size-3.5" />
            <span className="max-w-48 truncate">{t.title}</span>
            <span className="text-muted-foreground">
              {t.online ? workStateLabels[t.state] : "Sin conexión"}
            </span>
            <ArrowUpRight className="size-3" />
          </Link>
        ))}
      </div>
    );
  return (
    <div className="grid gap-3">
      {data.threads.map((t) => (
        <Link key={t.id} href={`/work/${t.id}`}>
          <Card className="transition-colors hover:bg-muted/40">
            <CardContent className="flex items-start gap-4 py-5">
              <div className="rounded-lg bg-primary/10 p-2.5 text-primary">
                <MessageSquare className="size-5" />
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-medium">{t.title}</h2>
                  <Badge
                    variant={t.state === "error" ? "destructive" : "secondary"}
                  >
                    {t.online ? workStateLabels[t.state] : "Sin conexión"}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  @{t.handle} · {t.machine}
                </p>
                {t.worktree && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <GitBranch className="size-3" />
                    {worktreeName(t.worktree)}
                  </p>
                )}
              </div>
              <ArrowUpRight className="size-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
