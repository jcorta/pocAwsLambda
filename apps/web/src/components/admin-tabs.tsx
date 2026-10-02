"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin/resources/", label: "Recursos" },
  { href: "/admin/bookings/", label: "Reservas" },
  { href: "/admin/settings/", label: "Configuración" },
];

export function AdminTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Administración" className="mb-6 flex gap-2 border-b border-slate-200 pb-2">
      {TABS.map((t) => {
        const active = pathname.startsWith(t.href.replace(/\/$/, ""));
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`rounded px-3 py-1 text-sm ${active ? "bg-slate-800 text-white" : "text-slate-700 hover:bg-slate-100"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
