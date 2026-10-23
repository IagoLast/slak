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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
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
  const [query, setQuery] = useState(""),
    [create, setCreate] = useState(false);
  const [connection, setConnection] = useState<{
    token: string;
    machine: boolean;
  } | null>(null);
  const [stop, setStop] = useState<AgentContact | null>(null),
    [disconnect, setDisconnect] = useState<SharedMachine | null>(null);
  const [busy, setBusy] = useState(false);
  const member = !!summary && summary.user.role !== "guest";
  const agents =
    agentData?.agents.filter((a) =>
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
              ? "Bots del equipo. Cada encargo tiene su propio hilo, contexto y subagentes."
              : "Conecta tu Orca local y comparte sus proyectos y sesiones con el equipo."}
          </p>
        </div>
        {member && (
          <Button onClick={() => setCreate(true)}>
            <Plus />
            {isAgents ? "Crear o compartir agente" : "Conectar mi Orca"}
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
                      ? "El siguiente compañero puede ser un agente"
                      : "Tu máquina, parte del equipo"}
                </h2>
                <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                  {isAgents
                    ? "Crea un orquestador en una máquina conectada. Menciónalo desde un canal para abrir un hilo de trabajo compartido."
                    : "Orca ejecuta el trabajo en tu equipo. Slak reúne las conversaciones, los agentes y las tareas de todos."}
                </p>
              </div>
              {!query && member && (
                <Button variant="outline" onClick={() => setCreate(true)}>
                  {isAgents
                    ? "Añadir el primer agente"
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
                        Orquestador · contexto por hilo
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
                            setConnection({ token, machine: false });
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
                          disabled={busy}
                          onClick={() =>
                            act(async () => {
                              const { token } = await api<{ token: string }>(
                                `/api/machines/${machine.id}`,
                                "POST",
                              );
                              setConnection({ token, machine: true });
                            })
                          }
                        >
                          <KeyRound />
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
      {create && (
        <CreateDialog
          machine={!isAgents}
          machines={machineData?.machines ?? []}
          agents={agentData?.agents ?? []}
          onClose={() => setCreate(false)}
          onCreated={(token) => {
            setCreate(false);
            if (token) setConnection({ token, machine: !isAgents });
            void refresh();
          }}
        />
      )}
      {connection && (
        <ConnectionDialog {...connection} onClose={() => setConnection(null)} />
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

function CreateDialog({
  machine,
  machines,
  agents,
  onClose,
  onCreated,
}: {
  machine: boolean;
  machines: SharedMachine[];
  agents: AgentContact[];
  onClose: () => void;
  onCreated: (token: string | null) => void;
}) {
  const [name, setName] = useState(""),
    [handle, setHandle] = useState(""),
    [description, setDescription] = useState("");
  const [handleEdited, setHandleEdited] = useState(false);
  const [mode, setMode] = useState("orchestrator"),
    [machineId, setMachineId] = useState(""),
    [repository, setRepository] = useState(""),
    [worktree, setWorktree] = useState(""),
    [provider, setProvider] = useState("codex");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const selected = machines.find((m) => m.id === machineId);
  const sessions =
    selected?.sessions.filter(
      (s) =>
        !agents.some(
          (a) => a.machineId === machineId && a.worktree === s.worktree,
        ),
    ) ?? [];
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await api<{ token: string | null }>(
        machine ? "/api/machines" : "/api/agents",
        "POST",
        machine
          ? { name }
          : {
              name,
              handle,
              description,
              mode: mode === "orchestrator" ? "orchestrator" : "session",
              ...(mode !== "mcp" && {
                machineId,
                repository,
                worktree: mode === "existing" ? worktree : "",
                provider,
              }),
            },
      );
      onCreated(data.token);
      toast.success(
        machine
          ? "Máquina creada: conecta ahora el puente local"
          : mode === "new"
            ? "Creando agente en Orca"
            : "Agente compartido",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-auto">
        <DialogHeader>
          <DialogTitle>
            {machine ? "Conectar mi Orca" : "Compartir un agente"}
          </DialogTitle>
          <DialogDescription>
            {machine
              ? "Tu equipo podrá trabajar con los proyectos y las sesiones que compartas desde tu máquina."
              : "Un orquestador coordina cada hilo con contexto propio y puede crear worktrees y subagentes."}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          {!machine && (
            <Field label="Cómo quieres conectarlo" id="agent-mode">
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger id="agent-mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="orchestrator">
                    Crear un bot orquestador
                  </SelectItem>
                  <SelectItem value="existing">
                    Compartir una sesión existente
                  </SelectItem>
                  <SelectItem value="new">
                    Crear un worktree y un agente
                  </SelectItem>
                  <SelectItem value="mcp">
                    Conectar un agente externo por MCP
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field
            label={machine ? "Nombre de tu máquina" : "Nombre del agente"}
            id="entity-name"
          >
            <Input
              id="entity-name"
              required
              maxLength={80}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!handleEdited)
                  setHandle(
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9-]/g, "-")
                      .slice(0, 40),
                  );
              }}
              placeholder={machine ? "MacBook de Ana" : "Iago bot"}
            />
          </Field>
          {!machine && (
            <>
              <Field label="Alias para menciones" id="agent-handle">
                <Input
                  id="agent-handle"
                  required
                  pattern="[a-z0-9][a-z0-9_-]{1,39}"
                  value={handle}
                  onChange={(e) => {
                    setHandleEdited(true);
                    setHandle(e.target.value);
                  }}
                  placeholder="iago-bot"
                />
              </Field>
              <Field label="Qué hace este agente" id="agent-description">
                <Textarea
                  id="agent-description"
                  value={description}
                  maxLength={500}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Contexto, responsabilidades o proyecto…"
                />
              </Field>
              {mode !== "mcp" && (
                <>
                  <Field label="Máquina compartida" id="agent-machine">
                    <Select
                      value={machineId}
                      onValueChange={(v) => {
                        setMachineId(v);
                        setRepository("");
                        setWorktree("");
                      }}
                    >
                      <SelectTrigger id="agent-machine" className="w-full">
                        <SelectValue placeholder="Elige una máquina conectada" />
                      </SelectTrigger>
                      <SelectContent>
                        {machines
                          .filter((m) => m.online)
                          .map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.name} · {m.ownerName}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  {!machines.some((m) => m.online) && (
                    <p className="text-sm text-muted-foreground">
                      Primero conecta tu Orca desde{" "}
                      <Link href="/machines" className="text-primary underline">
                        Máquinas compartidas
                      </Link>
                      .
                    </p>
                  )}
                  {mode === "existing" ? (
                    <Field label="Sesión de Orca" id="agent-session">
                      <Select
                        value={worktree}
                        onValueChange={(v) => {
                          setWorktree(v);
                          const s = sessions.find((s) => s.worktree === v);
                          setRepository(s?.repository ?? "");
                        }}
                      >
                        <SelectTrigger id="agent-session" className="w-full">
                          <SelectValue placeholder="Selecciona una sesión compartida" />
                        </SelectTrigger>
                        <SelectContent>
                          {sessions.map((s) => (
                            <SelectItem key={s.worktree} value={s.worktree}>
                              {s.name} · {s.provider}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {selected && !sessions.length && (
                        <p className="text-xs text-muted-foreground">
                          No hay sesiones disponibles. Abre un agente en Orca o
                          crea uno nuevo.
                        </p>
                      )}
                    </Field>
                  ) : (
                    <>
                      <Field label="Proyecto" id="agent-repository">
                        <Select
                          value={repository}
                          onValueChange={setRepository}
                        >
                          <SelectTrigger
                            id="agent-repository"
                            className="w-full"
                          >
                            <SelectValue placeholder="Selecciona un proyecto" />
                          </SelectTrigger>
                          <SelectContent>
                            {selected?.repositories.map((r) => (
                              <SelectItem key={r.id} value={r.id}>
                                {r.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Agente de IA" id="agent-provider">
                        <Select value={provider} onValueChange={setProvider}>
                          <SelectTrigger id="agent-provider" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="codex">Codex</SelectItem>
                            <SelectItem value="claude">Claude Code</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                    </>
                  )}
                </>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={
              busy ||
              (!machine &&
                mode !== "mcp" &&
                (!machineId ||
                  !repository ||
                  (mode === "existing" && !worktree)))
            }
          >
            {busy
              ? "Preparando…"
              : machine
                ? "Continuar"
                : mode === "new"
                  ? "Crear agente"
                  : "Compartir agente"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function Field({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
function ConnectionDialog({
  token,
  machine,
  onClose,
}: {
  token: string;
  machine: boolean;
  onClose: () => void;
}) {
  const url = `${window.location.origin}/api/mcp`;
  const config = JSON.stringify(
    machine
      ? { url, token }
      : {
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
    a.download = machine ? "slak-machine.json" : "slak-mcp.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {machine ? "Conecta el puente de Orca" : "Conexión MCP del agente"}
          </DialogTitle>
          <DialogDescription>
            Guarda esta configuración. El token solo se muestra ahora y permite
            actuar con esta identidad.
          </DialogDescription>
        </DialogHeader>
        {machine ? (
          <div className="space-y-3 text-sm">
            <p>
              En la máquina que ejecuta Orca, abre una copia de este
              repositorio, instala sus dependencias y descarga la configuración.
            </p>
            <p>Comparte todos tus proyectos y sesiones de Orca con:</p>
            <pre className="overflow-auto rounded-lg bg-muted p-3 text-xs">
              npm run orca:bridge -- --config ./slak-machine.json --share-all
            </pre>
            <p className="text-muted-foreground">
              Para compartir solo un proyecto, sustituye{" "}
              <code>--share-all</code> por <code>--repo id:ID</code>. Consulta
              los IDs con <code>orca repo list</code>. Mantén el puente abierto
              mientras compartes tu máquina.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Añade esta configuración a tu cliente MCP. Usa heartbeat,
            list_tasks, claim_task, task_context y finish_task para recibir
            trabajo y responder.
          </p>
        )}
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
