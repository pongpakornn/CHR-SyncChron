"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { startPage } from "@/lib/menu";

// เปิดเว็บ -> ยังไม่ Login = หน้า Login / Login แล้ว = หน้าแรกตามสิทธิ์ (ลำดับเดียวกับ MainView)
export default function Home() {
  const { me, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    router.replace(me ? startPage(me.can) ?? "/no-permission" : "/login");
  }, [me, loading, router]);
  return <div className="grid h-dvh place-items-center text-ink-soft">⏳ LOADING...</div>;
}
