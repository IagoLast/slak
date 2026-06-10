"use client";

import { useState } from "react";
import Sidebar from "@/components/Sidebar";
import { SessionUser } from "@/lib/session";

export default function AppShell({
  currentUser,
  children,
}: {
  currentUser: SessionUser;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex h-dvh flex-col md:flex-row">
      {/* Barra superior solo en móvil */}
      <header className="flex shrink-0 items-center gap-3 bg-violet-950 px-4 py-3 md:hidden">
        <button
          onClick={() => setOpen(true)}
          aria-label="Abrir menú"
          className="rounded p-1 text-xl leading-none text-violet-200 hover:bg-violet-900"
        >
          ☰
        </button>
        <span className="text-lg font-bold text-white">Slak</span>
      </header>

      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <div
        className={`fixed inset-y-0 left-0 z-40 transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar currentUser={currentUser} onNavigate={() => setOpen(false)} />
      </div>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
