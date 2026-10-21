"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toasts";
import { useDialogs } from "@/components/ui/Dialogs";
import { Loading } from "@/components/ui/Page";
import { QrImage } from "@/components/ui/QrImage";
import { api } from "@/lib/api";
import type { Layout } from "./types";

type Opt = { key: string; label: string };
type Data = {
  stocks: { stkId: number; code: string; name: string; count: number }[];
  layouts: { stkId: number; code: string; layout: Layout }[];
  columns: Opt[];
  qrFields: Opt[];
  groups: string[];
  defaultOrder: string[];
  hasQrFields: boolean;
};
type Tab = "DELETE" | "COLUMNS" | "QR";

// 🛠 ADMIN ของ Inventory Registration (ProductControlAdminWindow - Level 1): STOCK DELETE / TABLE COLUMNS / QR CODE
export function AdminModal({ ticked, onClose }: { ticked: number[]; onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const dlg = useDialogs();
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<Tab>("DELETE");
  const [changed, setChanged] = useState(false);
  const [layouts, setLayouts] = useState<Record<number, Layout>>({});
  const [dirty, setDirty] = useState<number[]>([]);
  const [cur, setCur] = useState(0);
  const [chosen, setChosen] = useState<number[]>([]);
  const [all, setAll] = useState(ticked.length === 0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    api<Data>("/products/admin")
      .then((d) => {
        setData(d);
        setLayouts(Object.fromEntries(d.layouts.map((l) => [l.stkId, { ...l.layout, qrFields: l.layout.qrFields.includes("CODE") ? l.layout.qrFields : ["CODE", ...l.layout.qrFields] }])));
        setDirty([]);
      })
      .catch((e) => toast.show("ERROR", e.message, "error"));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = async () => {
    if (dirty.length > 0 && !(await dlg.confirm({ title: "UNSAVED CHANGES", message: "มีการตั้งค่าที่ยังไม่ได้กด SAVE\nต้องการปิดหน้าต่างโดยไม่บันทึกหรือไม่?" }))) return;
    onClose(changed);
  };

  const edit = (fn: (l: Layout) => Layout) => {
    setLayouts((m) => ({ ...m, [cur]: fn(m[cur]) }));
    setDirty((d) => (d.includes(cur) ? d : [...d, cur]));
  };

  async function saveLayouts(kind: "COLUMNS" | "QR") {
    const list = dirty.map((id) => {
      const l = layouts[id];
      return kind === "COLUMNS" ? { stkId: id, columns: l.columns, groupBy: l.groupBy } : { stkId: id, qrFields: l.qrFields, qrLabel: l.qrLabel };
    });
    if (kind === "COLUMNS") {
      const empty = dirty.find((id) => layouts[id].columns.length === 0);
      if (empty !== undefined) return toast.show("WARNING", `${data?.layouts.find((x) => x.stkId === empty)?.code}: กรุณาเลือกคอลัมน์อย่างน้อย 1 คอลัมน์`, "warn");
    }
    try {
      await api("/products/admin/layouts", { method: "POST", body: list });
      toast.show("SAVED", "บันทึกการตั้งค่าแล้ว", "ok");
      setChanged(true);
      load();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  async function doDelete() {
    if (!data) return;
    const stocks = data.stocks.filter((s) => chosen.includes(s.stkId));
    const what = all ? `สินค้าทั้งหมดในคลัง ${stocks.map((s) => s.code).join(", ")}` : `สินค้าที่ติ๊กไว้ ${ticked.length} รายการ (เฉพาะที่อยู่ในคลัง ${stocks.map((s) => s.code).join(", ")})`;
    const ok = await dlg.confirm({
      title: "CONFIRM DELETE",
      danger: true,
      ok: "DELETE",
      message: `ยืนยันการลบ${what}\n\nสินค้าจะถูกลบออกจากระบบทั้งหมด (ทุกคลัง ประวัติสแกน ค่า Max-Min และ Coil) แม้ยังมียอดคงเหลือ\nลบแล้วกู้คืนไม่ได้\n\nเหตุผล: ${reason.trim()}`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api<{ level: "ok" | "warn"; message: string }>("/products/admin/delete", { method: "POST", body: { stockIds: chosen, all, partIds: ticked, reason } });
      await dlg.alert({ title: "STOCK DELETE", message: r.message, tone: r.level });
      setChanged(true);
      setReason("");
      load();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const chip = (on: boolean, text: string, onClick: () => void, key?: string) => (
    <button key={key ?? text} type="button" onClick={onClick} className={`rounded-full border px-3 py-1.5 text-xs font-extrabold ${on ? "border-accent bg-accent text-white" : "border-line hover:border-accent"}`}>
      {text}
    </button>
  );

  const l = layouts[cur];
  const labelOf = (opts: Opt[], k: string) => opts.find((o) => o.key === k)?.label ?? k;

  const orderList = (list: string[], opts: Opt[], onChange: (v: string[]) => void, locked?: string) => (
    <div className="flex flex-wrap gap-2">
      {list.map((k, i) => (
        <span key={k} className="flex items-center gap-1 rounded-full bg-accent px-2 py-1 text-xs font-extrabold text-white">
          <button type="button" disabled={i === 0} onClick={() => onChange(list.map((x, j) => (j === i - 1 ? k : j === i ? list[i - 1] : x)))} className="px-1 disabled:opacity-30">
            ◀
          </button>
          {i + 1}. {labelOf(opts, k)}
          {k === locked ? (
            " 🔒"
          ) : (
            <button type="button" onClick={() => onChange(list.filter((x) => x !== k))} className="px-1">
              ×
            </button>
          )}
        </span>
      ))}
      {opts
        .filter((o) => !list.includes(o.key))
        .map((o) => (
          <button key={o.key} type="button" onClick={() => onChange([...list, o.key])} className="rounded-full border border-dashed border-line px-3 py-1 text-xs font-bold text-ink-soft hover:border-accent">
            ＋ {o.label}
          </button>
        ))}
    </div>
  );

  return (
    <Modal
      open
      wide
      title="🛠 ADMIN • INVENTORY REGISTRATION"
      onClose={close}
      footer={
        tab === "DELETE" ? (
          <button className="btn bg-danger" disabled={busy || chosen.length === 0 || !reason.trim() || (!all && ticked.length === 0)} onClick={doDelete}>
            🗑 DELETE
          </button>
        ) : (
          <>
            {tab === "COLUMNS" && l && (
              <button className="btn-ghost mr-auto" onClick={() => data && edit((x) => ({ ...x, columns: [...data.defaultOrder], groupBy: "CATEGORY" }))}>
                RESET
              </button>
            )}
            <button className="btn bg-accent" disabled={dirty.length === 0} onClick={() => saveLayouts(tab)}>
              SAVE {dirty.length > 0 ? `(${dirty.length})` : ""}
            </button>
          </>
        )
      }
    >
      {!data ? (
        <Loading />
      ) : (
        <div className="grid gap-4 md:grid-cols-[180px_1fr]">
          <nav className="flex gap-2 md:flex-col">
            {(
              [
                ["DELETE", "🗑 STOCK DELETE"],
                ["COLUMNS", "▦ TABLE COLUMNS"],
                ["QR", "▣ QR CODE"],
              ] as [Tab, string][]
            ).map(([t, txt]) => (
              <button key={t} onClick={() => setTab(t)} className={`rounded-xl px-3 py-2 text-left text-sm font-extrabold ${tab === t ? "bg-[#1c1c1e] text-white" : "hover:bg-surface-2"}`}>
                {txt}
              </button>
            ))}
          </nav>

          {tab === "DELETE" && (
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {data.stocks.map((s) => (
                  <button
                    key={s.stkId}
                    onClick={() => setChosen((c) => (c.includes(s.stkId) ? c.filter((x) => x !== s.stkId) : [...c, s.stkId]))}
                    className={`rounded-2xl border-2 p-3 text-left ${chosen.includes(s.stkId) ? "border-danger bg-[#ffebee]" : "border-line"}`}
                  >
                    <div className="font-extrabold text-primary">{s.code}</div>
                    <div className="text-xs text-ink-soft">{s.count.toLocaleString()} ITEMS</div>
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-sm font-bold">
                <input type="radio" checked={!all} disabled={ticked.length === 0} onChange={() => setAll(false)} /> DELETE THE TICKED PRODUCTS IN THE TABLE ({ticked.length} ticked)
              </label>
              <label className="flex items-center gap-2 text-sm font-bold">
                <input type="radio" checked={all} onChange={() => setAll(true)} /> DELETE ALL PRODUCTS IN THE SELECTED STOCKS
              </label>
              <textarea className="field" rows={2} placeholder="เหตุผล (REASON)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className="rounded-xl bg-surface-2 p-3 text-sm font-semibold">
                {chosen.length === 0
                  ? "Select at least 1 stock."
                  : all
                    ? `All products in ${data.stocks.filter((s) => chosen.includes(s.stkId)).map((s) => s.code).join(", ")} will be deleted from the system (up to ${data.stocks.filter((s) => chosen.includes(s.stkId)).reduce((a, s) => a + s.count, 0).toLocaleString()} product(s)).`
                    : `${ticked.length} ticked product(s) will be deleted if they are in ${data.stocks.filter((s) => chosen.includes(s.stkId)).map((s) => s.code).join(", ")}.`}
              </div>
            </div>
          )}

          {(tab === "COLUMNS" || tab === "QR") && (
            <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
              <div className="flex max-h-[55vh] flex-col gap-1 overflow-auto">
                {data.layouts.map((x) => (
                  <button key={x.stkId} onClick={() => setCur(x.stkId)} className={`rounded-xl px-3 py-2 text-left text-sm font-bold ${cur === x.stkId ? "bg-accent text-white" : "hover:bg-surface-2"}`}>
                    {x.code} {dirty.includes(x.stkId) && "•"}
                  </button>
                ))}
              </div>
              {l && tab === "COLUMNS" && (
                <div className="grid gap-4">
                  <div>
                    <div className="mb-2 text-xs font-extrabold uppercase text-primary">GROUP BY</div>
                    <div className="flex flex-wrap gap-2">{data.groups.map((g) => chip(l.groupBy === g, g, () => edit((x) => ({ ...x, groupBy: g }))))}</div>
                  </div>
                  <div>
                    <div className="mb-2 text-xs font-extrabold uppercase text-primary">COLUMNS (ลำดับตามที่เลือก)</div>
                    {orderList(l.columns, data.columns, (v) => edit((x) => ({ ...x, columns: v })))}
                  </div>
                </div>
              )}
              {l && tab === "QR" && (
                <div className="grid gap-4">
                  <div>
                    <div className="mb-2 text-xs font-extrabold uppercase text-primary">รูปแบบที่ 2 • ข้อมูลใน QR (หน้าสแกนอ่าน คั่นด้วย |)</div>
                    {orderList(l.qrFields, data.qrFields, (v) => edit((x) => ({ ...x, qrFields: v.includes("CODE") ? v : ["CODE", ...v] })), "CODE")}
                  </div>
                  <div>
                    <div className="mb-2 text-xs font-extrabold uppercase text-primary">รูปแบบที่ 1 • ข้อความใต้ QR (บรรทัดแรกตัวหนา)</div>
                    {orderList(l.qrLabel, data.qrFields, (v) => edit((x) => ({ ...x, qrLabel: v })))}
                  </div>
                  <div className="flex items-center gap-4 rounded-2xl bg-surface-2 p-4">
                    <QrImage text={l.qrFields.map((k) => (k === "CODE" ? "A250-00017" : k === "NAME" ? "SAMPLE NAME" : k)).join("|")} size={110} />
                    <div className="text-sm">
                      <div className="font-mono text-xs text-ink-soft">{l.qrFields.map((k) => labelOf(data.qrFields, k)).join(" | ")}</div>
                      {l.qrLabel.map((k, i) => (
                        <div key={k} className={i === 0 ? "font-extrabold" : ""}>
                          {labelOf(data.qrFields, k)}
                        </div>
                      ))}
                    </div>
                  </div>
                  {!data.hasQrFields && <div className="text-xs font-bold text-warning">ฐานข้อมูลยังไม่รองรับรูปแบบ QR แบบกำหนดเอง (Update_20261017b.sql)</div>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
