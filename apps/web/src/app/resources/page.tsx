"use client";
// Placeholder hasta el PR B de F5, donde llegan el listado de recursos y la disponibilidad.
import { RequireAuth } from "../../components/require-auth.tsx";
import { Card } from "../../components/ui.tsx";
import { useAuth } from "../../lib/auth.tsx";

export default function ResourcesPage() {
  return (
    <RequireAuth>
      <Welcome />
    </RequireAuth>
  );
}

function Welcome() {
  const { user } = useAuth();
  return (
    <Card>
      <h1 className="text-xl font-semibold">Recursos</h1>
      <p className="mt-2 text-slate-600">Hola, {user?.email}. El listado de recursos llega en el próximo PR.</p>
    </Card>
  );
}
