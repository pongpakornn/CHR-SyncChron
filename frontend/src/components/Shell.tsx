"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { MENU } from "@/lib/menu";

// 🧭 หน้าหลัก: Sidebar (กาง 260 / พับ 80 แบบเดิม) + แถบชื่อหน้า - จอเล็ก (มือถือ / แท็บเล็ต) = เมนูเลื่อนออกด้านซ้าย
export function Shell({ children }: { children: React.ReactNode }) {
  const { me, logout } = useAuth();
  const path = usePathname();
  const [open, setOpen] = useState(true);
  const [mobile, setMobile] = useState(false);
  const items = MENU.filter((m) => me?.can[m.can]);
  const current = MENU.find((m) => path === m.href || path.startsWith(m.href + "/"));

  // หน้าต่างแคบกว่า 1500 -> พับ Sidebar ให้เหลือแต่ไอคอนเอง (เหมือน SidebarAutoWidth ของ WPF)
  useEffect(() => {
    const fit = () => setOpen(window.innerWidth >= 1500);
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  useEffect(() => {
    setMobile(false);
    if (current && me) api("/log/page", { method: "POST", body: { title: current.title } }).catch(() => {});
  }, [path, current, me]);

  const nav = (compact: boolean) => (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
      {items.map((m) => {
        const active = current?.href === m.href;
        return (
          <Link
            key={m.href}
            href={m.href}
            title={m.label}
            className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition ${
              active ? "bg-accent text-white shadow-lg shadow-accent/30" : "text-white/70 hover:bg-white/10 hover:text-white"
            } ${compact ? "justify-center" : ""}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.icon} alt="" className="h-7 w-7 shrink-0 object-contain brightness-0 invert" />
            {!compact && <span className="truncate">{m.label}</span>}
            {!compact && !m.ready && <span className="ml-auto rounded bg-white/15 px-1.5 text-[10px] font-bold">SOON</span>}
          </Link>
        );
      })}
    </nav>
  );

  const brand = (compact: boolean) => (
    <div className={`flex items-center gap-3 px-5 py-5 ${compact ? "justify-center px-0" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/CIMS.png" alt="" className="h-10 w-10 object-contain" />
      {!compact && (
        <div className="leading-tight">
          <div className="text-lg font-extrabold text-white">CHR-Synchron</div>
          <div className="text-[10px] font-semibold text-white/60">CHR Inventory Management System</div>
        </div>
      )}
    </div>
  );

  const footer = (compact: boolean) => (
    <div className="px-3 pb-4 pt-2 text-center text-[10px] text-white/45">{compact ? "P.U." : "© 2026 CIMS • Pongpakorn Urang"}</div>
  );

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Sidebar จอใหญ่ */}
      <aside
        className="hidden shrink-0 flex-col bg-sidebar shadow-xl backdrop-blur transition-[width] duration-300 md:flex"
        style={{ width: open ? 260 : 80 }}
      >
        {brand(!open)}
        {nav(!open)}
        {footer(!open)}
      </aside>

      {/* Sidebar มือถือ */}
      {mobile && (
        <div className="fixed inset-0 z-50 flex md:hidden" onClick={() => setMobile(false)}>
          <aside className="flex w-[260px] flex-col bg-sidebar backdrop-blur" onClick={(e) => e.stopPropagation()}>
            {brand(false)}
            {nav(false)}
            {footer(false)}
          </aside>
          <div className="flex-1 bg-black/40" />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line bg-surface/90 px-3 text-ink backdrop-blur md:px-5">
          <button
            onClick={() => (window.innerWidth < 768 ? setMobile(true) : setOpen((o) => !o))}
            className="rounded-lg px-2 py-1 text-2xl text-primary hover:bg-surface-2"
            aria-label="Menu"
          >
            ☰
          </button>
          <h1 className="truncate text-base font-extrabold uppercase tracking-wide text-primary md:text-lg">{current?.title ?? "CHR-SYNCHRON"}</h1>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <div className="text-sm font-bold">{me?.userName || me?.userId}</div>
              <div className="text-[11px] text-ink-soft">
                {me?.userId} • LEVEL {me?.userLevel}
                {me?.department ? ` • ${me.department}` : ""}
              </div>
            </div>
            <button onClick={logout} className="rounded-lg bg-[#1c1c1e] px-3 py-1.5 text-sm font-bold text-white hover:bg-danger" title="Logout">
              ⏻ <span className="hidden sm:inline">LOGOUT</span>
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
