"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, CheckCircle2, Copy, Loader2, Terminal } from "lucide-react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { fetcher } from "@/lib/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type MachinePairing = {
  id: string;
  code: string;
  expiresAt: string;
  machineId?: string;
};
type ConnectionStatus = {
  status: "waiting" | "starting" | "connected" | "expired";
  stalled: boolean;
  machine: { id: string; name: string } | null;
};
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export default function MachineConnectDialog({
  pairing,
  busy,
  onRetry,
  onClose,
}: {
  pairing: MachinePairing;
  busy: boolean;
  onRetry: (machineId?: string) => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const { mutate } = useSWRConfig();
  const { data, error } = useSWR<ConnectionStatus>(
    `/api/machines/pairing?id=${pairing.id}`,
    fetcher,
    {
      refreshInterval: (status) =>
        status?.status === "connected" || status?.status === "expired"
          ? 0
          : 2000,
    },
  );
  const connected = data?.status === "connected";
  useEffect(() => {
    if (connected) void mutate("/api/machines");
  }, [connected, mutate]);
  const origin = window.location.origin;
  const command = `curl -fsSL ${quote(`${origin}/api/machines/install`)} | bash -s -- ${quote(origin)} ${quote(pairing.code)}`;
  const expired = data?.status === "expired";
  const retry = () => onRetry(data?.machine?.id ?? pairing.machineId);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-auto sm:max-w-xl">
        <DialogHeader>
          <div className="mb-2 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            {connected ? (
              <CheckCircle2 className="size-6" />
            ) : (
              <Terminal className="size-6" />
            )}
          </div>
          <DialogTitle>
            {connected
              ? "Tu Orca ya está conectado"
              : "Conecta tu Orca en un momento"}
          </DialogTitle>
          <DialogDescription>
            {connected
              ? `${data.machine?.name} ya está disponible para tu equipo.`
              : "Pega este comando en la terminal de la máquina que tiene Orca. Elige los proyectos que quieras compartir y listo."}
          </DialogDescription>
        </DialogHeader>
        {connected ? (
          <div className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Cada proyecto compartido tiene su agente padre. Ya puedes
              encargarle trabajo desde Slak.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/agents">Ver agentes padre</Link>
              </Button>
              <Button variant="outline" onClick={onClose}>
                Listo
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {expired || error ? (
              <div className="rounded-xl border p-4 text-sm" role="alert">
                <p>
                  {expired
                    ? "El comando ha caducado. Genera uno nuevo para continuar."
                    : "No se pudo comprobar la conexión. Revisa tu conexión a Internet o genera otro comando."}
                </p>
                <Button
                  className="mt-3"
                  variant="outline"
                  disabled={busy}
                  onClick={retry}
                >
                  Generar nuevo comando
                </Button>
              </div>
            ) : data?.status === "starting" ? (
              <p className="rounded-xl border p-4 text-sm">
                La instalación está lista. Esperando a que Orca termine de
                conectar…
              </p>
            ) : (
              <div className="space-y-3">
                <pre
                  className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-xl border bg-muted p-4 text-xs leading-relaxed"
                  tabIndex={0}
                  aria-label="Comando para conectar Orca"
                >
                  {command}
                </pre>
                <Button
                  className="w-full"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(command);
                      setCopied(true);
                    } catch {
                      toast.error(
                        "Selecciona el comando y cópialo manualmente.",
                      );
                    }
                  }}
                >
                  {copied ? <Check /> : <Copy />}
                  {copied
                    ? "Copiado · pégalo en tu terminal"
                    : "Copiar comando"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  El comando es personal y caduca en 15 minutos. Requiere Orca
                  abierto y Node.js 20 o posterior.
                </p>
              </div>
            )}
            {!expired && !error && (
              <div
                role="status"
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <Loader2 className="size-4 motion-safe:animate-spin" />
                {data?.status === "starting"
                  ? "Conectando con Orca…"
                  : "Esperando a tu máquina…"}
              </div>
            )}
            {data?.stalled && (
              <div className="space-y-2 text-sm" role="alert">
                <p>
                  La conexión está tardando. Revisa el mensaje de la terminal;
                  puedes generar otro comando para reintentar.
                </p>
                <Button variant="outline" disabled={busy} onClick={retry}>
                  Reintentar conexión
                </Button>
              </div>
            )}
            <details className="rounded-xl border px-4 py-3 text-sm">
              <summary className="cursor-pointer font-medium">
                ¿Qué hace el instalador?
              </summary>
              <p className="mt-2 text-muted-foreground">
                Detecta tus proyectos, te deja elegir cuáles compartir y guarda
                la conexión en tu máquina. Mantén la terminal abierta mientras
                trabajas; puedes desconectarla cuando quieras desde Slak.
              </p>
              <p className="mt-2 text-muted-foreground">
                Para conectar otra máquina, abre Slak desde una dirección HTTPS
                accesible desde ella.
              </p>
            </details>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
