"use client";
import { useState } from "react";
import { Bot, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import useSWR from "swr";
import { api, fetcher, Summary } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
export default function AddMemberButton({ channelId }: { channelId: string }) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState<string | null>(null);
  const { data: summary } = useSWR<Summary>(
    open ? "/api/me/summary" : null,
    fetcher,
  );
  const { data, error, mutate } = useSWR<{
    members: { id: string; name: string; role: string; kind: string }[];
  }>(open ? `/api/channels/${channelId}/members` : null, fetcher);
  const ids = new Set(data?.members.map((m) => m.id));
  async function add(userId: string) {
    setBusy(userId);
    try {
      await api(`/api/channels/${channelId}/members`, "POST", { userId });
      await mutate();
      toast.success("Miembro añadido");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Users /> Miembros
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Miembros del canal</DialogTitle>
            <DialogDescription>
              Añade personas o agentes. Los agentes podrán leer este canal y
              recibir menciones.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="text-destructive">
              No se pudieron cargar los miembros.
            </p>
          ) : !data ? (
            <p>Cargando…</p>
          ) : (
            <>
              <div className="max-h-48 space-y-2 overflow-auto">
                {data.members.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 text-sm">
                    {m.kind === "agent" && <Bot className="size-4" />}
                    {m.name}
                    {m.kind === "agent" ? (
                      <Badge variant="secondary">Agente</Badge>
                    ) : (
                      m.role === "guest" && (
                        <Badge variant="outline">Invitado</Badge>
                      )
                    )}
                  </div>
                ))}
              </div>
              <p className="text-xs font-medium text-muted-foreground">
                Añadir al canal
              </p>
              <div className="max-h-52 space-y-1 overflow-auto">
                {summary?.users
                  .filter((u) => !ids.has(u.id))
                  .map((u) => (
                    <Button
                      key={u.id}
                      variant="ghost"
                      disabled={!!busy}
                      onClick={() => add(u.id)}
                      className="w-full justify-start"
                    >
                      {u.kind === "agent" && <Bot />}
                      {u.name}
                      <Plus className="ml-auto" />
                    </Button>
                  ))}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
