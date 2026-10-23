"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import {
  ArrowUp,
  ArrowUpRight,
  Bot,
  Brain,
  Check,
  ChevronDown,
  CircleAlert,
  GitBranch,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Server,
  Square,
  Terminal,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  fetcher,
  WorkConversationData,
  WorkEvent,
  WorkTurn,
} from "@/lib/client";
import MessageContent from "@/components/MessageContent";
import { workStateLabels } from "@/components/WorkList";
import { worktreeName } from "@/lib/workspaces";
import {
  conversationViews,
  visibleWorkEvents,
  visibleWorkTurns,
} from "@/lib/work-view";
import { useConversationView } from "@/components/useConversationView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function WorkConversation({
  threadId,
  compact = false,
  onClose,
}: {
  threadId: string;
  compact?: boolean;
  onClose?: () => void;
}) {
  const [view, setView] = useConversationView();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [older, setOlder] = useState<{
    events: WorkEvent[];
    turns: WorkTurn[];
  }>({ events: [], turns: [] });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [more, setMore] = useState(true);
  const [cursor, setCursor] = useState<WorkConversationData["next"]>();
  const [actionError, setActionError] = useState("");
  const { data, error, mutate } = useSWR<WorkConversationData>(
    `/api/work/${threadId}`,
    fetcher,
    { refreshInterval: 1800 },
  );
  const session = data?.sessions.find((s) => s.id === data.selectedId);
  const scroll = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const pendingSend = useRef<{
    content: string;
    sessionId: string;
    requestId: string;
  } | null>(null);
  const events = [
    ...new Map(
      [...older.events, ...(data?.events ?? [])].map((e) => [e.itemId, e]),
    ).values(),
  ];
  const turns = [
    ...new Map(
      [...older.turns, ...(data?.turns ?? [])].map((t) => [t.id, t]),
    ).values(),
  ];
  const timeline = [
    ...visibleWorkEvents(events, view).map((event) => ({
      key: `e:${event.itemId}`,
      time: event.observedAt,
      event,
      turn: undefined,
    })),
    ...visibleWorkTurns(turns, view).map((turn) => ({
      key: `t:${turn.id}`,
      time: turn.createdAt,
      turn,
      event: undefined,
    })),
  ].sort((a, b) => a.time.localeCompare(b.time));
  const latest = timeline.at(-1)?.key;
  const revision = events.at(-1)?.revision;
  useEffect(() => {
    if (scroll.current && stick.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [latest, revision, session?.id, view]);
  async function command(body: Record<string, unknown>) {
    setBusy(true);
    setActionError("");
    try {
      const result = await api(`/api/work/${threadId}`, "POST", body);
      await mutate();
      return result;
    } catch (e) {
      const message = (e as Error).message;
      setActionError(message);
      toast.error(message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (!session || !draft.trim() || busy) return;
    const content = draft.trim();
    if (
      pendingSend.current?.content !== content ||
      pendingSend.current?.sessionId !== session.id
    )
      pendingSend.current = {
        content,
        sessionId: session.id,
        requestId: crypto.randomUUID(),
      };
    try {
      await command({ action: "message", ...pendingSend.current });
      setDraft("");
      pendingSend.current = null;
      stick.current = true;
    } catch {
      /* keep draft and retry id */
    }
  }
  async function loadOlder() {
    if (!session || !data) return;
    const next = cursor ?? data.next;
    setLoadingOlder(true);
    try {
      const previous = (await fetcher(
        `/api/work/${threadId}?session=${session.id}&eventCursor=${encodeURIComponent(next.events ?? "done")}&turnCursor=${encodeURIComponent(next.turns ?? "done")}`,
      )) as WorkConversationData;
      setOlder((old) => ({
        events: [...previous.events, ...old.events],
        turns: [...previous.turns, ...old.turns],
      }));
      setMore(previous.hasOlder);
      setCursor(previous.next);
    } catch {
      toast.error("No se pudo cargar el historial anterior.");
    } finally {
      setLoadingOlder(false);
    }
  }
  if (error)
    return (
      <div className="p-6">
        <p role="alert" className="text-destructive">
          No se pudo cargar la conversación o ya no tienes acceso.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => mutate()}>
          Reintentar
        </Button>
      </div>
    );
  if (!data || !session)
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-12" />
        <Skeleton className="h-48" />
      </div>
    );
  const online = data.bot.online;
  const queued = turns.filter((t) => t.status === "queued").length;
  const activeAction = data.actions.find((a) =>
    ["queued", "running"].includes(a.status),
  );
  const lastFailure = data.actions.find((a) => a.status === "failed");
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background">
      <header className="flex items-start gap-3 border-b px-5 py-4">
        <div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary">
          <Bot className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold tracking-tight">
            {data.thread.title}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>@{data.bot.handle}</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1">
              <Users className="size-3" />
              Hilo compartido
            </span>
            <Badge
              variant={session.state === "error" ? "destructive" : "secondary"}
            >
              {workStateLabels[session.state]}
            </Badge>
          </div>
        </div>
        {compact && (
          <Button
            variant="ghost"
            size="icon"
            asChild
            title="Abrir conversación completa"
          >
            <Link href={`/work/${threadId}`}>
              <ArrowUpRight className="size-4" />
            </Link>
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          title="Memoria del agente"
          onClick={() => setMemoryOpen(true)}
        >
          <Brain className="size-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Opciones de la conversación"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={
                busy ||
                !!activeAction ||
                !data.canSend ||
                ["running", "waiting"].includes(session.state)
              }
              onSelect={() =>
                void command({
                  action: "compact",
                  sessionId: session.id,
                }).catch(() => {})
              }
            >
              Compactar contexto
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={
                busy ||
                !!activeAction ||
                !data.canSend ||
                ["running", "waiting"].includes(session.state)
              }
              onSelect={() =>
                void command({ action: "rotate", sessionId: session.id }).catch(
                  () => {},
                )
              }
            >
              {session.state === "stopped"
                ? "Reanudar conversación"
                : "Renovar sesión desde la memoria"}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={
                busy ||
                !!activeAction ||
                !data.canSend ||
                session.state === "stopped"
              }
              onSelect={() =>
                void command({ action: "stop", sessionId: session.id }).catch(
                  () => {},
                )
              }
            >
              <Square className="size-3.5" />
              Detener esta sesión
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/c/${data.thread.channelId}`}>Ir al canal</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Cerrar conversación"
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        )}
      </header>
      <div className="flex min-h-0 flex-1">
        {!compact && (
          <aside className="hidden w-60 shrink-0 flex-col border-r bg-muted/15 p-4 lg:flex">
            <p className="mb-3 text-xs font-medium text-muted-foreground">
              EQUIPO DEL PROYECTO
            </p>
            <div className="space-y-1">
              {data.sessions.map((s) => (
                <div
                  key={s.id}
                  className={`flex items-start gap-2 rounded-md py-2 ${s.role === "worker" ? "pl-3" : ""}`}
                >
                  {s.role === "orchestrator" ? (
                    <Bot className="mt-0.5 size-4 shrink-0" />
                  ) : (
                    <GitBranch className="mt-0.5 size-4 shrink-0" />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-sm">
                      {s.role === "orchestrator" ? "Agente padre" : s.name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {online ? workStateLabels[s.state] : "Sin conexión"}
                    </span>
                    {s.role === "worker" && s.worktree && (
                      <span
                        className="block truncate text-xs text-muted-foreground"
                        title={s.worktree}
                      >
                        {worktreeName(s.worktree)}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 mb-4 text-xs text-muted-foreground">
              Hablas con el agente padre. Él coordina los worktrees y recoge los
              resultados de los subagentes.
            </p>
            <div className="mt-auto space-y-3 border-t pt-4 text-xs text-muted-foreground">
              <p className="flex items-center gap-2">
                <Server className="size-3.5" />
                {data.bot.machine}
              </p>
              <p>
                {online ? "Máquina conectada" : "Puente de Orca desconectado"}
              </p>
              {!online && (
                <p>
                  {data.bot.enabled
                    ? "Abre el conector de Slak en esa máquina para reanudar el trabajo."
                    : "La conexión está revocada. Vuelve a conectar la máquina."}{" "}
                  <Link href="/machines" className="underline">
                    Revisar conexión
                  </Link>
                </p>
              )}
              <p className="flex items-start gap-2">
                <GitBranch className="size-3.5 shrink-0" />
                <span className="break-all">
                  {data.thread.worktree?.replace(/^path:/, "") ||
                    "Sin workspace aislado todavía"}
                </span>
              </p>
            </div>
          </aside>
        )}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b px-5 py-2.5 text-xs">
            <MessageSquare className="size-3.5 text-muted-foreground" />
            <span className="font-medium">{session.name}</span>
            <Select value={view} onValueChange={setView}>
              <SelectTrigger
                className="ml-auto"
                size="sm"
                aria-label="Vista de la conversación"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {conversationViews.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!online && (
              <span className="ml-auto text-muted-foreground">
                Se enviará cuando vuelva la máquina
              </span>
            )}
          </div>
          <div
            ref={scroll}
            onScroll={() => {
              const el = scroll.current;
              if (el)
                stick.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 120;
            }}
            className="min-h-0 flex-1 overflow-y-auto px-5 py-6"
          >
            <div className="mx-auto max-w-3xl space-y-5">
              {data.hasOlder && more && (
                <Button
                  variant="ghost"
                  className="w-full"
                  disabled={loadingOlder}
                  onClick={loadOlder}
                >
                  {loadingOlder ? "Cargando…" : "Cargar historial anterior"}
                </Button>
              )}
              {!timeline.length && (
                <div className="py-16 text-center">
                  <Bot className="mx-auto mb-3 size-8 text-muted-foreground" />
                  <p className="font-medium">
                    El trabajo empieza con una conversación
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Comparte contexto con {session.name.toLowerCase()}. El
                    equipo verá sus respuestas y herramientas aquí.
                  </p>
                </div>
              )}
              {timeline.map((item) =>
                item.turn ? (
                  <Turn key={item.key} turn={item.turn} />
                ) : (
                  <HarnessEvent
                    key={item.key}
                    event={item.event!}
                    showActivity={view === "activity"}
                    name={session.name}
                    disabled={busy || !!activeAction || !data.canSend}
                    onRespond={(body) =>
                      command({
                        action: "respond",
                        sessionId: session.id,
                        itemId: item.event!.itemId,
                        revision: item.event!.revision,
                        ...body,
                      })
                    }
                  />
                ),
              )}
              {data.childRequests?.map((request) => (
                <HarnessEvent
                  key={`${request.sessionId}:${request.itemId}`}
                  event={request}
                  showActivity={false}
                  name={
                    data.sessions.find(
                      (child) => child.id === request.sessionId,
                    )?.name || "Subagente"
                  }
                  disabled={busy || !data.canSend}
                  onRespond={(body) =>
                    command({
                      action: "respond",
                      sessionId: request.sessionId,
                      itemId: request.itemId,
                      revision: request.revision,
                      ...body,
                    })
                  }
                />
              ))}
              {["running", "waiting"].includes(session.state) && (
                <div
                  role="status"
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  {session.state === "running" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CircleAlert className="size-4" />
                  )}
                  {session.state === "running"
                    ? `${session.name} está trabajando…`
                    : "El agente necesita una respuesta para continuar."}
                </div>
              )}
              {session.error && (
                <p
                  role="alert"
                  className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
                >
                  {session.error}
                </p>
              )}
            </div>
          </div>
          <div className="mx-auto w-full max-w-3xl px-5 pb-5">
            {(activeAction || queued > 0) && (
              <p role="status" className="mb-2 text-xs text-muted-foreground">
                {activeAction
                  ? "Aplicando operación a la sesión…"
                  : `${queued} ${queued === 1 ? "mensaje en cola" : "mensajes en cola"}. Se procesan por orden.`}
              </p>
            )}
            {(actionError || lastFailure?.error) && (
              <p role="alert" className="mb-2 text-xs text-destructive">
                {actionError || lastFailure?.error}
              </p>
            )}
            <div className="rounded-xl border bg-background shadow-sm focus-within:ring-1 focus-within:ring-ring">
              <Textarea
                aria-label={`Mensaje a ${session.name}`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={`Escribe a ${session.name.toLowerCase()}…`}
                disabled={!data.canSend || session.state === "stopped"}
                maxLength={16000}
                className="min-h-24 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
              />
              <div className="flex items-center justify-between gap-2 px-3 pb-3">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Bot className="size-3.5" /> Agente padre · @{data.bot.handle}
                </span>
                <Button
                  size="icon"
                  className="size-8 rounded-lg"
                  aria-label="Enviar mensaje"
                  disabled={
                    busy ||
                    !draft.trim() ||
                    !data.canSend ||
                    session.state === "stopped"
                  }
                  onClick={send}
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ArrowUp className="size-4" />
                  )}
                </Button>
              </div>
            </div>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              Visible para quienes tienen acceso al canal · Enter para enviar
            </p>
          </div>
        </main>
      </div>
      <Dialog open={memoryOpen} onOpenChange={setMemoryOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Memoria de {session.name.toLowerCase()}</DialogTitle>
            <DialogDescription>
              Se conserva entre sesiones. El historial completo sigue disponible
              al compactar.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">Sesión {session.generation}</Badge>
            <Badge variant="outline">Memoria v{session.memoryVersion}</Badge>
            {session.context.tokens !== undefined && (
              <Badge variant="secondary">
                {session.context.tokens.toLocaleString()} tokens
                {session.context.window
                  ? ` / ${session.context.window.toLocaleString()}`
                  : ""}
              </Badge>
            )}
          </div>
          <p className="text-sm font-medium">Objetivo</p>
          <MessageContent content={data.thread.objective} />
          <p className="text-sm font-medium">Decisiones y progreso</p>
          {session.memory ? (
            <MessageContent content={session.memory} />
          ) : (
            <p className="text-sm text-muted-foreground">
              El agente aún no ha guardado un resumen. Los mensajes y las
              herramientas sí quedan registrados.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Turn({ turn }: { turn: WorkTurn }) {
  if (turn.kind === "notification")
    return (
      <details className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer">
          Actualización de un subagente ·{" "}
          {turn.status === "queued"
            ? "en cola para el orquestador"
            : "recibida por el orquestador"}
        </summary>
        <div className="mt-3">
          <MessageContent content={turn.prompt} />
        </div>
      </details>
    );
  return (
    <div className="ml-auto max-w-[92%] rounded-xl bg-muted/70 px-4 py-3">
      <div className="mb-1.5 flex items-center gap-2 text-xs">
        <span className="font-medium">
          {turn.kind === "delegation" ? "Encargo del orquestador" : turn.author}
        </span>
        <span className="text-muted-foreground">
          {new Date(turn.createdAt).toLocaleTimeString("es", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        {turn.status === "queued" && (
          <Badge variant="outline" className="text-[10px]">
            En cola
          </Badge>
        )}
        {["failed", "cancelled"].includes(turn.status) && (
          <span className="text-destructive">
            {turn.status === "failed" ? "Falló" : "Detenido"}
          </span>
        )}
      </div>
      <MessageContent content={turn.prompt} />
    </div>
  );
}

function HarnessEvent({
  event,
  name,
  onRespond,
  disabled,
  showActivity,
}: {
  event: WorkEvent;
  name: string;
  onRespond: (body: Record<string, unknown>) => Promise<unknown>;
  disabled: boolean;
  showActivity: boolean;
}) {
  const b = event.body;
  if (b.kind === "message") {
    const blocks = Array.isArray(b.blocks)
      ? (b.blocks as Record<string, unknown>[])
      : [];
    return (
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-xs font-medium">
          <Bot className="size-4 text-primary" />
          {name}
        </p>
        {blocks.map((block, i) =>
          block.type === "text" ? (
            <MessageContent key={i} content={String(block.text)} />
          ) : showActivity &&
            ["subagent", "subagent-group", "background-task"].includes(
              String(block.type),
            ) ? (
            <details key={i} className="rounded-lg border p-3 text-xs">
              <summary className="cursor-pointer">
                Actividad de agentes ·{" "}
                {String(block.label || "Subagentes nativos")}
              </summary>
              <pre className="mt-2 overflow-auto whitespace-pre-wrap">
                {JSON.stringify(block, null, 2)}
              </pre>
            </details>
          ) : null,
        )}
      </div>
    );
  }
  if (b.kind === "tool-call" || b.kind === "diff")
    return (
      <details className="group rounded-lg border bg-muted/15">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs">
          {b.state === "running" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : b.state === "failed" ? (
            <CircleAlert className="size-3.5 text-destructive" />
          ) : (
            <Check className="size-3.5 text-muted-foreground" />
          )}
          <Terminal className="size-3.5 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-mono">
            {String(b.name || b.path || "Cambios")}
          </span>
          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-3 border-t p-3">
          {b.input !== undefined && (
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all font-mono text-xs">
              {typeof b.input === "string"
                ? b.input
                : JSON.stringify(b.input, null, 2)}
            </pre>
          )}
          {b.output || b.patch ? (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3 font-mono text-xs">
              {payloadText(b.output || b.patch)}
            </pre>
          ) : null}
          {b.durationMs !== undefined && (
            <p className="text-xs text-muted-foreground">
              {(Number(b.durationMs) / 1000).toFixed(1)} s
            </p>
          )}
        </div>
      </details>
    );
  if (b.kind === "approval" || b.kind === "question")
    return (
      <PromptEvent
        key={`${event.itemId}:${event.revision}`}
        body={b}
        disabled={disabled}
        onRespond={onRespond}
      />
    );
  if (b.kind === "status" && b.text)
    return (
      <details className="text-xs text-muted-foreground">
        <summary className="flex cursor-pointer items-center gap-2">
          <CircleAlert
            className={`size-3.5 ${b.tone === "error" ? "text-destructive" : ""}`}
          />
          Diagnóstico de Orca
          <ChevronDown className="size-3" />
        </summary>
        <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted/50 p-3">
          {String(b.text)}
        </p>
      </details>
    );
  return null;
}
function payloadText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "head" in value)
    return `${value.head}${"truncated" in value && value.truncated ? "\n[… salida truncada por Orca]" : ""}`;
  return JSON.stringify(value, null, 2);
}
type PromptQuestion = {
  id: string;
  question: string;
  multiSelect?: boolean;
  options: { id: string; label: string; description?: string }[];
  freeTextInput?: { placeholder?: string };
  freeTextQuestionId?: string;
};
function PromptEvent({
  body,
  disabled,
  onRespond,
}: {
  body: Record<string, unknown>;
  disabled: boolean;
  onRespond: (body: Record<string, unknown>) => Promise<unknown>;
}) {
  const resolution = body.resolution as { state?: string } | undefined;
  const options = (
    Array.isArray(body.options) ? body.options : []
  ) as PromptQuestion["options"];
  const questions = (
    Array.isArray(body.questions)
      ? body.questions
      : body.freeTextQuestionId
        ? [
            {
              id: body.freeTextQuestionId,
              question: body.question,
              options,
              freeTextInput: body.freeTextInput,
            },
          ]
        : []
  ) as PromptQuestion[];
  const [answers, setAnswers] = useState<
    Record<string, { optionIds: string[]; other?: string }>
  >({});
  const pending = resolution?.state === "pending";
  return (
    <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <CircleAlert className="size-4" />
        {String(
          body.title || body.question || "El agente necesita una respuesta",
        )}
      </p>
      {body.detail ? (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">
          {String(body.detail)}
        </pre>
      ) : null}
      {body.description ? (
        <p className="text-sm text-muted-foreground">
          {String(body.description)}
        </p>
      ) : null}
      {questions.length ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void onRespond({
              answers: questions.map((q) => ({
                questionId: q.id,
                ...answers[q.id],
              })),
            }).catch(() => {});
          }}
        >
          {questions.map((q) => (
            <fieldset
              key={q.id}
              disabled={!pending || disabled}
              className="space-y-2"
            >
              <legend className="mb-2 text-sm font-medium">{q.question}</legend>
              <div className="flex flex-wrap gap-2">
                {q.options.map((o) => (
                  <Button
                    key={o.id}
                    type="button"
                    size="sm"
                    variant={
                      answers[q.id]?.optionIds.includes(o.id)
                        ? "secondary"
                        : "outline"
                    }
                    aria-pressed={
                      answers[q.id]?.optionIds.includes(o.id) ?? false
                    }
                    title={o.description}
                    onClick={() =>
                      setAnswers((all) => ({
                        ...all,
                        [q.id]: {
                          ...all[q.id],
                          optionIds: q.multiSelect
                            ? all[q.id]?.optionIds.includes(o.id)
                              ? all[q.id].optionIds.filter((id) => id !== o.id)
                              : [...(all[q.id]?.optionIds ?? []), o.id]
                            : [o.id],
                        },
                      }))
                    }
                  >
                    {o.label}
                  </Button>
                ))}
              </div>
              <Textarea
                aria-label={`Respuesta: ${q.question}`}
                placeholder={
                  q.freeTextInput?.placeholder || "Añade tu respuesta…"
                }
                value={answers[q.id]?.other ?? ""}
                onChange={(e) =>
                  setAnswers((all) => ({
                    ...all,
                    [q.id]: {
                      optionIds: all[q.id]?.optionIds ?? [],
                      other: e.target.value,
                    },
                  }))
                }
                maxLength={16000}
              />
            </fieldset>
          ))}
          <Button
            size="sm"
            disabled={
              !pending ||
              disabled ||
              questions.some(
                (q) =>
                  !answers[q.id]?.optionIds.length &&
                  !answers[q.id]?.other?.trim(),
              )
            }
          >
            Enviar respuesta
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((o) => (
            <Button
              key={o.id}
              variant="outline"
              size="sm"
              disabled={!pending || disabled}
              title={o.description}
              onClick={() => void onRespond({ optionId: o.id }).catch(() => {})}
            >
              {o.label}
            </Button>
          ))}
        </div>
      )}
      {!options.length && !questions.length && pending && (
        <p className="text-xs text-muted-foreground">
          Responde a esta solicitud desde Orca.
        </p>
      )}
      {!pending && (
        <p className="text-xs text-muted-foreground">Solicitud resuelta</p>
      )}
    </div>
  );
}
