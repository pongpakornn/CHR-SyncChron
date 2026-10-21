"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toasts";
import { api, download, upload } from "@/lib/api";
import { qtyText } from "./types";

type HistoryRow = {
  date: string;
  stockCode: string;
  type: string;
  code: string;
  partCode: string;
  partName: string;
  qty: number;
  user: string;
  employeeId: string;
  department: string;
  refNo: string;
  isCancelled: boolean;
};
type HistoryPage = { total: number; page: number; pageSize: number; stocks: { stkId: number; code: string; name: string }[]; rows: HistoryRow[] };
type RpaStock = { stkId: number; code: string; file: string; fileFound: boolean; canExport: boolean; count: number; how: string; problem: string; defaultChecked: boolean };
type RpaPreview = { pickDay: boolean; stocks: RpaStock[] };
type RpaExists = { stkId: number; code: string; sheet: string; file: string; question: string };
type RpaResult = { done: string[]; files: { stkId: number; code: string; name: string }[]; exists: RpaExists[] };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// 🕘 HISTORY (ScanHistoryWindow) - 1 หน้า = 50 รายการ / พิมพ์ค้นหาแล้วรอ 350 ms / EXPORT ปกติ หรือ EXPORT RPA
export function HistoryModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const now = new Date();
  const [key, setKey] = useState("");
  const [from, setFrom] = useState(iso(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(iso(now));
  const [stkId, setStkId] = useState<string>("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<HistoryPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [exportChoice, setExportChoice] = useState(false);
  const [rpa, setRpa] = useState<RpaPreview | null>(null);
  const [rpaDay, setRpaDay] = useState(iso(now));
  const [rpaChecked, setRpaChecked] = useState<number[]>([]);
  const [rpaBusy, setRpaBusy] = useState(false);
  const [rpaAsk, setRpaAsk] = useState<{ queue: RpaExists[]; replace: number[]; yes: number[]; done: string[]; files: RpaResult["files"] } | null>(null);
  const [rpaDone, setRpaDone] = useState<{ done: string[]; files: RpaResult["files"] } | null>(null);

  const filter = { key, from, to, stkId: stkId || undefined, type: type || undefined };

  const load = useCallback(
    async (p: number) => {
      setLoading(true);
      try {
        const r = await api<HistoryPage>("/scanner/history", { query: { key, from, to, stkId: stkId || undefined, type: type || undefined, page: p } });
        setData(r);
        setPage(p);
      } catch (e) {
        toast.show("History", "โหลดประวัติการสแกนไม่สำเร็จ: " + (e as Error).message, "error");
      } finally {
        setLoading(false);
      }
    },
    [key, from, to, stkId, type, toast],
  );

  useEffect(() => {
    const t = setTimeout(() => load(0), 350);
    return () => clearTimeout(t);
  }, [load]);

  async function exportNormal() {
    setExportChoice(false);
    try {
      const name = await download("/scanner/history/export", filter);
      toast.show("Export complete", `Export ประวัติการสแกน\n${name}`, "ok");
    } catch (e) {
      toast.show("ERROR", "Export ไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }

  const loadRpa = useCallback(
    async (day: string) => {
      try {
        const r = await api<RpaPreview>("/scanner/rpa", { query: { stkId: stkId || undefined, day, from, to } });
        setRpa(r);
        setRpaChecked((cur) => (cur.length ? cur.filter((id) => r.stocks.some((s) => s.stkId === id && s.canExport)) : r.stocks.filter((s) => s.defaultChecked).map((s) => s.stkId)));
      } catch (e) {
        setRpa(null);
        toast.show("EXPORT RPA", (e as Error).message, "warn");
      }
    },
    [stkId, from, to, toast],
  );

  async function runRpa(replace: number[], prevDone: string[] = [], prevFiles: RpaResult["files"] = [], only?: number[]) {
    setRpaBusy(true);
    try {
      const r = await api<RpaResult>("/scanner/rpa", {
        method: "POST",
        body: { stockIds: only ?? rpaChecked, day: rpaDay, from, to, replace },
      });
      const done = [...prevDone, ...r.done];
      const files = [...prevFiles, ...r.files];
      if (r.exists.length > 0) setRpaAsk({ queue: r.exists, replace, yes: [], done, files });
      else finishRpa(done, files);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setRpaBusy(false);
    }
  }

  function finishRpa(done: string[], files: RpaResult["files"]) {
    setRpaAsk(null);
    setRpa(null);
    if (files.length > 0) toast.show("Export RPA complete", done.join("\n"), "ok");
    setRpaDone({ done, files });
  }

  // ชีทชื่อเดียวกันมีอยู่แล้ว: ถามทีละคลัง (ใช่ = เขียนทับ / ไม่ = ข้ามคลังนี้)
  function answer(ok: boolean) {
    if (!rpaAsk) return;
    const [cur, ...rest] = rpaAsk.queue;
    const yes = ok ? [...rpaAsk.yes, cur.stkId] : rpaAsk.yes;
    const done = ok ? rpaAsk.done : [...rpaAsk.done, `– ${cur.code}: ข้าม (ชีท "${cur.sheet}" มีอยู่แล้ว)`];
    if (rest.length > 0) return setRpaAsk({ ...rpaAsk, queue: rest, yes, done });
    if (yes.length === 0) return finishRpa(done, rpaAsk.files);
    // ส่งเฉพาะคลังที่ตอบ "เขียนทับ" อีกรอบ
    setRpaAsk(null);
    runRpa([...rpaAsk.replace, ...yes], done, rpaAsk.files, yes);
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const first = data && data.total > 0 ? page * data.pageSize + 1 : 0;
  const lastNo = data ? page * data.pageSize + data.rows.length : 0;
  const rpaCount = rpa?.stocks.filter((s) => rpaChecked.includes(s.stkId) && s.canExport).reduce((a, s) => a + s.count, 0) ?? 0;

  return (
    <>
      <Modal
        open
        wide
        title="🕘 SCAN HISTORY"
        onClose={onClose}
        footer={
          <>
            <span className="mr-auto self-center text-xs font-bold text-ink-soft">
              {loading ? "⏳ LOADING..." : `${first.toLocaleString()} - ${lastNo.toLocaleString()} OF ${(data?.total ?? 0).toLocaleString()} RECORDS`}
            </span>
            <button className="btn-ghost" disabled={page === 0 || loading} onClick={() => load(page - 1)}>
              ◀ PREV
            </button>
            <span className="self-center text-sm font-bold">
              PAGE {page + 1} / {pages}
            </span>
            <button className="btn-ghost" disabled={!data || (page + 1) * data.pageSize >= data.total || loading} onClick={() => load(page + 1)}>
              NEXT ▶
            </button>
            <button className="btn bg-success" onClick={() => setExportChoice(true)}>
              📤 EXPORT
            </button>
          </>
        }
      >
        <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-6">
          <input className="field col-span-2" placeholder="🔍 ค้นหา รหัส / ชื่อ / บาร์โค้ด / ผู้ใช้ / EMP ID" value={key} onChange={(e) => setKey(e.target.value)} />
          <input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input type="date" className="field" value={to} onChange={(e) => setTo(e.target.value)} />
          <select className="field" value={stkId} onChange={(e) => setStkId(e.target.value)}>
            <option value="">ALL STOCKS</option>
            {data?.stocks.map((s) => (
              <option key={s.stkId} value={s.stkId}>
                {s.code}
              </option>
            ))}
          </select>
          <select className="field" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">ALL TYPES</option>
            <option>IN</option>
            <option>OUT</option>
            <option>RETURN</option>
          </select>
        </div>
        <div className="overflow-auto rounded-xl border border-line">
          <table className="data-table w-full">
            <thead className="sticky top-0">
              <tr>
                <th>DATE TIME</th>
                <th>STOCK</th>
                <th>TYPE</th>
                <th>PRODUCT CODE</th>
                <th>PRODUCT NAME</th>
                <th className="text-right">QTY</th>
                <th>USER</th>
                <th>EMP ID</th>
                <th>DEPARTMENT</th>
                <th>BARCODE</th>
              </tr>
            </thead>
            <tbody>
              {data?.rows.map((r, i) => (
                <tr key={i} className={r.isCancelled ? "text-ink-soft line-through" : ""}>
                  <td className="whitespace-nowrap text-xs">{r.date}</td>
                  <td>{r.stockCode}</td>
                  <td className="whitespace-nowrap">{r.type}</td>
                  <td className="break-all">{r.code}</td>
                  <td className="min-w-[200px]">{r.partName}</td>
                  <td className="text-right">{qtyText(r.qty)}</td>
                  <td className="whitespace-nowrap">{r.user}</td>
                  <td>{r.employeeId}</td>
                  <td>{r.department}</td>
                  <td className="max-w-[260px] truncate font-mono text-xs" title={r.refNo}>
                    {r.refNo}
                  </td>
                </tr>
              ))}
              {data && data.rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-10 text-center text-ink-soft">
                    ไม่พบรายการ
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Modal>

      {/* 📤 เลือกวิธี EXPORT */}
      <Modal open={exportChoice} title="📤 EXPORT" onClose={() => setExportChoice(false)}>
        <p className="mb-4 text-sm font-semibold text-ink-soft">Choose how to export the scan history</p>
        <div className="grid gap-3">
          <button className="rounded-xl border-2 border-line p-4 text-left hover:border-accent" onClick={exportNormal}>
            <div className="font-extrabold text-primary">📤 EXPORT</div>
            <div className="text-sm">Every record of the current filter → a new Excel file</div>
            <div className="text-xs text-ink-soft">date / stock / type / search above</div>
          </button>
          <button
            className="rounded-xl border-2 border-line p-4 text-left hover:border-accent"
            onClick={() => {
              setExportChoice(false);
              setRpaChecked([]);
              loadRpa(rpaDay);
            }}
          >
            <div className="font-extrabold text-primary">🤖 EXPORT RPA</div>
            <div className="text-sm">Scans of the chosen day → the RPA Excel file of each stock</div>
            <div className="text-xs text-ink-soft">User Management → SETUP → EXCEL SETUP → MULTI-SCANNER</div>
          </button>
        </div>
      </Modal>

      {/* 🤖 EXPORT RPA (RpaExportWindow) */}
      <Modal
        open={!!rpa}
        wide
        title="🤖 EXPORT RPA"
        onClose={() => setRpa(null)}
        footer={
          <>
            <span className="mr-auto self-center text-xs font-bold text-ink-soft">
              {rpaChecked.length === 0 ? "Tick the stocks to export" : rpaCount === 0 ? "No scans on the chosen day" : `${rpaCount.toLocaleString()} scans → ${rpaChecked.length} file(s)`}
            </span>
            <button className="btn-ghost" onClick={() => setRpa(null)}>
              CANCEL
            </button>
            <button className="btn bg-accent" disabled={rpaBusy || rpaCount === 0} onClick={() => runRpa([])}>
              {rpaBusy ? "⏳ EXPORTING..." : "🤖 EXPORT RPA"}
            </button>
          </>
        }
      >
        {rpa?.pickDay && (
          <div className="mb-4 flex items-center gap-3">
            <label className="text-sm font-extrabold">DAY</label>
            <input
              type="date"
              className="field w-auto"
              value={rpaDay}
              onChange={(e) => {
                setRpaDay(e.target.value);
                loadRpa(e.target.value);
              }}
            />
          </div>
        )}
        <div className="grid gap-2">
          {rpa?.stocks.map((s) => (
            <label key={s.stkId} className={`flex gap-3 rounded-xl border p-3 ${s.canExport ? "cursor-pointer border-line" : "border-danger/40 bg-[#ffebee]"}`}>
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 accent-[var(--accent)]"
                disabled={!s.canExport}
                checked={rpaChecked.includes(s.stkId)}
                onChange={(e) => setRpaChecked((l) => (e.target.checked ? [...l, s.stkId] : l.filter((x) => x !== s.stkId)))}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-extrabold text-primary">{s.code}</span>
                  <span className="rounded bg-surface-2 px-2 text-xs font-bold">{s.count.toLocaleString()} SCANS</span>
                </div>
                <div className="truncate text-xs text-ink-soft">📊 {s.file}</div>
                <div className="text-xs font-semibold">{s.how}</div>
                {s.problem && <div className="text-xs font-bold text-danger">{s.problem}</div>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <label className="btn-ghost cursor-pointer px-3 py-1 text-xs" onClick={(e) => e.stopPropagation()}>
                    📤 {s.fileFound ? "REPLACE FILE" : "UPLOAD FILE"}
                    <input
                      type="file"
                      accept=".xlsx"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (!f) return;
                        try {
                          await upload(`/scanner/rpa/file/${s.stkId}`, f);
                          toast.show("RPA FILE", `${s.code}: อัปโหลด ${f.name} แล้ว`, "ok");
                          loadRpa(rpaDay);
                        } catch (err) {
                          toast.show("ERROR", (err as Error).message, "error");
                        }
                      }}
                    />
                  </label>
                  {s.fileFound && (
                    <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={(e) => (e.preventDefault(), download(`/scanner/rpa/file/${s.stkId}`).catch((err) => toast.show("ERROR", err.message, "error")))}>
                      📥 DOWNLOAD
                    </button>
                  )}
                </div>
              </div>
            </label>
          ))}
        </div>
      </Modal>

      {/* ชีทซ้ำ -> ถามก่อนเขียนทับ */}
      <Modal
        open={!!rpaAsk}
        title="EXPORT RPA"
        onClose={() => answer(false)}
        footer={
          <>
            <button className="btn-ghost" onClick={() => answer(false)}>
              ไม่ (ข้าม)
            </button>
            <button className="btn bg-danger" onClick={() => answer(true)}>
              เขียนทับ
            </button>
          </>
        }
      >
        <p className="whitespace-pre-line text-sm font-semibold">{rpaAsk?.queue[0]?.question}</p>
      </Modal>

      {/* ผล EXPORT RPA + ดาวน์โหลดไฟล์ไว้ตรวจ */}
      <Modal open={!!rpaDone} title="Export RPA complete" onClose={() => setRpaDone(null)}>
        <ul className="mb-4 grid gap-1 text-sm font-semibold">
          {rpaDone?.done.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          {rpaDone?.files.map((f) => (
            <button key={f.stkId} className="btn bg-success" onClick={() => download(`/scanner/rpa/file/${f.stkId}`).catch((e) => toast.show("ERROR", e.message, "error"))}>
              📥 {f.code}: {f.name}
            </button>
          ))}
        </div>
      </Modal>
    </>
  );
}
