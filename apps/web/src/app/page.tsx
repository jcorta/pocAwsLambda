"use client";
// `/` redirige a los recursos (SPEC §5.4)
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Spinner } from "../components/ui.tsx";

export default function Home() {
  const router = useRouter();
  useEffect(() => router.replace("/resources/"), [router]);
  return <Spinner />;
}
