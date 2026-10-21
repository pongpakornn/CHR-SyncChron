"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toasts";
import { api } from "@/lib/api";
import type { ScannerContext } from "./types";

// 🏬 SCAN STOCKS: 1 คลัง / หลายคลังสแกนร่วมกัน / AUTO (ALL STOCKS) + ★ คลังที่ตัดก่อนตอนสแกนออก
export function ScopeModal({ ctx, onClose, onSaved }: { ctx: ScannerContext; onClose: () => void; onSaved: (serialized: string) => void }) {
  const toast = useToast();
  const [auto, setAuto] = useState(ctx.scope.auto);
  const [ids, setIds] = useState<number[]>(ctx.scope.ids);
  const [prio, setPrio] = useState<number | null>(ctx.scope.priorityId);
  const [busy, setBusy] = useState(false);

  const toggle = (id: number) => setIds((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  const chosen = auto ? ctx.stocks.map((s) => s.stkId) : ids;

  async function save() {
    if (!auto && ids.length === 0) return toast.show("WARNING", "กรุณาเลือกคลังอย่างน้อย 1 คลัง", "warn");
    setBusy(true);
    try {
      const r = await api<{ serialized: string }>("/scanner/scope", {
        method: "POST",
        body: { auto, ids, priorityId: prio != null && chosen.includes(prio) && chosen.length > 1 ? prio : null },
      });
      onSaved(r.serialized);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="🏬 SCAN STOCKS"
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            CANCEL
          </button>
          <button className="btn bg-accent" onClick={save} disabled={busy}>
            SAVE
          </button>
        </>
      }
    >
      <label className="mb-3 flex cursor-pointer items-center gap-3 rounded-xl border-2 border-line p-3 font-bold">
        <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
        ⚡ AUTO ( ALL STOCKS ) — ระบบหาคลังของสินค้าที่สแกนเอง
      </label>
      <div className="grid gap-2">
        {ctx.stocks.map((s) => (
          <div key={s.stkId} className={`flex items-center gap-3 rounded-xl border p-3 ${chosen.includes(s.stkId) ? "border-accent bg-surface-2" : "border-line"}`}>
            <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" disabled={auto} checked={chosen.includes(s.stkId)} onChange={() => toggle(s.stkId)} />
            <div className="min-w-0 flex-1">
              <div className="font-extrabold text-primary">{s.code}</div>
              <div className="truncate text-xs text-ink-soft">
                {s.name} • {[s.canScanIn && "IN", s.canScanOut && "OUT"].filter(Boolean).join(" / ")}
                {s.isLiveView && " • LIVE (StorePC)"}
              </div>
            </div>
            {chosen.length > 1 && chosen.includes(s.stkId) && s.canScanOut && (
              <button
                type="button"
                onClick={() => setPrio(prio === s.stkId ? null : s.stkId)}
                className={`rounded-lg px-2 py-1 text-sm font-bold ${prio === s.stkId ? "bg-warning text-white" : "border border-line text-ink-soft"}`}
                title="★ OUT FIRST: สินค้าอยู่หลายคลัง สแกนออกตัดคลังนี้ก่อน"
              >
                ★ OUT FIRST
              </button>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
