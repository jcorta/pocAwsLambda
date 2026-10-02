"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { Alert, Button, Card, Field, Spinner } from "../../components/ui.tsx";
import { useAuth } from "../../lib/auth.tsx";
import { AuthError } from "../../lib/cognito.ts";
import { errorMessage } from "../../lib/errors.ts";
import { safeNext } from "../../lib/session.ts";

function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      router.replace(next);
    } catch (err) {
      if (err instanceof AuthError && err.reason === "NOT_CONFIRMED") {
        router.push(`/confirm/?email=${encodeURIComponent(email)}`);
        return;
      }
      setError(err instanceof AuthError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto max-w-md">
      <h1 className="mb-4 text-xl font-semibold">Iniciar sesión</h1>
      {params.get("next") && (
        <div className="mb-4">
          <Alert kind="info">Iniciá sesión para continuar.</Alert>
        </div>
      )}
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          id="password"
          label="Contraseña"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <Alert>{error}</Alert>}
        <Button type="submit" disabled={busy}>
          {busy ? "Ingresando…" : "Ingresar"}
        </Button>
      </form>
      <p className="mt-4 text-sm text-slate-600">
        ¿No tenés cuenta?{" "}
        <Link href="/register/" className="text-blue-700 underline">
          Registrate
        </Link>
      </p>
    </Card>
  );
}

export default function LoginPage() {
  // useSearchParams en un sitio estático necesita un límite de Suspense
  return (
    <Suspense fallback={<Spinner />}>
      <LoginForm />
    </Suspense>
  );
}
