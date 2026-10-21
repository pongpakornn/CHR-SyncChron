"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useToast } from "@/components/Toasts";
import { api, ApiError } from "@/lib/api";
import { useAuth, type Me } from "@/lib/auth";
import { startPage } from "@/lib/menu";

// 🔐 หน้า Login (LoginView.xaml) - เงื่อนไขเดิม: บัญชีที่ใช้งานอยู่เครื่องอื่นเข้าไม่ได้ / บัญชีที่ล็อกเข้าไม่ได้
export default function LoginPage() {
  const { me, loading, refresh } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && me) router.replace(startPage(me.can) ?? "/no-permission");
  }, [me, loading, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId.trim() || !password) {
      toast.show("Warning", "กรุณาระบุชื่อผู้ใช้และรหัสผ่าน", "warn");
      return;
    }
    setBusy(true);
    try {
      const m = await api<Me>("/auth/login", { method: "POST", body: { userId: userId.trim(), password } });
      toast.show("Success", `ยินดีต้อนรับคุณ ${m.userName}`, "ok");
      await refresh();
      router.replace(startPage(m.can) ?? "/no-permission");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.show(err instanceof ApiError && err.status === 409 ? "Login Denied" : "Error", msg, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-gradient-to-br from-primary-dark via-primary to-accent p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-3xl bg-surface p-8 shadow-2xl">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/CIMS.png" alt="" className="h-20 w-20 rounded-full bg-primary object-contain p-3" />
          <div className="text-2xl font-extrabold text-primary">CHR-Synchron</div>
          <div className="text-xs font-semibold text-ink-soft">CHR Inventory Management System</div>
        </div>
        <label className="mb-1 block text-xs font-bold uppercase text-ink-soft">User ID</label>
        <input className="field mb-4" autoFocus autoComplete="username" value={userId} onChange={(e) => setUserId(e.target.value)} />
        <label className="mb-1 block text-xs font-bold uppercase text-ink-soft">Password</label>
        <input className="field mb-6" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="btn w-full bg-accent py-3 text-base" disabled={busy}>
          {busy ? "⏳ กำลังเข้าสู่ระบบ..." : "LOGIN"}
        </button>
        <div className="mt-6 text-center text-[11px] text-ink-soft">© 2026 CIMS • Pongpakorn Urang</div>
      </form>
    </div>
  );
}
