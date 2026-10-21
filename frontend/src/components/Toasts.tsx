"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

// 🔔 แจ้งเตือนมุมจอ + เสียง (แทน NotificationManager + SystemSounds ของ WPF) - ไม่เด้ง Popup ค้าง สแกนต่อได้เลย
type Toast = { id: number; title: string; message: string; kind: "ok" | "error" | "warn" | "info" };
type Ctx = { show: (title: string, message: string, kind?: Toast["kind"]) => void };

const ToastCtx = createContext<Ctx | null>(null);

function beep(kind: Toast["kind"]) {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const tones = kind === "error" ? [220, 180] : kind === "warn" ? [520, 420] : [880];
    tones.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = kind === "error" ? "square" : "sine";
      o.frequency.value = f;
      g.gain.value = 0.08;
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.16);
      o.stop(ctx.currentTime + i * 0.16 + 0.14);
    });
    setTimeout(() => ctx.close(), 800);
  } catch {
    /* ไม่มีเสียงก็ไม่เป็นไร */
  }
}

const STYLE: Record<Toast["kind"], string> = {
  ok: "border-success bg-[#e8f5e9]",
  error: "border-danger bg-[#ffebee]",
  warn: "border-warning bg-[#fff3e0]",
  info: "border-info bg-[#e3f2fd]",
};
const ICON: Record<Toast["kind"], string> = { ok: "✔", error: "✖", warn: "⚠", info: "ℹ" };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const seq = useRef(0);

  const show = useCallback((title: string, message: string, kind: Toast["kind"] = "info") => {
    const id = ++seq.current;
    if (kind !== "info") beep(kind);
    setList((l) => [{ id, title, message, kind }, ...l].slice(0, 4));
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), kind === "error" || kind === "warn" ? 9000 : 4500);
  }, []);

  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-4 sm:w-[420px]">
        {list.map((t) => (
          <div
            key={t.id}
            role="status"
            onClick={() => setList((l) => l.filter((x) => x.id !== t.id))}
            className={`pointer-events-auto w-full cursor-pointer rounded-xl border-l-8 p-4 shadow-lg ${STYLE[t.kind]}`}
          >
            <div className="text-sm font-extrabold uppercase">
              {ICON[t.kind]} {t.title}
            </div>
            <div className="mt-1 whitespace-pre-line text-sm font-semibold text-ink">{t.message}</div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const c = useContext(ToastCtx);
  if (!c) throw new Error("useToast must be inside ToastProvider");
  return c;
}
