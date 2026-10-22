"use client";
import { useState } from "react";
import { Menu } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import type { SessionUser } from "@/lib/session";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
export default function AppShell({
  currentUser,
  children,
}: {
  currentUser: SessionUser;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex h-dvh flex-col bg-background md:flex-row">
      <header className="flex items-center gap-3 border-b px-3 py-2 md:hidden">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Abrir menú"
          onClick={() => setOpen(true)}
        >
          <Menu />
        </Button>
        <span className="font-semibold">Slak</span>
      </header>
      <div className="hidden md:block">
        <Sidebar currentUser={currentUser} />
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          className="w-72 gap-0 p-0"
          showCloseButton={false}
        >
          <SheetTitle className="sr-only">Navegación</SheetTitle>
          <SheetDescription className="sr-only">
            Canales, personas, agentes y máquinas
          </SheetDescription>
          <Sidebar
            currentUser={currentUser}
            onNavigate={() => setOpen(false)}
          />
        </SheetContent>
      </Sheet>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
