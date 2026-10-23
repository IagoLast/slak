"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Bot,
  Server,
  Plus,
  MessageSquare,
  Square,
  Play,
  Plug,
  KeyRound,
  Download,
  Copy,
  Search,
  GitBranch,
  User,
} from "lucide-react";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";
import {
  AgentContact,
  SharedMachine,
  Summary,
  api,
  fetcher,
} from "@/lib/client";
import { PresenceDot } from "@/components/Sidebar";
import MachineConnectDialog, {
  type MachinePairing,
} from "@/components/MachineConnectDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";

const stateLabels = {
  external: "MCP",
  starting: "Arrancando",
  ready: "Disponible",
  stopping: "Deteniendo",
  stopped: "Detenido",
  error: "Revisar conexión",
};
export default function TeamDirectory({
  view,
}: {
  view: "agents" | "machines";
}) {
  const router = useRouter(),
    { mutate } = useSWRConfig();
  const { data: summary } = useSWR<Summary>("/api/me/summary", fetcher);
  const { data: agentData, error: agentError } = useSWR<{
    agents: AgentContact[];
  }>("/api/agents", fetcher, { refreshInterval: 4000 });
  const { data: machineData, error: machineError } = useSWR<{
    machines: SharedMachine[];
  }>("/api/machines", fetcher, { refreshInterval: 5000 });
  const [query, setQuery] = useState("");
  const [connection, setConnection] = useState<{
    token: string;
  } | null>(null);
  const [machineConnection, setMachineConnection] =
    useState<MachinePairing | null>(null);
  const [stop, setStop] = useState<AgentContact | null>(null),
    [disconnect, setDisconnect] = useState<SharedMachine | null>(null);
  const [busy, setBusy] = useState(false);
  const member = !!summary && summary.user.role !== "guest";
  const agents =
    agentData?.agents.filter(
      (a) =>
        a.mode === "orchestrator" &&
        `${a.name} ${a.handle} ${a.machine} ${a.ownerName}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    ) ?? [];
  const machines =
    machineData?.machines.filter((m) =>
      `${m.name} ${m.ownerName}`.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  async function refresh() {
    await Promise.all([
      mutate("/api/agents"),
      mutate("/api/machines"),
      mutate("/api/me/summary"),
    ]);
  }
  async function act(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function chat(agent: AgentContact) {
    await act(async () => {
      const { channelId } = await api<{ channelId: string }>(
        "/api/dms",
        "POST",
        { userId: agent.id },
      );
      router.push(`/c/${channelId}`);
    });
  }
  async function connectMachine(machineId?: string) {
    await act(async () => {
      const pairing = await api<MachinePairing>(
        "/api/machines/pairing",
        "POST",
        { machineId },
      );
      setMachineConnection({ ...pairing, machineId });
    });
  }
  const isAgents = view === "agents",
    ready = isAgents ? !!agentData : !!machineData,
    error = isAgents ? agentError : machineError;
  return (
    <div className="flex-1 overflow-auto">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b px-6 py-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {isAgents ? "Agentes del equipo" : "Máquinas compartidas"}
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            {isAgents
              ? "Un agente padre por proyecto y máquina. Habla con él: organiza los worktrees, delega en subagentes y reúne los resultados."
              : "Conecta tu Orca local y comparte sus proyectos y sesiones con el equipo."}
          </p>
        </div>
        {member && (
          <Button disabled={busy} onClick={() => void connectMachine()}>
            <Plus />
            {isAgents ? "Conectar un proyecto" : "Conectar mi Orca"}
          </Button>
        )}
      </header>
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
            <Input
              aria-label={isAgents ? "Buscar agentes" : "Buscar máquinas"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                isAgents
                  ? "Buscar por agente, máquina o persona…"
                  : "Buscar por máquina o persona…"
              }
              className="pl-9"
            />
          </div>
          <Badge variant="outline">
            {isAgents ? agents.length : machines.length}{" "}
            {isAgents ? "agentes" : "máquinas"}
          </Badge>
        </div>
        {error && (
          <p role="alert" className="text-destructive">
            No se pudo cargar el directorio. Vuelve a intentarlo.
          </p>
        )}
        {!ready && !error && (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-56" />
            ))}
          </div>
        )}
        {ready && !(isAgents ? agents.length : machines.length) && (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
              {isAgents ? (
                <Bot className="size-10 text-muted-foreground" />
              ) : (
                <Server className="size-10 text-muted-foreground" />
              )}
              <div>
                <h2 className="font-semibold">
                  {query
                    ? "No hay coincidencias"
                    : isAgents
                      ? "Conecta un proyecto para hablar con su agente padre"
                      : "Tu máquina, parte del equipo"}
                </h2>
                <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                  {isAgents
                    ? "Al compartir un proyecto de Orca, Slak prepara su agente padre. Puedes hablarle desde la barra lateral o mencionarlo en un canal."
                    : "Orca ejecuta el trabajo en tu equipo. Slak reúne las conversaciones, los agentes y las tareas de todos."}
                </p>
              </div>
              {!query && member && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void connectMachine()}
                >
                  {isAgents
                    ? "Conectar el primer proyecto"
                    : "Conectar una máquina"}
                </Button>
              )}
            </CardContent>
          </Card>
        )}
        <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
          {isAgents
            ? agents.map((agent) => (
                <Card key={agent.id}>
                  <CardHeader>
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Bot className="size-5" />
                      </div>
                      <Badge
                        variant={
                          agent.state === "error" ? "destructive" : "outline"
                        }
                      >
                        <PresenceDot online={agent.online} />
                        {agent.online
                          ? stateLabels[agent.state]
                          : ["external", "ready"].includes(agent.state)
                            ? "Desconectado"
                            : stateLabels[agent.state]}
                      </Badge>
                    </div>
                    <CardTitle>{agent.name}</CardTitle>
                    <CardDescription>@{agent.handle}</CardDescription>
                    {agent.mode === "orchestrator" && (
                      <Badge variant="secondary" className="w-fit">
                        Agente padre del proyecto
                      </Badge>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <p className="min-h-10 text-muted-foreground">
                      {agent.description ||
                        "Un compañero de equipo con su propio contexto de trabajo."}
                    </p>
                    <div className="space-y-2 text-xs text-muted-foreground">
                      <p className="flex items-center gap-2">
                        <User className="size-3.5" />
                        Compartido por {agent.ownerName}
                      </p>
                      <p className="flex items-center gap-2">
                        <Server className="size-3.5" />
                        {agent.machine || "Conexión MCP"}
                      </p>
                      {agent.worktree && agent.mode !== "orchestrator" && (
                        <p
                          className="flex items-center gap-2"
                          title={agent.worktree}
                        >
                          <GitBranch className="size-3.5 shrink-0" />
                          <span className="truncate">
                            {agent.worktree.replace(/^path:/, "")}
                          </span>
                        </p>
                      )}
                    </div>
                    {agent.error && (
                      <p className="rounded-lg bg-destructive/5 p-2 text-xs text-destructive">
                        {agent.error}
                      </p>
                    )}
                  </CardContent>
                  <CardFooter className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => chat(agent)}
                    >
                      <MessageSquare />
                      Hablar
                    </Button>
                    {member && agent.machineId && agent.mode === "session" && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        title="Usa este alias para nuevos hilos con contexto independiente. La sesión anterior se conserva en Orca."
                        onClick={() =>
                          act(async () => {
                            await api(
                              `/api/agents/${agent.id}/orchestrator`,
                              "POST",
                            );
                            toast.success(
                              "Orquestador activado. Los nuevos encargos abrirán sus propios hilos.",
                            );
                          })
                        }
                      >
                        <Bot />
                        Activar orquestador
                      </Button>
                    )}
                    {member &&
                      agent.machineId &&
                      (agent.state === "ready" ? (
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setStop(agent)}
                        >
                          <Square />
                          Detener
                        </Button>
                      ) : (
                        ["stopped", "error"].includes(agent.state) && (
                          <Button
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              act(async () => {
                                await api(
                                  `/api/agents/${agent.id}/lifecycle`,
                                  "POST",
                                  { action: "start" },
                                );
                              })
                            }
                          >
                            <Play />
                            Arrancar
                          </Button>
                        )
                      ))}
                    {member && !agent.machineId && (
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          act(async () => {
                            const { token } = await api<{ token: string }>(
                              `/api/agents/${agent.id}/token`,
                              "POST",
                            );
                            setConnection({ token });
                          })
                        }
                      >
                        <KeyRound />
                        Nuevo token
                      </Button>
                    )}
                  </CardFooter>
                </Card>
              ))
            : machines.map((machine) => (
                <Card key={machine.id}>
                  <CardHeader>
                    <div className="mb-2 flex items-center justify-between">
                      <Server className="size-6 text-primary" />
                      <Badge variant="outline">
                        <PresenceDot online={machine.online} />
                        {machine.online ? "Conectada" : "Desconectada"}
                      </Badge>
                    </div>
                    <CardTitle>{machine.name}</CardTitle>
                    <CardDescription>
                      Compartida por {machine.ownerName}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      {machine.repositories.length} proyectos ·{" "}
                      {machine.sessions.length} sesiones compartidas
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {machine.repositories.map((r) => (
                        <Badge key={r.id} variant="secondary">
                          {r.name}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                  <CardFooter className="flex flex-wrap gap-2">
                    <Button asChild variant="outline">
                      <Link href="/agents">
                        <Bot />
                        Ver agentes
                      </Link>
                    </Button>
                    {(machine.ownerId === summary?.user.id ||
                      summary?.user.role === "admin") && (
                      <>
                        <Button
                          variant="ghost"
                          disabled={busy || machine.online}
                          onClick={() => void connectMachine(machine.id)}
                        >
                          <Plug />
                          Conectar
                        </Button>
                        {machine.enabled && (
                          <Button
                            variant="ghost"
                            onClick={() => setDisconnect(machine)}
                          >
                            Desconectar
                          </Button>
                        )}
                      </>
                    )}
                  </CardFooter>
                </Card>
              ))}
        </div>
      </div>
      {connection && (
        <ConnectionDialog {...connection} onClose={() => setConnection(null)} />
      )}
      {machineConnection && (
        <MachineConnectDialog
          key={machineConnection.id}
          pairing={machineConnection}
          busy={busy}
          onRetry={(machineId) => void connectMachine(machineId)}
          onClose={() => setMachineConnection(null)}
        />
      )}
      <AlertDialog
        open={!!stop}
        onOpenChange={(v) => !v && !busy && setStop(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Detener a {stop?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se cerrará su sesión en Orca y se marcará el trabajo pendiente
              como fallido. El worktree, sus archivos y las conversaciones se
              conservan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void act(async () => {
                  await api(`/api/agents/${stop!.id}/lifecycle`, "POST", {
                    action: "stop",
                  });
                  setStop(null);
                });
              }}
            >
              Detener agente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={!!disconnect}
        onOpenChange={(v) => !v && !busy && setDisconnect(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Desconectar {disconnect?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Slak dejará de tener acceso a esta máquina. Las sesiones que ya se
              ejecutan en Orca continuarán allí.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void act(async () => {
                  await api(`/api/machines/${disconnect!.id}`, "DELETE");
                  setDisconnect(null);
                });
              }}
            >
              Desconectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ConnectionDialog({
  token,
  onClose,
}: {
  token: string;
  onClose: () => void;
}) {
  const url = `${window.location.origin}/api/mcp`;
  const config = JSON.stringify(
    {
      mcpServers: {
        slak: { url, headers: { Authorization: `Bearer ${token}` } },
      },
    },
    null,
    2,
  );
  function download() {
    const url = URL.createObjectURL(
      new Blob([config], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "slak-mcp.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Conexión MCP del agente</DialogTitle>
          <DialogDescription>
            Guarda esta configuración. El token solo se muestra ahora y permite
            actuar con esta identidad.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Añade esta configuración a tu cliente MCP. Usa heartbeat, list_tasks,
          claim_task, task_context y finish_task para recibir trabajo y
          responder.
        </p>
        <pre className="max-h-56 overflow-auto rounded-lg border bg-muted p-3 text-xs">
          {config}
        </pre>
        <div className="flex gap-2">
          <Button onClick={download}>
            <Download />
            Descargar configuración
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(config);
                toast.success("Configuración copiada");
              } catch {
                toast.error("Usa Descargar configuración.");
              }
            }}
          >
            <Copy />
            Copiar
          </Button>
        </div>
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Plug className="size-4 shrink-0" />
          La presencia se actualizará cuando el puente o el cliente MCP se
          conecte.
        </p>
      </DialogContent>
    </Dialog>
  );
}
