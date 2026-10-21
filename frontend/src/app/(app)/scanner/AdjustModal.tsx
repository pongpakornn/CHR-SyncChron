"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toasts";
import { DateRange } from "@/components/ui/DateRange";
import { useDialogs } from "@/components/ui/Dialogs";
import { Badge, Empty, Loading, SearchBox } from "@/components/ui/Page";
import { api } from "@/lib/api";
import { daysAgo, qty, today } from "@/lib/format";
import { useDebounced } from "@/lib/useDebounced";

type Row = {
  txId: number;
  date: string;
  stockCode: string;
  txType: string;
  partCode: string;
  partName: string;
  qty: number;
  allowDecimal: boolean;
  user: string;
  isCancel: boolean;
  canSelect: boolean;
  status: string;
  note: string;
  pr: string;
};

// ✏️ ADJUST SCAN (DEL ของ Multi-Scanner): แก้จำนวน / ลบ (ยกเลิก) รายการสแกน - ยอดคลังปรับย้อนให้ ทุกครั้งต้องกรอกหมายเหตุ
export function AdjustModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const dlg = useDialogs();
  const [key, setKey] = useState("");
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(today());
  const [stkId, setStkId] = useState("");
  const [type, setType] = useState("");
  const [data, setData] = useState<{ stocks: { stkId: number; code: string }[]; rows: Row[] } | null>(null);
  const [sel, setSel] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const k = useDebounced(key, 300);

  const load = useCallback(async () => {
    try {
      const r = await api<{ stocks: { stkId: number; code: string }[]; rows: Row[] }>("/scanner/adjust", {
        query: { key: k, from, to, stkId: stkId || undefined, type: type || undefined },
      });
      setData(r);
      setSel((s) => s.filter((id) => r.rows.some((x) => x.txId === id && x.canSelect)));
    } catch (e) {
      toast.show("ERROR", "โหลดรายการสแกนไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }, [k, from, to, stkId, type, toast]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const rows = data?.rows ?? [];
  const selectable = rows.filter((r) => r.canSelect);
  const picked = rows.filter((r) => sel.includes(r.txId));

  const askReason = (what: string, title: string) =>
    dlg.prompt({
      title,
      danger: true,
      multiline: true,
      message: what + "\n\nกรุณาระบุหมายเหตุ / สาเหตุที่แก้ไข Stock",
      required: "กรุณาระบุหมายเหตุ / สาเหตุที่แก้ไข Stock ก่อนยืนยัน",
    });

  async function editQty() {
    if (picked.length !== 1) return toast.show("WARNING", "กรุณาติ๊กเลือก 1 รายการที่ต้องการแก้ไขจำนวน", "warn");
    const r = picked[0];
    const v = await dlg.prompt({
      title: "EDIT SCAN QTY",
      numeric: true,
      initial: String(r.qty),
      message: `${r.txType}  •  ${r.stockCode}\n${r.partCode}  ${r.partName}\n\nจำนวนเดิม ${qty(r.qty)}  กรอกจำนวนที่ถูกต้อง`,
      required: "กรุณากรอกจำนวน",
    });
    if (v === null) return;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return toast.show("WARNING", "จำนวนไม่ถูกต้อง", "warn");
    if (!r.allowDecimal && !Number.isInteger(n)) return toast.show("WARNING", "คลังนี้กรอกได้เฉพาะจำนวนเต็ม", "warn");
    if (n === r.qty) return toast.show("WARNING", "จำนวนใหม่เท่ากับจำนวนเดิม", "warn");
    const reason = await askReason(`แก้จำนวน ${r.partCode} (${r.txType} ${r.stockCode})\nจาก ${qty(r.qty)} เป็น ${qty(n)}`, "EDIT SCAN QTY");
    if (reason === null) return;
    setBusy(true);
    try {
      const res = await api<{ message: string; warn: boolean }>(`/scanner/adjust/${r.txId}/qty`, { method: "POST", body: { qty: n, reason } });
      await dlg.alert({ title: "EDIT SCAN QTY", message: res.message, tone: res.warn ? "warn" : "ok" });
      onChanged();
      await load();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (picked.length === 0) return toast.show("WARNING", "กรุณาติ๊กเลือกรายการที่ต้องการลบ", "warn");
    const list =
      picked
        .slice(0, 8)
        .map((r) => `• ${r.txType} ${r.stockCode}  ${r.partCode}  x${qty(r.qty)}`)
        .join("\n") + (picked.length > 8 ? `\n... และอีก ${picked.length - 8} รายการ` : "");
    const reason = await askReason(`ลบรายการสแกน ${picked.length} รายการ ยอด Stock จะถูกปรับย้อนกลับ\n\n${list}`, "DELETE SCAN");
    if (reason === null) return;
    setBusy(true);
    try {
      const res = await api<{ message: string; level: "ok" | "warn" | "error" }>("/scanner/adjust/cancel", { method: "POST", body: { txIds: picked.map((r) => r.txId), reason } });
      await dlg.alert({ title: "DELETE SCAN", message: res.message, tone: res.level });
      setSel([]);
      onChanged();
      await load();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      wide
      title="✏️ ADJUST SCAN"
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto self-center text-xs font-bold text-ink-soft">
            {rows.length.toLocaleString()} SCAN(S){rows.length >= 500 ? " (showing the latest 500 - narrow the filter)" : ""} • {sel.length} SELECTED
          </span>
          <button className="btn bg-info" disabled={busy || sel.length !== 1} onClick={editQty}>
            ✏️ EDIT QTY
          </button>
          <button className="btn bg-danger" disabled={busy || sel.length === 0} onClick={remove}>
            🗑 DELETE
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm font-semibold text-ink-soft">แก้จำนวน / ลบรายการสแกน — ยอดคลังปรับย้อนให้อัตโนมัติ รายการที่ลบยังเก็บไว้ (CANCELLED) พร้อมหมายเหตุ</p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchBox className="min-w-[220px] flex-1" value={key} onChange={setKey} placeholder="ค้นหา รหัส / ชื่อ / ผู้ใช้" />
        <select className="field w-auto" value={stkId} onChange={(e) => setStkId(e.target.value)}>
          <option value="">ALL STOCKS</option>
          {data?.stocks.map((s) => (
            <option key={s.stkId} value={s.stkId}>
              {s.code}
            </option>
          ))}
        </select>
        <select className="field w-auto" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">ALL TYPES</option>
          <option>IN</option>
          <option>OUT</option>
          <option>RETURN</option>
        </select>
        <DateRange from={from} to={to} onChange={(f, t) => (setFrom(f), setTo(t))} quick={false} />
      </div>
      {!data ? (
        <Loading />
      ) : (
        <div className="overflow-auto rounded-xl border border-line">
          <table className="data-table w-full">
            <thead className="sticky top-0">
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={selectable.length > 0 && selectable.every((r) => sel.includes(r.txId))}
                    onChange={(e) => setSel(e.target.checked ? selectable.map((r) => r.txId) : [])}
                  />
                </th>
                <th>DATE TIME</th>
                <th>STOCK</th>
                <th>TYPE</th>
                <th>PRODUCT</th>
                <th className="text-right">QTY</th>
                <th>USER</th>
                <th>STATUS</th>
                <th>NOTE</th>
                <th>PR</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.txId} className={r.isCancel ? "text-ink-soft line-through" : ""}>
                  <td>
                    <input
                      type="checkbox"
                      disabled={!r.canSelect}
                      checked={sel.includes(r.txId)}
                      onChange={(e) => setSel((s) => (e.target.checked ? [...s, r.txId] : s.filter((x) => x !== r.txId)))}
                    />
                  </td>
                  <td className="whitespace-nowrap text-xs">{r.date}</td>
                  <td>{r.stockCode}</td>
                  <td>{r.txType}</td>
                  <td>
                    <div>{r.partCode}</div>
                    <div className="text-[11px] font-medium text-ink-soft">{r.partName}</div>
                  </td>
                  <td className="text-right">{qty(r.qty)}</td>
                  <td className="whitespace-nowrap">{r.user}</td>
                  <td>{r.status && <Badge color={r.isCancel ? "var(--danger)" : "var(--warning)"}>{r.status}</Badge>}</td>
                  <td className="max-w-[240px] text-xs">{r.note}</td>
                  <td className="whitespace-nowrap text-xs">{r.pr}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <Empty />}
        </div>
      )}
    </Modal>
  );
}
