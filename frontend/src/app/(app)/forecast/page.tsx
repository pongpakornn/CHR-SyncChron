"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toasts";
import { MonthChart, type MonthPoint } from "@/components/ui/Charts";
import { useDialogs } from "@/components/ui/Dialogs";
import { Card, Empty, Loading, PageBody, PageHeader, SearchBox } from "@/components/ui/Page";
import { api, download, upload } from "@/lib/api";
import { useDebounced } from "@/lib/useDebounced";

type Month = { key: string; label: string };
type Row = { customer: string; partA: string; partNo: string; productName: string; forecast: number; order: number; delivery: number; month: string };
type Top = { rank: number; title: string; sub: string; order: number; forecast: number; percent: number; shareOfMonth: number };
const PAGE = 50;
const n0 = (v: number) => Math.round(v).toLocaleString("en-US");

// 📈 FORECAST / ORDER / DELIVERY (ForecastOrderView): กราฟทั้งปี + TOP 5 ORDER + ตารางตามเดือน (ALL MONTHS ได้) / Import / Template / Export
export default function ForecastPage() {
  const toast = useToast();
  const dlg = useDialogs();
  const [months, setMonths] = useState<Month[] | null>(null);
  const [canImport, setCanImport] = useState(false);
  const [tableMonth, setTableMonth] = useState("ALL");
  const [topMonth, setTopMonth] = useState("ALL");
  const [key, setKey] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [more, setMore] = useState(false);
  const [chart, setChart] = useState<{ year: number; months: MonthPoint[]; top: Top[] } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [pick, setPick] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const k = useDebounced(key, 400);
  const verRef = useRef(0);
  const tokenRef = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const loadingMore = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const withCalcRef = useRef(true);
  const [choice, setChoice] = useState<{ title: string; text: string; calc: string; only: string } | null>(null);

  const loadMonths = useCallback(
    async (select?: string) => {
      try {
        const r = await api<{ canImport: boolean; months: Month[]; latest: string }>("/forecast/months");
        setMonths(r.months);
        setCanImport(r.canImport);
        if (select) {
          setTableMonth(select);
          setTopMonth(select);
        }
      } catch (e) {
        toast.show("ERROR", "โหลดข้อมูล Forecast / Order ไม่สำเร็จ\n" + (e as Error).message, "error");
      }
    },
    [toast],
  );

  useEffect(() => {
    const t = setTimeout(() => loadMonths(), 0);
    return () => clearTimeout(t);
  }, [loadMonths]);

  const loadRows = useCallback(async () => {
    const v = ++verRef.current;
    try {
      const r = await api<Row[]>("/forecast/rows", { query: { month: tableMonth === "ALL" ? undefined : tableMonth, key: k, skip: 0, take: PAGE } });
      if (v !== verRef.current) return;
      setRows(r);
      setMore(r.length === PAGE);
    } catch (e) {
      toast.show("ERROR", "โหลดรายการไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }, [tableMonth, k, toast]);

  const loadTop = useCallback(async () => {
    try {
      setChart(await api("/forecast/top", { query: { month: topMonth === "ALL" ? undefined : topMonth } }));
    } catch (e) {
      toast.show("ERROR", "โหลดกราฟไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }, [topMonth, toast]);

  useEffect(() => {
    if (!months) return;
    const t = setTimeout(loadRows, 0);
    return () => clearTimeout(t);
  }, [months, loadRows]);

  useEffect(() => {
    if (!months) return;
    const t = setTimeout(loadTop, 0);
    return () => clearTimeout(t);
  }, [months, loadTop]);

  // โหลดเพิ่มทีละ 30 เมื่อเลื่อนถึงท้าย
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more) return;
    const io = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting || loadingMore.current || !rows) return;
      loadingMore.current = true;
      const v = verRef.current;
      try {
        const r = await api<Row[]>("/forecast/rows", { query: { month: tableMonth === "ALL" ? undefined : tableMonth, key: k, skip: rows.length, take: 30 } });
        if (v !== verRef.current) return;
        setRows((cur) => [...(cur ?? []), ...r]);
        setMore(r.length === 30);
      } finally {
        loadingMore.current = false;
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [more, rows, tableMonth, k]);

  // ⚡ เรียลไทม์ (8 วินาที): เครื่องอื่น Import -> โหลดใหม่ (กำลังเลื่อนอ่าน = รอ)
  useEffect(() => {
    const t = setInterval(async () => {
      if (document.hidden || (scrollRef.current?.scrollTop ?? 0) > 2) return;
      try {
        const r = await api<{ token: string }>("/forecast/token");
        if (tokenRef.current && r.token !== tokenRef.current) {
          await loadMonths();
          loadRows();
          loadTop();
        }
        tokenRef.current = r.token;
      } catch {
        /* รอบหน้า */
      }
    }, 8000);
    return () => clearInterval(t);
  }, [loadMonths, loadRows, loadTop]);

  const groups = useMemo(() => {
    const g: { key: string; items: Row[] }[] = [];
    for (const r of rows ?? []) {
      const gk = r.customer || "-";
      const last = g[g.length - 1];
      if (last && last.key === gk) last.items.push(r);
      else g.push({ key: gk, items: [r] });
    }
    return g;
  }, [rows]);

  async function startImport() {
    try {
      setChoice(await api("/forecast/import/choice"));
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  async function doImport(file: File) {
    setBusy(true);
    try {
      const pv = await upload<{ id: string; summary: string }>("/forecast/import", file, { withCalc: String(withCalcRef.current) });
      if (!(await dlg.confirm({ title: "IMPORT FORECAST", message: pv.summary, ok: "IMPORT" }))) return;
      const r = await api<{ message: string; month: string }>("/forecast/import/apply", { method: "POST", body: pv.id });
      toast.show("Forecast imported", r.message, "ok");
      await loadMonths(r.month);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function template() {
    const m = tableMonth === "ALL" ? (months && months.length ? months[months.length - 1].key : undefined) : tableMonth;
    const label = months?.find((x) => x.key === m)?.label ?? m ?? "";
    if (
      !(await dlg.confirm({
        title: "TEMPLATE EXCEL",
        ok: "YES",
        message: `ต้องการสร้างไฟล์ Template สำหรับนำเข้า Forecast / Order / Delivery ใช่หรือไม่?\n\n• ไฟล์จะมีรายการของเดือน ${label} ที่มีอยู่แล้วให้ (ไม่มีจะเป็นตารางว่าง)\n• กรอกหรือแก้ตัวเลขในไฟล์ แล้วนำเข้ากลับด้วยปุ่ม IMPORT`,
      }))
    )
      return;
    download("/forecast/template", { month: m }).catch((e) => toast.show("ERROR", "สร้างไฟล์ Template ไม่สำเร็จ\n" + e.message, "error"));
  }

  if (!months) return <Loading />;
  const all = tableMonth === "ALL";

  return (
    <PageBody>
      <PageHeader
        icon="/icons/ForecastOrder.png"
        title="FORECAST / ORDER / DELIVERY"
        subtitle={`${all ? "All months" : months.find((m) => m.key === tableMonth)?.label} • showing ${(rows ?? []).length.toLocaleString()} item(s)${more ? " - scroll down for more" : ""}`}
        actions={
          <>
            <button
              className="btn bg-success"
              onClick={() => {
                setPick(all ? months.map((m) => m.key) : [tableMonth]);
                setExportOpen(true);
              }}
              disabled={months.length === 0}
            >
              📤 EXPORT
            </button>
            {canImport && (
              <>
                <button className="btn-ghost" onClick={template}>
                  📄 TEMPLATE
                </button>
                <button className="btn bg-info" disabled={busy} onClick={startImport}>
                  {busy ? "⏳ IMPORTING..." : "📥 IMPORT"}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) doImport(f);
                  }}
                />
              </>
            )}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Card title={`FORECAST, ORDER & DELIVERY • ${chart?.year ?? ""}`} bodyClass="p-4">
          {!chart ? <Loading /> : <MonthChart data={chart.months} />}
        </Card>
        <Card
          title="TOP 5 ORDER"
          actions={
            <select className="field w-auto py-1" value={topMonth} onChange={(e) => setTopMonth(e.target.value)}>
              <option value="ALL">ALL MONTHS</option>
              {months.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          }
          bodyClass="p-4"
        >
          {!chart ? (
            <Loading />
          ) : chart.top.length === 0 ? (
            <Empty>ยังไม่มี Order</Empty>
          ) : (
            <div className="grid gap-3">
              {chart.top.map((t) => (
                <div key={t.rank} className="grid gap-1" title={`Forecast ${n0(t.forecast)}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-extrabold">
                      <span className="mr-2 text-accent">#{t.rank}</span>
                      {t.title}
                    </span>
                    <span className="whitespace-nowrap text-sm font-extrabold">
                      {n0(t.order)} <span className="text-xs text-ink-soft">{t.shareOfMonth.toFixed(1)}%</span>
                    </span>
                  </div>
                  <div className="truncate text-[11px] text-ink-soft">{t.sub}</div>
                  <div className="h-2 rounded-r-[4px] bg-[#2a78d6]" style={{ width: `${Math.max(2, t.percent)}%` }} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card
        title="ITEMS"
        actions={
          <>
            <select className="field w-auto py-1" value={tableMonth} onChange={(e) => setTableMonth(e.target.value)}>
              <option value="ALL">ALL MONTHS</option>
              {months.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </>
        }
      >
        <div className="border-b border-line/60 p-3">
          <SearchBox value={key} onChange={setKey} placeholder="ค้นหา ลูกค้า / PART A / PART NO / ชื่อสินค้า" />
        </div>
        <div ref={scrollRef} className="max-h-[60vh] min-h-[300px] overflow-auto">
          {!rows ? (
            <Loading />
          ) : rows.length === 0 ? (
            <Empty />
          ) : (
            <table className="data-table w-full">
              <thead className="sticky top-0">
                <tr>
                  <th className="w-14">NO.</th>
                  {all && <th>MONTH</th>}
                  <th>PART A</th>
                  <th>PART NO</th>
                  <th>PRODUCT NAME</th>
                  <th className="text-right">FORECAST</th>
                  <th className="text-right">ORDER</th>
                  <th className="text-right">DELIVERY</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g, gi) => (
                  <Fragment key={`${g.key}-${gi}`}>
                    <tr>
                      <td colSpan={all ? 8 : 7} className="bg-surface-2 text-xs font-extrabold uppercase text-accent">
                        CUSTOMER : {g.key} <span className="text-ink-soft">({g.items.length} ITEMS)</span>
                      </td>
                    </tr>
                    {g.items.map((r, i) => (
                      <tr key={`${r.partA}-${r.month}-${i}`}>
                        <td className="text-ink-soft">{i + 1}</td>
                        {all && <td className="whitespace-nowrap text-xs">{r.month}</td>}
                        <td className="whitespace-nowrap">{r.partA}</td>
                        <td className="whitespace-nowrap">{r.partNo}</td>
                        <td className="min-w-[200px]">{r.productName}</td>
                        <td className="text-right">{n0(r.forecast)}</td>
                        <td className="text-right font-extrabold">{n0(r.order)}</td>
                        <td className="text-right">{n0(r.delivery)}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
          {more && <div ref={sentinel} className="py-4 text-center text-xs text-ink-soft">⏳ LOADING MORE...</div>}
        </div>
      </Card>

      {/* 📥 IMPORT: คำนวณ MAX / MIN AUTO หรือ IMPORT อย่างเดียว */}
      <Modal open={!!choice} title={choice?.title ?? ""} onClose={() => setChoice(null)}>
        <p className="mb-4 whitespace-pre-line text-sm font-semibold">{choice?.text}</p>
        <div className="grid gap-2">
          {[
            [true, choice?.calc],
            [false, choice?.only],
          ].map(([calc, label]) => (
            <button
              key={String(calc)}
              className="rounded-xl border-2 border-line p-4 text-left font-extrabold text-primary hover:border-accent"
              onClick={() => {
                withCalcRef.current = calc as boolean;
                setChoice(null);
                fileRef.current?.click();
              }}
            >
              {label as string}
            </button>
          ))}
        </div>
      </Modal>

      {/* 📤 EXPORT: เลือกเดือน (1 เดือน = 1 ชีท) */}
      <Modal
        open={exportOpen}
        title="📤 EXPORT FORECAST / ORDER / DELIVERY"
        onClose={() => setExportOpen(false)}
        footer={
          <>
            <button className="btn-ghost" onClick={() => setExportOpen(false)}>
              CANCEL
            </button>
            <button
              className="btn bg-success"
              disabled={pick.length === 0}
              onClick={() => {
                setExportOpen(false);
                download("/forecast/export", undefined, { months: pick, key: k })
                  .then((f) => toast.show("Export", `${f} • ${pick.length} ชีท`, "ok"))
                  .catch((e) => toast.show("ERROR", "Export ไม่สำเร็จ\n" + e.message, "error"));
              }}
            >
              📤 EXPORT ({pick.length})
            </button>
          </>
        }
      >
        <p className="mb-3 text-sm font-semibold text-ink-soft">Tick ALL MONTHS or the months you want • one sheet per month{k ? ` • search: ${k}` : ""}</p>
        <label className="mb-2 flex items-center gap-2 font-extrabold">
          <input type="checkbox" checked={pick.length === months.length} onChange={(e) => setPick(e.target.checked ? months.map((m) => m.key) : [])} /> ALL MONTHS
        </label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {months.map((m) => (
            <label key={m.key} className={`flex items-center gap-2 rounded-lg border p-2 text-sm font-bold ${pick.includes(m.key) ? "border-accent" : "border-line"}`}>
              <input type="checkbox" checked={pick.includes(m.key)} onChange={(e) => setPick((p) => (e.target.checked ? [...p, m.key] : p.filter((x) => x !== m.key)))} />
              {m.label}
            </label>
          ))}
        </div>
      </Modal>
    </PageBody>
  );
}
