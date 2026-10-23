"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import {
  Archive,
  ArrowUp,
  ArrowUpRight,
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
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
import { workStateLabels } from "@/lib/workspaces";
import { worktreeName, workSessionHref } from "@/lib/workspaces";
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
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

export default function WorkConversation({
  threadId,
  sessionId,
  compact = false,
  embedded = false,
  draft: controlledDraft,
  onDraftChange,
  onClose,
}: {
  threadId: string;
  sessionId?: string;
  compact?: boolean;
  embedded?: boolean;
  draft?: string;
  onDraftChange?: (draft: string) => void;
  onClose?: () => void;
}) {
  const [view, setView] = useConversationView();
  const [localDraft, setLocalDraft] = useState("");
  const draft = controlledDraft ?? localDraft;
  const setDraft = onDraftChange ?? setLocalDraft;
  const [busy, setBusy] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [older, setOlder] = useState<{
    events: WorkEvent[];
    turns: WorkTurn[];
  }>({ events: [], turns: [] });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [more, setMore] = useState(true);
  const [cursor, setCursor] = useState<WorkConversationData["next"]>();
  const [actionError, setActionError] = useState("");
  const { data, error, mutate } = useSWR<WorkConversationData>(
    `/api/work/${threadId}${sessionId ? `?session=${encodeURIComponent(sessionId)}` : ""}`,
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
  const worktree =
    session.worktree ||
    (session.role === "orchestrator" ? data.thread.worktree : null);
  const queued = turns.filter((t) => t.status === "queued").length;
  const activeAction = data.actions.find((a) =>
    ["queued", "running"].includes(a.status),
  );
  const lastFailure = data.actions.find((a) => a.status === "failed");
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2 sm:px-5">
        {!embedded && (
          <>
            <MessageSquare className="size-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-semibold tracking-tight">
                {data.workspace?.name ||
                  (worktree ? worktreeName(worktree) : data.thread.title)}
              </h1>
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                {session.name} · <Server className="size-3" /> {data.bot.machine}
              </p>
            </div>
          </>
        )}
        <Badge variant={session.state === "error" ? "destructive" : "secondary"}>
          {session.closedAt
            ? "Worktree cerrado"
            : online ? workStateLabels[session.state] : "Sin conexión"}
        </Badge>
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
        {data.canManage && ["running", "waiting"].includes(session.state) && (
          <Button
            variant="outline"
            size="sm"
            disabled={
              busy ||
              !!activeAction ||
              !online ||
              !data.canSend ||
              !data.canInterrupt
            }
            title={
              !data.canInterrupt
                ? "Actualiza y reinicia el puente de Orca"
                : "Interrumpir el turno actual"
            }
            onClick={() =>
              void command({
                action: "interrupt",
                sessionId: session.id,
              }).catch(() => {})
            }
          >
            <Square className="size-3.5" />
            <span className="sr-only sm:not-sr-only">Interrumpir</span>
          </Button>
        )}
        {data.canManage && session.state === "stopped" && !session.closedAt && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !!activeAction || !data.canSend}
            onClick={() =>
              void command({ action: "rotate", sessionId: session.id }).catch(
                () => {},
              )
            }
          >
            Reanudar
          </Button>
        )}
        {compact && (
          <Button
            variant="ghost"
            size="icon"
            asChild
            title="Abrir conversación completa"
          >
            <Link href={workSessionHref(threadId, session.id)}>
              <ArrowUpRight className="size-4" />
            </Link>
          </Button>
        )}
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
            {data.canCloseWorktree && (
              <DropdownMenuItem
                disabled={busy || !!activeAction || !online}
                onSelect={() => setCloseOpen(true)}
              >
                <Archive className="size-3.5" />
                Cerrar worktree
              </DropdownMenuItem>
            )}

            <DropdownMenuItem
              disabled={
                busy ||
                !!activeAction ||
                !data.canSend ||
                !data.canManage ||
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
                !data.canManage ||
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
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {session.closedAt && (
            <div
              role="status"
              className="border-b bg-muted/40 px-5 py-3 text-sm text-muted-foreground"
            >
              Worktree cerrado y archivado en Orca. Los archivos y esta
              conversación se conservan.
            </div>
          )}
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
                    {session.error
                      ? "No se pudo recuperar el historial"
                      : !session.lastSeenAt
                      ? online ? "Cargando mensajes de Orca…" : "Historial pendiente de sincronizar"
                      : "Todavía no hay mensajes en esta vista"}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {session.error
                      ? "El motivo aparece debajo. El puente volverá a intentarlo."
                      : !session.lastSeenAt
                      ? online
                        ? "El puente está recuperando la conversación existente."
                        : "Conecta la máquina para recuperar la conversación."
                      : "Puedes escribir a la sesión o cambiar la vista para ver su actividad."}
                  </p>
                </div>
              )}
              {timeline.map((item) =>
                item.turn ? (
                  <div key={item.key} className="space-y-5">
                    <Turn turn={item.turn} />
                    {data.bot.mode === "session" && item.turn.result && (
                      <div className="space-y-2">
                        <p className="flex items-center gap-2 text-xs font-medium">
                          <Bot className="size-4 text-primary" />
                          {session.name}
                        </p>
                        <MessageContent content={item.turn.result} />
                      </div>
                    )}
                  </div>
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
              {online && ["running", "waiting"].includes(session.state) && (
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
                disabled={
                  !data.canSend || !!activeAction || session.state === "stopped"
                }
                maxLength={16000}
                className="min-h-24 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
              />
              <div className="flex items-center justify-between gap-2 px-3 pb-3">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MessageSquare className="size-3.5" /> {session.name}
                </span>
                <Button
                  size="icon"
                  className="size-8 rounded-lg"
                  aria-label="Enviar mensaje"
                  disabled={
                    busy ||
                    !!activeAction ||
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
              Enter para enviar · Shift+Enter para salto de línea
            </p>
          </div>
        </main>
      </div>
      <AlertDialog open={closeOpen} onOpenChange={setCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Cerrar{" "}
              {data.workspace?.name ||
                (worktree ? worktreeName(worktree) : "worktree")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se detendrán todos los agentes y terminales de este worktree y se
              archivará en Orca. Los archivos y el historial se conservan.
              Podrás volver a abrirlo desde Orca.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                void command({
                  action: "close-worktree",
                  sessionId: session.id,
                }).catch(() => {})
              }
            >
              Cerrar worktree
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Turn({ turn }: { turn: WorkTurn }) {
  if (turn.kind === "notification")
    return (
      <details className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer">
          Actualización anterior ·{" "}
          {turn.status === "queued" ? "en cola" : "recibida"}
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
          {turn.kind === "delegation" ? "Mensaje anterior" : turn.author}
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
          {b.role === "user" ? (
            <Users className="size-4" />
          ) : (
            <Bot className="size-4 text-primary" />
          )}
          {b.role === "user" ? "Mensaje desde Orca" : name}
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
