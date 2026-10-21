"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toasts";
import { api } from "@/lib/api";

type DisplayStock = { stkId: number; code: string; value: string; options: { key: string; label: string }[] };

// 🏷️ DISPLAY: ค่าที่แสดงแทนรหัสในหน้า Multi-Scanner ต่อคลัง (ของผู้ใช้คนนี้) - แสดงผลอย่างเดียว ไม่มีผลกับการบันทึก
export function DisplayModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [stocks, setStocks] = useState<DisplayStock[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ stocks: DisplayStock[] }>("/scanner/display")
      .then((r) => setStocks(r.stocks))
      .catch((e) => toast.show("ERROR", e.message, "error"));
  }, [toast]);

  async function save() {
    if (!stocks) return;
    setBusy(true);
    try {
      await api("/scanner/display", { method: "POST", body: Object.fromEntries(stocks.map((s) => [s.stkId, s.value])) });
      toast.show("DISPLAY", "บันทึกการแสดงผลแล้ว", "ok");
      onSaved();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="🏷️ DISPLAY"
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            CANCEL
          </button>
          <button className="btn bg-accent" onClick={save} disabled={busy || !stocks}>
            SAVE
          </button>
        </>
      }
    >
      {!stocks ? (
        <div className="text-center text-ink-soft">⏳ LOADING...</div>
      ) : (
        <div className="grid gap-3">
          {stocks.map((s, i) => (
            <div key={s.stkId}>
              <label className="mb-1 block text-xs font-extrabold uppercase text-primary">{s.code}</label>
              <select
                className="field"
                value={s.value}
                onChange={(e) => setStocks((l) => l!.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
              >
                {!s.options.some((o) => o.key === s.value) && <option value={s.value}>{s.value}</option>}
                {s.options.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
