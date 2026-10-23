"use client";
import Link from "next/link";
import { useState } from "react";
import { Server, Plus, Plug, Search, GitBranch } from "lucide-react";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";
import { SharedMachine, Summary, api, fetcher } from "@/lib/client";
import { worktreeHref } from "@/lib/workspaces";
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

export default function TeamDirectory() {
  const { mutate } = useSWRConfig();
  const { data: summary } = useSWR<Summary>("/api/me/summary", fetcher);
  const { data, error } = useSWR<{ machines: SharedMachine[] }>(
    "/api/machines",
    fetcher,
    { refreshInterval: 5000 },
  );
  const [query, setQuery] = useState("");
  const [machineConnection, setMachineConnection] =
    useState<MachinePairing | null>(null);
  const [disconnect, setDisconnect] = useState<SharedMachine | null>(null);
  const [busy, setBusy] = useState(false);
  const member = !!summary && summary.user.role !== "guest";
  const machines =
    data?.machines.filter((m) =>
      `${m.name} ${m.ownerName}`.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  async function act(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      await mutate("/api/machines");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
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
  return (
    <div className="flex-1 overflow-auto">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b px-6 py-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Máquinas compartidas
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Conecta Orca y abre las sesiones de tus worktrees desde Slak.
          </p>
        </div>
        {member && (
          <Button disabled={busy} onClick={() => void connectMachine()}>
            <Plus />
            Conectar mi Orca
          </Button>
        )}
      </header>
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div className="flex items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
            <Input
              aria-label="Buscar máquinas"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por máquina o persona…"
              className="pl-9"
            />
          </div>
          <Badge variant="outline">{machines.length} máquinas</Badge>
        </div>
        {error && (
          <p role="alert" className="text-destructive">
            No se pudieron cargar las máquinas.
          </p>
        )}
        {!data && !error && <Skeleton className="h-56" />}
        {data && !machines.length && (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
              <Server className="size-10 text-muted-foreground" />
              <h2 className="font-semibold">
                {query ? "No hay coincidencias" : "Tus sesiones de Orca, aquí"}
              </h2>
              <p className="max-w-md text-sm text-muted-foreground">
                Comparte los proyectos de tu máquina. Selecciona un worktree
                para ver sus pestañas, conversar e interrumpir el turno en
                curso.
              </p>
              {!query && member && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void connectMachine()}
                >
                  Conectar una máquina
                </Button>
              )}
            </CardContent>
          </Card>
        )}
        <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
          {machines.map((machine) => (
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
                  {machine.worktrees.length} worktrees
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
                <div className="w-full space-y-1">
                  {machine.worktrees.map((tree) => (
                    <Button
                      key={tree.worktree}
                      asChild
                      variant="ghost"
                      className="w-full justify-start"
                    >
                      <Link href={worktreeHref(machine.id, tree.worktree)}>
                        <GitBranch />
                        {tree.name}
                      </Link>
                    </Button>
                  ))}
                </div>
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
