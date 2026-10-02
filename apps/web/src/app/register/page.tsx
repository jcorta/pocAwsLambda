"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Card, Field } from "../../components/ui.tsx";
import { useAuth } from "../../lib/auth.tsx";
import { AuthError } from "../../lib/cognito.ts";
import { passwordProblems } from "../../lib/password.ts";

export default function RegisterPage() {
  const { cognito } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const problems = password ? passwordProblems(password) : [];
  const mismatch = confirm.length > 0 && confirm !== password;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (problems.length > 0 || mismatch) return;
    setBusy(true);
    setError(null);
    try {
      await cognito.signUp(email, password);
      router.push(`/confirm/?email=${encodeURIComponent(email)}`);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "No se pudo crear la cuenta.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto max-w-md">
      <h1 className="mb-4 text-xl font-semibold">Crear cuenta</h1>
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
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={problems.length > 0 ? `Le falta: ${problems.join(", ")}.` : undefined}
        />
        <Field
          id="confirm"
          label="Repetir contraseña"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={mismatch ? "Las contraseñas no coinciden." : undefined}
        />
        <p className="text-xs text-slate-500">
          La contraseña debe tener al menos 8 caracteres, con mayúsculas, minúsculas y números.
        </p>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" disabled={busy || problems.length > 0 || mismatch}>
          {busy ? "Creando…" : "Crear cuenta"}
        </Button>
      </form>
      <p className="mt-4 text-sm text-slate-600">
        ¿Ya tenés cuenta?{" "}
        <Link href="/login/" className="text-blue-700 underline">
          Iniciá sesión
        </Link>
      </p>
    </Card>
  );
}
