"use client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function RegisterForm() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, token }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "No se pudo crear la cuenta.");
      setLoading(false);
      return;
    }
    await signIn("credentials", { email, password, redirect: false });
    router.push("/");
    router.refresh();
  }

  return (
    <main className="flex min-h-full items-center justify-center bg-muted/50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-background p-8 shadow-sm">
        <h1 className="mb-1 text-2xl font-bold text-foreground">
          Crear cuenta
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {token
            ? "Has recibido una invitación. Completa tus datos para unirte."
            : "Si la empresa aún no tiene cuentas, esta será la cuenta de administrador. Si no, necesitas un enlace de invitación."}
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label
              htmlFor="name"
              className="mb-1 block text-sm font-medium text-foreground"
            >
              Nombre
            </Label>
            <Input
              id="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-input px-3 py-2 text-base outline-none sm:text-sm focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
          </div>
          <div>
            <Label
              htmlFor="email"
              className="mb-1 block text-sm font-medium text-foreground"
            >
              Email
            </Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-input px-3 py-2 text-base outline-none sm:text-sm focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
          </div>
          <div>
            <Label
              htmlFor="password"
              className="mb-1 block text-sm font-medium text-foreground"
            >
              Contraseña{" "}
              <span className="text-muted-foreground">
                (mínimo 8 caracteres)
              </span>
            </Label>
            <Input
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-input px-3 py-2 text-base outline-none sm:text-sm focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-primary py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? "Creando…" : "Crear cuenta"}
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          ¿Ya tienes cuenta?{" "}
          <Link
            href="/login"
            className="font-medium text-primary hover:underline"
          >
            Inicia sesión
          </Link>
        </p>
      </div>
    </main>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
