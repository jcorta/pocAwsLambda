"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "../lib/auth.tsx";

const linkClass = (active: boolean) =>
  `rounded px-3 py-2 text-sm ${active ? "bg-slate-800 text-white" : "text-slate-200 hover:bg-slate-700"}`;

export function Nav() {
  const { status, user, isAdmin, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const active = (prefix: string) => pathname.startsWith(prefix);

  return (
    <header className="bg-slate-900">
      <nav aria-label="Principal" className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3">
        <Link href="/resources/" className="mr-4 font-semibold text-white">
          Reservas
        </Link>
        {status === "authenticated" && (
          <>
            <Link href="/resources/" className={linkClass(active("/resources"))}>
              Recursos
            </Link>
            <Link href="/bookings/" className={linkClass(active("/bookings"))}>
              Mis reservas
            </Link>
            {/* Solo UI: la autorización real está en la API (SPEC §5.3) */}
            {isAdmin && (
              <Link href="/admin/resources/" className={linkClass(active("/admin"))}>
                Administración
              </Link>
            )}
            <span className="ml-auto text-sm text-slate-300">{user?.email}</span>
            <button
              type="button"
              onClick={async () => {
                await logout();
                router.replace("/login/");
              }}
              className="rounded px-3 py-2 text-sm text-slate-200 hover:bg-slate-700"
            >
              Salir
            </button>
          </>
        )}
      </nav>
    </header>
  );
}
