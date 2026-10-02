"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { Alert, Button, Card, Field, Spinner } from "../../components/ui.tsx";
import { useAuth } from "../../lib/auth.tsx";
import { AuthError } from "../../lib/cognito.ts";

function ConfirmForm() {
  const { cognito } = useAuth();
  const router = useRouter();
  const email = useSearchParams().get("email") ?? "";
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await cognito.confirmSignUp(email, code.trim());
      router.replace(`/login/?email=${encodeURIComponent(email)}`);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "No se pudo confirmar la cuenta.");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    try {
      await cognito.resendCode(email);
      setNotice("Te enviamos un código nuevo.");
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "No se pudo reenviar el código.");
    }
  }

  return (
    <Card className="mx-auto max-w-md">
      <h1 className="mb-2 text-xl font-semibold">Confirmá tu email</h1>
      <p className="mb-4 text-sm text-slate-600">
        Te enviamos un código de verificación a <strong>{email || "tu email"}</strong>.
      </p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field
          id="code"
          label="Código"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        {error && <Alert>{error}</Alert>}
        {notice && <Alert kind="success">{notice}</Alert>}
        <Button type="submit" disabled={busy || !email}>
          {busy ? "Confirmando…" : "Confirmar"}
        </Button>
        <Button type="button" variant="secondary" onClick={resend} disabled={!email}>
          Reenviar código
        </Button>
      </form>
    </Card>
  );
}

export default function ConfirmPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <ConfirmForm />
    </Suspense>
  );
}
