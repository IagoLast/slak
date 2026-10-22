"use client";
import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { ListPlus } from "lucide-react";
import { api, fetcher, AgentContact } from "@/lib/client";
import { Button } from "@/components/ui/button";
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
export default function AgentTaskDialog({ channelId }: { channelId: string }) {
  const [open, setOpen] = useState(false),
    [agentId, setAgentId] = useState(""),
    [prompt, setPrompt] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const { mutate } = useSWRConfig();
  const { data } = useSWR<{ agents: AgentContact[] }>(
    open ? "/api/agents" : null,
    fetcher,
  );
  const { data: members } = useSWR<{ members: { id: string }[] }>(
    open ? `/api/channels/${channelId}/members` : null,
    fetcher,
  );
  const available =
    data?.agents.filter(
      (a) => a.enabled && members?.members.some((m) => m.id === a.id),
    ) ?? [];
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/tasks", "POST", { channelId, agentId, prompt });
      setOpen(false);
      setPrompt("");
      toast.success("Tarea en cola");
      void mutate(`/api/channels/${channelId}/messages`);
      void mutate(`/api/tasks?channelId=${channelId}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ListPlus />
        <span className="hidden sm:inline">Encargar tarea</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Encargar una tarea</DialogTitle>
            <DialogDescription>
              El agente recibe el contexto de esta conversación y publica aquí
              el resultado.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="task-agent">Agente</Label>
              <Select value={agentId} onValueChange={setAgentId}>
                <SelectTrigger id="task-agent" className="w-full">
                  <SelectValue placeholder="Selecciona un agente" />
                </SelectTrigger>
                <SelectContent>
                  {available.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} ·{" "}
                      {a.online ? "En línea" : "Pendiente de conexión"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!available.length && (
                <p className="text-sm text-muted-foreground">
                  Añade un agente a esta conversación desde Miembros o abre un
                  mensaje directo con él.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-prompt">Qué necesitas</Label>
              <Textarea
                id="task-prompt"
                required
                maxLength={16000}
                rows={5}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe el objetivo y cómo sabremos que está terminado…"
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={busy || !agentId || !prompt.trim()}
            >
              {busy ? "Enviando…" : "Enviar tarea"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
