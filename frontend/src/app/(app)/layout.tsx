"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Shell } from "@/components/Shell";
import { useAuth } from "@/lib/auth";

// หน้าระบบทั้งหมด: ต้อง Login ก่อน (API ตรวจสิทธิ์ซ้ำทุก Request)
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { me, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !me) router.replace("/login");
  }, [me, loading, router]);
  if (!me) return <div className="grid h-dvh place-items-center text-ink-soft">⏳ LOADING...</div>;
  return <Shell>{children}</Shell>;
}
