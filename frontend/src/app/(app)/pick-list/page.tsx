"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toasts";
import { DateRange } from "@/components/ui/DateRange";
import { Badge, Card, Empty, Loading, PageBody, PageHeader, SearchBox } from "@/components/ui/Page";
import { QrImage } from "@/components/ui/QrImage";
import { api, download } from "@/lib/api";
import { today } from "@/lib/format";
import { useDebounced } from "@/lib/useDebounced";

type PickCard = {
  ticketNo: string;
  itemNo: string;
  groupCode: string;
  materialCode: string;
  workOrder: string;
  lotNo: string;
  jobName: string;
  qty: number;
  ticketDate: string | null;
  productName: string;
  unit: string;
  fgName: string;
  printedBy: string | null;
  printedDate: string | null;
  printCount: number;
  lastPrintedBy: string | null;
  lastPrintedDate: string | null;
};
type Layout = "LABEL" | "A4";

const qtyNum = (q: number) => Number(q.toFixed(2)).toString();
const keyOf = (c: PickCard) => `${c.ticketNo}|${c.itemNo}`;
// QR เดียวกับ PackingCardModel.QrText: TicketNo | MaterialCode | WorkOrder | LotNo | JobName | Qty (หน้าสแกนอ่านได้)
const qrText = (c: PickCard) => `${c.ticketNo} | ${c.materialCode} | ${c.workOrder ?? ""} | ${c.lotNo ?? ""} | ${c.jobName ?? ""} | ${qtyNum(c.qty)}`;
const d = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-GB").replace(/\//g, "-") : "");
const stamp = (s: string) => new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

// 📦 PICK LIST (PackingCardView): การ์ดเบิกของ + QR / พิมพ์ (ฉลาก 62x40 mm หรือ A4) / Export Excel
export default function PickListPage() {
  const toast = useToast();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [key, setKey] = useState("");
  const [rows, setRows] = useState<PickCard[] | null>(null);
  const [source, setSource] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const [preview, setPreview] = useState<PickCard | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [layout, setLayout] = useState<Layout>("A4");
  const [printing, setPrinting] = useState<PickCard[] | null>(null);
  const k = useDebounced(key, 250);

  const load = useCallback(async () => {
    try {
      const r = await api<{ source: string; rows: PickCard[] }>("/picklist", { query: { from, to } });
      setRows(r.rows);
      setSource(r.source);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }, [from, to, toast]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    const live = setInterval(() => !document.hidden && load(), 5000);
    return () => (clearTimeout(t), clearInterval(live));
  }, [load]);

  const shown = useMemo(() => {
    const q = k.trim().toLowerCase();
    const list = rows ?? [];
    return q ? list.filter((c) => [c.ticketNo, c.materialCode, c.productName, c.workOrder, c.lotNo, c.jobName, c.groupCode].some((v) => (v ?? "").toLowerCase().includes(q))) : list;
  }, [rows, k]);
  const picked = shown.filter((c) => sel.includes(keyOf(c)));

  async function print() {
    setPrintOpen(false);
    const items = picked;
    setPrinting(items);
    // รอวาด QR ก่อนสั่งพิมพ์
    setTimeout(async () => {
      window.print();
      setPrinting(null);
      try {
        const r = await api<{ saved: number; fails: string[] }>("/picklist/printed", { method: "POST", body: items });
        if (r.fails.length) toast.show("WARNING", `พิมพ์แล้ว แต่บันทึกประวัติไม่สำเร็จ ${r.fails.length} รายการ\n${r.fails.slice(0, 3).join("\n")}`, "warn");
        else toast.show("PRINT", `บันทึกการพิมพ์ ${r.saved} ใบแล้ว`, "ok");
        setSel([]);
        load();
      } catch (e) {
        toast.show("ERROR", (e as Error).message, "error");
      }
    }, 600);
  }

  return (
    <PageBody>
      <PageHeader
        icon="/icons/PickList.png"
        title="PICK LIST"
        subtitle={`${shown.length.toLocaleString()} ITEM(S) • SOURCE: ${source || "-"}`}
        actions={
          <>
            <button className="btn bg-success" disabled={picked.length === 0} onClick={() => download("/picklist/export", undefined, picked).catch((e) => toast.show("ERROR", e.message, "error"))}>
              📤 EXPORT EXCEL
            </button>
            <button className="btn bg-accent" disabled={picked.length === 0} onClick={() => setPrintOpen(true)}>
              🖨 PRINT ({picked.length})
            </button>
          </>
        }
      />
      {source === "CHR-Synchron" && (
        <div className="rounded-xl border border-warning/40 bg-[#fff3e0] p-3 text-sm font-semibold text-warning">
          🔒 CHR-Synchron ไม่เชื่อม ERP ของระบบที่ใช้งานจริง (192.168.10.10) — รายการด้านล่างมาจากประวัติการพิมพ์ใน CHR-Synchron (ดู / พิมพ์ซ้ำ / Export ได้)
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-line/60 p-3">
            <SearchBox className="min-w-[220px] flex-1" value={key} onChange={setKey} placeholder="ค้นหา BILL / PD CODE / WORK ORDER / LOT" />
            <DateRange from={from} to={to} onChange={(f, t) => (setFrom(f), setTo(t))} quick={false} />
            <button className="btn-ghost" onClick={() => (setFrom(today()), setTo(today()))}>
              TODAY
            </button>
          </div>
          <div className="max-h-[calc(100dvh-300px)] min-h-[360px] overflow-auto">
            {!rows ? (
              <Loading />
            ) : shown.length === 0 ? (
              <Empty>ไม่มีรายการในช่วงวันที่นี้</Empty>
            ) : (
              <table className="data-table w-full">
                <thead className="sticky top-0">
                  <tr>
                    <th>
                      <input type="checkbox" checked={shown.length > 0 && shown.every((c) => sel.includes(keyOf(c)))} onChange={(e) => setSel(e.target.checked ? shown.map(keyOf) : [])} />
                    </th>
                    <th>BILL NO.</th>
                    <th>GROUP</th>
                    <th>PD CODE</th>
                    <th>PRODUCT NAME</th>
                    <th className="text-right">QTY</th>
                    <th>WORKORDER</th>
                    <th>LOT</th>
                    <th>PRINTED</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => (
                    <tr key={keyOf(c)} onClick={() => setPreview(c)} className={`cursor-pointer ${preview && keyOf(preview) === keyOf(c) ? "bg-accent-soft/40" : ""}`}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={sel.includes(keyOf(c))} onChange={(e) => (setSel((s) => (e.target.checked ? [...s, keyOf(c)] : s.filter((x) => x !== keyOf(c)))), setPreview(c))} />
                      </td>
                      <td className="whitespace-nowrap font-extrabold text-primary">{c.ticketNo}</td>
                      <td>{c.groupCode}</td>
                      <td className="whitespace-nowrap">{c.materialCode}</td>
                      <td className="min-w-[180px]">{c.productName}</td>
                      <td className="whitespace-nowrap text-right">
                        {qtyNum(c.qty)} {c.unit}
                      </td>
                      <td className="whitespace-nowrap">{c.workOrder}</td>
                      <td>{c.lotNo}</td>
                      <td className="min-w-[150px] text-xs">
                        {c.printedDate ? (
                          <>
                            <Badge color="var(--success)">PRINTED</Badge> {stamp(c.printedDate)} {c.printedBy}
                            {c.printCount > 1 && c.lastPrintedDate && (
                              <div className="text-ink-soft">
                                ×{c.printCount} • {stamp(c.lastPrintedDate)} {c.lastPrintedBy}
                              </div>
                            )}
                          </>
                        ) : (
                          <Badge color="var(--warning)">NOT YET</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
        <Card title="PREVIEW" bodyClass="p-4" className="self-start xl:sticky xl:top-4">
          {preview ? <PickCardView c={preview} /> : <Empty>คลิกแถวในตารางเพื่อดูการ์ด</Empty>}
        </Card>
      </div>

      <Modal
        open={printOpen}
        title="🖨 SELECT LAYOUT"
        onClose={() => setPrintOpen(false)}
        footer={
          <>
            <button className="btn-ghost" onClick={() => setPrintOpen(false)}>
              CANCEL
            </button>
            <button className="btn bg-accent" onClick={print}>
              PRINT {picked.length} CARD(S)
            </button>
          </>
        }
      >
        <div className="grid gap-2">
          {(
            [
              ["A4", "A4 • 8 CARDS / SHEET", "เครื่องพิมพ์ทั่วไป (Fuji ApeosPort ฯลฯ)"],
              ["LABEL", "LABEL 62 × 40 mm", "เครื่องพิมพ์ฉลาก Brother QL-800 (ตั้งกระดาษ 62mm ใน Driver)"],
            ] as [Layout, string, string][]
          ).map(([v, t, h]) => (
            <label key={v} className={`flex cursor-pointer gap-3 rounded-xl border-2 p-3 ${layout === v ? "border-accent" : "border-line"}`}>
              <input type="radio" checked={layout === v} onChange={() => setLayout(v)} />
              <div>
                <div className="font-extrabold text-primary">{t}</div>
                <div className="text-xs text-ink-soft">{h}</div>
              </div>
            </label>
          ))}
        </div>
      </Modal>

      {printing &&
        createPortal(
          <div id="print-area" className={layout === "A4" ? "print-a4" : "print-label"}>
            {printing.map((c) => (
              <div key={keyOf(c)} className="print-card">
                <PickCardView c={c} />
              </div>
            ))}
            <style>{`
              #print-area { position: fixed; left: -10000px; top: 0; }
              @media print {
                body * { visibility: hidden !important; }
                #print-area, #print-area * { visibility: visible !important; }
                #print-area { position: absolute; left: 0; top: 0; width: 100%; }
                .print-a4 { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
                .print-a4 .print-card { break-inside: avoid; border: 0.3mm solid #999; padding: 2mm; }
                @page { size: ${layout === "A4" ? "A4" : "62mm 40mm"}; margin: ${layout === "A4" ? "8mm" : "0"}; }
                .print-label .print-card { width: 62mm; height: 40mm; overflow: hidden; break-after: page; font-size: 7pt; }
              }
            `}</style>
          </div>,
          document.body,
        )}
    </PageBody>
  );
}

// การ์ดเบิก (หัว CH. RADIATORS + QR + BILL / GROUP / PRODUCT / WORK ORDER / LOT / PART NAME / QTY / DATE)
function PickCardView({ c }: { c: PickCard }) {
  const row = (a: [string, string], b?: [string, string]) => (
    <div className="flex gap-2 border-t border-line/70 py-1 text-[11px]">
      <div className="min-w-0 flex-[1.8]">
        <span className="font-bold text-ink-soft">{a[0]} : </span>
        <span className="font-extrabold">{a[1]}</span>
      </div>
      {b && (
        <div className="min-w-0 flex-1">
          <span className="font-bold text-ink-soft">{b[0]} : </span>
          <span className="font-extrabold">{b[1]}</span>
        </div>
      )}
    </div>
  );
  return (
    <div className="rounded-xl bg-white p-3 text-black">
      <div className="flex items-start gap-3 pb-2">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-black text-sm font-black text-white">CH</div>
        <div className="flex-1 leading-tight">
          <div className="text-xs font-black">CH. RADIATORS CO.LTD.</div>
          <div className="text-[9px]">บริษัท ซีเอชเรดิเอเตอร์ จำกัด</div>
        </div>
        <QrImage text={qrText(c)} size={72} />
      </div>
      {row(["Bill", c.ticketNo], ["Group", c.groupCode])}
      {row(["Product Code", c.materialCode])}
      {row(["Product Name", c.productName])}
      {row(["Work Order", c.workOrder ?? ""], ["LOT NO.", c.lotNo ?? ""])}
      {row(["Part Name", c.fgName ?? ""])}
      {row(["Quantity", `${qtyNum(c.qty)} ${c.unit ?? ""}`.trim()], ["TicketDate", d(c.ticketDate)])}
    </div>
  );
}
