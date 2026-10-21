"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toasts";
import { api } from "@/lib/api";
import { hasThai, toEnglish } from "@/lib/thaiKeyboard";
import { AdjustModal } from "./AdjustModal";
import { DeductModal } from "./DeductModal";
import { DisplayModal } from "./DisplayModal";
import { HistoryModal } from "./HistoryModal";
import { ScopeModal } from "./ScopeModal";
import { qtyText, type ScanFormat, type ScannerContext, type ScanResult, type ScanRow, type Today } from "./types";

// 📷 MULTI-SCANNER (ScanInView + ScanInViewModel) - เงื่อนไขทั้งหมดอยู่ที่ API (ScanProcessor) หน้านี้ส่งบาร์โค้ด + โหมด แล้วแสดงผล
const SCOPE_KEY = "chr-scanner-scope"; // ฐานที่ยังไม่ให้ Admin กำหนดคลัง = จำคลังไว้ที่ Browser (แทนไฟล์ scanner_stock.txt)
const TURBO_MS = 120;
const MAX_WAIT_INCOMPLETE_MS = 1500;

type Modes = { out: boolean; return: boolean; remainder: boolean; test: boolean };
type Pending = { barcode: string; chosenStockId?: number; enteredQty?: number };

function readScope() {
  try {
    return localStorage.getItem(SCOPE_KEY) ?? "";
  } catch {
    return "";
  }
}

// ⌛ ป้ายยังมาไม่ครบ (ScanInViewModel.LooksIncomplete)
function looksIncomplete(raw: string, formats: ScanFormat[]) {
  const t = raw.trim();
  if (t.length < 3) return true;
  const split = (f: ScanFormat) => {
    let s = t;
    if (f.trimChars) {
      const chars = new Set(f.trimChars.split(""));
      let a = 0,
        b = s.length;
      while (a < b && chars.has(s[a])) a++;
      while (b > a && chars.has(s[b - 1])) b--;
      s = s.slice(a, b).trim();
    }
    return f.spaces ? s.split(/\s+/).filter(Boolean) : s.split(f.delimiter);
  };
  const withDelim = formats.filter((f) => !f.spaces && f.delimiter && t.includes(f.delimiter));
  if (withDelim.length === 0) return false;
  if (formats.some((f) => (f.spaces || (f.delimiter && t.includes(f.delimiter))) && split(f).length >= f.required)) return false;
  return withDelim.some((f) => split(f).length < f.minFields);
}

export default function ScannerPage() {
  const toast = useToast();
  const [ctx, setCtx] = useState<ScannerContext | null>(null);
  const [today, setToday] = useState<Today | null>(null);
  const [modes, setModes] = useState<Modes>({ out: false, return: false, remainder: false, test: false });
  const [testRows, setTestRows] = useState<ScanRow[]>([]);
  const [last, setLast] = useState<ScanRow | null>(null);
  const [barcode, setBarcode] = useState("");
  const [employee, setEmployee] = useState("");
  const [department, setDepartment] = useState("");
  const [busy, setBusy] = useState(false);
  const [summaryStk, setSummaryStk] = useState<number | null>(null);
  const [choose, setChoose] = useState<{ result: ScanResult; pending: Pending } | null>(null);
  const [qtyAsk, setQtyAsk] = useState<{ result: ScanResult; pending: Pending } | null>(null);
  const [qtyValue, setQtyValue] = useState("");
  const [showScope, setShowScope] = useState(false);
  const [showDisplay, setShowDisplay] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [locked, setLocked] = useState<string | null>(null);
  const [deductView, setDeductView] = useState<"deducted" | "not" | null>(null);
  const [showAdjust, setShowAdjust] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const empRef = useRef<HTMLInputElement>(null);
  const deptRef = useRef<HTMLSelectElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastChange = useRef(0);
  const lastScanAt = useRef(0);
  const modesRef = useRef(modes);
  const ctxRef = useRef(ctx);
  const sigRef = useRef<string | null>(null);
  useEffect(() => {
    modesRef.current = modes;
    ctxRef.current = ctx;
  }, [modes, ctx]);

  const focusScan = useCallback(() => setTimeout(() => inputRef.current?.focus(), 0), []);

  // ---------------------------------------------------------------- โหลดข้อมูล
  const loadContext = useCallback(async (m?: Modes) => {
    const mm = m ?? modesRef.current;
    const c = await api<ScannerContext>("/scanner/context", { query: { scope: readScope(), ...mm } });
    setCtx(c);
    setModes((cur) => {
      const next = { out: c.modes.out, return: c.modes.return, remainder: c.modes.remainder, test: c.modes.test };
      return cur.out === next.out && cur.return === next.return && cur.remainder === next.remainder && cur.test === next.test ? cur : next;
    });
    if (c.who.askDepartment) setDepartment((d) => (d && !c.who.departments.includes(d) ? "" : d));
    return c;
  }, []);

  const loadToday = useCallback(async (onlyIfChanged: boolean) => {
    const t = await api<Today>("/scanner/today", { query: { scope: readScope() } });
    if (onlyIfChanged && t.signature === sigRef.current) return;
    sigRef.current = t.signature;
    setToday(t);
  }, []);

  useEffect(() => {
    loadContext()
      .then(() => loadToday(false))
      .catch((e) => toast.show("ERROR", "ไม่สามารถโหลดรายชื่อคลังสำหรับแสกนได้\n" + e.message, "error"));
    focusScan();
  }, [loadContext, loadToday, focusScan, toast]);

  // 🔄 เรียลไทม์: ทุก 3 วินาทีดึงรายการวันนี้ (ไม่ดึงระหว่าง TEST MODE หรือภายใน 3 วินาทีหลังสแกน) + Admin เปลี่ยนคลังให้ -> ใช้เลย
  useEffect(() => {
    let busyTick = false;
    const t = setInterval(async () => {
      if (busyTick || Date.now() - lastScanAt.current < 3000 || document.hidden) return;
      busyTick = true;
      try {
        const before = ctxRef.current;
        const c = await loadContext();
        if (before && before.scope.notAssigned && !c.scope.notAssigned) toast.show("MULTI-SCANNER", "Admin กำหนดคลังสแกนให้แล้ว ใช้งานได้เลย", "ok");
        if (!modesRef.current.test && !c.scope.notAssigned) await loadToday(true);
      } catch {
        /* เครือข่ายสะดุด - รอบถัดไปลองใหม่ */
      } finally {
        busyTick = false;
      }
    }, 3000);
    return () => clearInterval(t);
  }, [loadContext, loadToday, toast]);

  // 🎯 ตัวอักษรที่ยิงเข้ามาตอนโฟกัสไม่อยู่ในช่องพิมพ์ใด ๆ -> ส่งเข้าช่องสแกน (ป้ายไม่ขาดหัว)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (typing || e.ctrlKey || e.altKey || e.metaKey || e.key.length !== 1) return;
      if (document.querySelector('[role="dialog"]')) return;
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, []);

  // ---------------------------------------------------------------- สแกน
  function handle(r: ScanResult, p: Pending) {
    switch (r.kind) {
      case "Saved":
      case "SavedWarning":
      case "Test":
        if (r.item) {
          setLast(r.item);
          if (r.kind === "Test") setTestRows((l) => [r.item!, ...l].slice(0, 12));
          else {
            setToday((t) => (t ? { ...t, rows: [r.item!, ...t.rows] } : t));
            loadToday(false).catch(() => {});
          }
        }
        if (r.kind === "SavedWarning") toast.show(r.title ?? "WARNING", r.message ?? "", "warn");
        if (r.toastTitle) toast.show(r.toastTitle, r.toastMessage ?? "", r.toastOk ? "ok" : "warn");
        break;
      case "Error":
        toast.show(r.title ?? "ERROR", r.message ?? "", "error");
        break;
      case "Warning":
      case "Denied":
        toast.show(r.title ?? "WARNING", r.message ?? "", "warn");
        if (r.focus === "employee") setTimeout(() => empRef.current?.focus(), 0);
        if (r.focus === "department") setTimeout(() => deptRef.current?.focus(), 0);
        if (r.focus) return;
        break;
      case "Held":
        toast.show(r.title ?? "NOT DEDUCTED", r.message ?? "", "warn");
        break;
      case "Locked":
        setLocked(r.message ?? "");
        loadContext().catch(() => {});
        break;
      case "NeedStock":
        setChoose({ result: r, pending: p });
        return;
      case "NeedQty":
        setQtyValue("");
        setQtyAsk({ result: r, pending: { ...p, chosenStockId: p.chosenStockId ?? r.candidates?.[0]?.stkId } });
        return;
    }
    if (r.refreshDeduct) loadContext().catch(() => {});
    focusScan();
  }

  async function send(p: Pending) {
    const c = ctxRef.current;
    if (!c) return;
    if (c.scope.notAssigned) {
      setLocked(c.contacts);
      return;
    }
    lastScanAt.current = Date.now();
    setBusy(true);
    try {
      const r = await api<ScanResult>("/scanner/scan", {
        method: "POST",
        body: { ...p, ...modesRef.current, employeeId: employee, department, clientScope: readScope() },
      });
      handle(r, p);
    } catch (e) {
      toast.show("ERROR", "เกิดข้อผิดพลาด: " + (e as Error).message, "error");
    } finally {
      setBusy(false);
      lastScanAt.current = Date.now();
    }
  }

  function commit(raw: string) {
    if (timer.current) clearTimeout(timer.current);
    setBarcode("");
    if (raw.trim()) send({ barcode: raw });
  }

  function onBarcodeChange(v: string) {
    if (v && hasThai(v)) v = toEnglish(v);
    setBarcode(v);
    if (!v) return;
    // ✨ ป้ายที่ลงท้ายด้วย "piece" (เช่น StorePC) -> ตัดรอบทันที
    if (v.trimEnd().toLowerCase().endsWith("piece")) return commit(v);
    lastChange.current = Date.now();
    if (timer.current) clearTimeout(timer.current);
    const tick = () => {
      const cur = inputRef.current?.value ?? "";
      if (!cur.trim()) return;
      if (Date.now() - lastChange.current < MAX_WAIT_INCOMPLETE_MS && looksIncomplete(cur, ctxRef.current?.formats ?? [])) {
        timer.current = setTimeout(tick, 150);
        return;
      }
      commit(cur);
    };
    timer.current = setTimeout(tick, TURBO_MS);
  }

  // ---------------------------------------------------------------- โหมด (กฎเดียวกับ setter ใน ViewModel)
  function toggle(key: keyof Modes) {
    const m = { ...modes };
    if (key === "out") {
      if (m.out && ctx?.modes.outOnly) return;
      m.out = !m.out;
      if (m.out) m.return = false;
    } else if (key === "return") {
      m.return = !m.return;
      if (m.return) {
        m.out = ctx?.modes.outOnly ? m.out : false;
        m.remainder = false;
      }
    } else if (key === "remainder") {
      m.remainder = !m.remainder;
      if (m.remainder) m.return = false;
    } else m.test = !m.test;
    setModes(m);
    if (key === "test" && !m.test) setTestRows([]);
    loadContext(m).catch(() => {});
    focusScan();
  }

  // ---------------------------------------------------------------- แสดงผล
  const modeStatus = modes.out ? "OUT" : modes.return ? "RETURN" : "IN";
  const rows = useMemo(
    () => (today?.rows ?? []).filter((r) => r.status === modeStatus || (r.isDeductOut && modeStatus === "IN")),
    [today, modeStatus],
  );
  const scopeStocks = useMemo(
    () => (ctx ? (ctx.scope.auto ? ctx.stocks : ctx.stocks.filter((s) => ctx.scope.ids.includes(s.stkId))) : []),
    [ctx],
  );
  const summary = useMemo(() => (today?.summary ?? []).filter((s) => summaryStk == null || s.stkId === summaryStk), [today, summaryStk]);
  const multi = !!ctx?.scope.isMulti;
  const notAssigned = !!ctx?.scope.notAssigned;
  const title = modes.out ? "MULTI-SCANNER ( OUT )" : "MULTI-SCANNER ( IN )";
  const codeHeader = ctx?.codeHeader ?? "PRODUCT CODE";

  if (!ctx) return <div className="grid h-full place-items-center text-ink-soft">⏳ LOADING...</div>;

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-4 p-3 md:p-5">
      {/* หัวหน้า + ปุ่มโหมด */}
      <section className="rounded-2xl bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/MultiScanner.png" alt="" className="h-9 w-9 object-contain" style={{ filter: "brightness(0) saturate(100%) invert(31%) sepia(19%) saturate(2400%) hue-rotate(228deg)" }} />
          <h2 className="text-xl font-extrabold text-accent md:text-2xl">{title}</h2>
          <div className="ml-auto flex flex-wrap gap-2">
            {ctx.buttons.scanOut && (
              <button className="btn" style={{ background: modes.out ? "var(--danger)" : "var(--scanout)" }} onClick={() => toggle("out")} disabled={notAssigned || (modes.out && ctx.modes.outOnly)}>
                {modes.out ? "CANCEL SCAN OUT" : "SCAN OUT"}
              </button>
            )}
            {ctx.buttons.return && (
              <button className="btn" style={{ background: modes.return ? "var(--danger)" : "var(--return)" }} onClick={() => toggle("return")} disabled={notAssigned}>
                {modes.return ? "CANCEL RETURN" : "RETURN"}
              </button>
            )}
            {ctx.buttons.remainder && (
              <button className="btn" style={{ background: modes.remainder ? "var(--danger)" : "var(--teal)" }} onClick={() => toggle("remainder")} disabled={notAssigned}>
                {modes.remainder ? "CANCEL REMAINDER" : "🔢 REMAINDER"}
              </button>
            )}
            <button className="btn" style={{ background: modes.test ? "var(--danger)" : "var(--warning)" }} onClick={() => toggle("test")} disabled={notAssigned}>
              {modes.test ? "EXIT TEST" : "TEST MODE"}
            </button>
            <button className="btn bg-info" onClick={() => setShowHistory(true)} disabled={notAssigned}>
              🕘 HISTORY
            </button>
            {ctx.buttons.display && (
              <button className="btn bg-primary" onClick={() => setShowDisplay(true)} disabled={notAssigned}>
                🏷️ DISPLAY
              </button>
            )}
            {ctx.buttons.deducted && (
              <button className="btn bg-success" title="ป้ายที่รับเข้าแล้วตัดคลังต้นทางได้ วันนี้" onClick={() => setDeductView("deducted")} disabled={notAssigned}>
                ✔ DEDUCTED ({ctx.counts.deductedToday.toLocaleString()})
              </button>
            )}
            {ctx.buttons.notDeducted && (
              <button className="btn bg-danger" title="ป้ายที่ยังไม่รับเข้า รอผู้มีสิทธิ์ APPROVE" onClick={() => setDeductView("not")} disabled={notAssigned}>
                ⚠ NOT DEDUCTED ({ctx.counts.notDeducted.toLocaleString()})
              </button>
            )}
            {ctx.buttons.adjust && (
              <button className="btn bg-primary-dark" onClick={() => setShowAdjust(true)} disabled={notAssigned}>
                ✏️ ADJUST SCAN
              </button>
            )}
          </div>
        </div>

        {/* แถบโหมดที่เปิดอยู่ */}
        <div className="mt-3 flex flex-col gap-2 empty:hidden">
          {modes.test && <Banner color="var(--warning)">⚠️ TEST MODE ACTIVE (NOT SAVED)</Banner>}
          {modes.out && <Banner color="var(--scanout)">📤 SCAN OUT MODE — ตัดสต็อกออก</Banner>}
          {modes.return && <Banner color="var(--return)">🔄 RETURN MODE — คืนเหล็กเข้าคลัง (กรอกจำนวนเอง)</Banner>}
          {modes.remainder && <Banner color="var(--teal)">🔢 REMAINDER MODE — กรอกจำนวนเศษเอง ไม่นับกล่อง</Banner>}
          {notAssigned && <Banner color="var(--danger)">⛔ ยังไม่ได้เลือกคลังของ UserID นี้ กรุณาติดต่อ Admin</Banner>}
        </div>

        {/* ช่องสแกน + EMPLOYEE / DEPARTMENT + STOCK */}
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <label className="mb-1 block text-xs font-extrabold uppercase text-ink-soft">SCAN BARCODE</label>
            <input
              ref={inputRef}
              value={barcode}
              disabled={notAssigned}
              autoComplete="off"
              spellCheck={false}
              inputMode="none"
              placeholder={busy ? "⏳ กำลังบันทึก..." : "ยิงบาร์โค้ด / QR ที่นี่"}
              onChange={(e) => onBarcodeChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  commit(e.currentTarget.value);
                }
              }}
              className="field h-14 border-2 border-accent font-mono text-lg"
            />
          </div>
          {ctx.who.askEmployee && (
            <div className="lg:col-span-2">
              <label className="mb-1 block text-xs font-extrabold uppercase text-ink-soft">
                EMPLOYEE ID <span className="font-semibold normal-case text-accent">{ctx.who.employeeHint}</span>
              </label>
              <input
                ref={empRef}
                value={employee}
                maxLength={30}
                onChange={(e) => setEmployee(e.target.value)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === "Tab") && (e.preventDefault(), focusScan())}
                className="field h-14 text-lg"
              />
            </div>
          )}
          {ctx.who.askDepartment && (
            <div className="lg:col-span-2">
              <label className="mb-1 block text-xs font-extrabold uppercase text-ink-soft">
                DEPARTMENT <span className="font-semibold normal-case text-accent">{ctx.who.departmentHint}</span>
              </label>
              <select ref={deptRef} value={department} onChange={(e) => (setDepartment(e.target.value), focusScan())} className="field h-14 text-base">
                <option value="">-- เลือกแผนก --</option>
                {ctx.who.departments.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </div>
          )}
          <div className={ctx.who.askEmployee && ctx.who.askDepartment ? "lg:col-span-3" : ctx.who.askEmployee || ctx.who.askDepartment ? "lg:col-span-5" : "lg:col-span-7"}>
            <label className="mb-1 block text-xs font-extrabold uppercase text-ink-soft">STOCK</label>
            <button
              onClick={() => (notAssigned ? setLocked(ctx.contacts) : ctx.scope.canChange ? setShowScope(true) : null)}
              title={notAssigned ? "ยังไม่ได้กำหนดคลังสแกน กรุณาติดต่อ Admin" : ctx.scope.assignMode && !ctx.scope.canChange ? "Stocks are set by the Admin (User Management)" : "Choose the stocks to scan"}
              className="flex h-14 w-full flex-col items-start justify-center rounded-lg px-4 text-left text-white"
              style={{ background: notAssigned ? "var(--danger)" : "var(--primary)", cursor: ctx.scope.canChange || notAssigned ? "pointer" : "default" }}
            >
              <span className="truncate text-base font-extrabold">{ctx.scope.text}</span>
              {ctx.scope.subText && <span className="truncate text-[11px] font-semibold text-white/75">{ctx.scope.subText}</span>}
            </button>
          </div>
        </div>
      </section>

      {/* รายการล่าสุด */}
      <section className="grid grid-cols-1 gap-4 rounded-2xl bg-surface p-4 shadow-sm md:grid-cols-[180px_1fr_200px]">
        <div className="grid aspect-square place-items-center overflow-hidden rounded-xl bg-surface-2">
          {last?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={last.imageUrl + last.time} src={last.imageUrl} alt="" className="h-full w-full object-contain" onError={(e) => (e.currentTarget.style.display = "none")} />
          ) : (
            <span className="text-4xl text-line">▣</span>
          )}
        </div>
        <div className="min-w-0">
          <div className="text-xs font-extrabold uppercase text-ink-soft">{codeHeader}</div>
          <div className="break-all text-2xl font-extrabold text-primary md:text-4xl">{last?.code || "-"}</div>
          <div className="mt-3 text-xs font-extrabold uppercase text-ink-soft">PART DESCRIPTION</div>
          <div className="text-lg font-bold">{last?.partName || "-"}</div>
          {last?.stockCode && (
            <div className="mt-2 inline-block rounded-md bg-accent-soft px-2 py-0.5 text-sm font-extrabold text-accent">🏬 {last.stockCode}</div>
          )}
        </div>
        <div className="flex flex-col items-center justify-center rounded-xl bg-surface-2 p-3">
          <div className="text-xs font-extrabold uppercase text-ink-soft">{modes.out ? "QTY OUT" : "QTY IN"}</div>
          <div className="text-5xl font-extrabold text-success">{last ? qtyText(last.qty) : "0"}</div>
        </div>
      </section>

      {/* ตารางวันนี้ + สรุป */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="overflow-hidden rounded-2xl bg-surface shadow-sm">
          <div className="flex items-center justify-between px-4 py-3" style={{ background: modes.test ? "var(--warning)" : undefined }}>
            <h3 className={`text-sm font-extrabold uppercase ${modes.test ? "text-white" : "text-primary"}`}>
              {modes.test ? "TEST SCAN RESULT (NOT SAVED)" : "DAILY SCAN ( IN / OUT )"}
            </h3>
            <span className={`text-xs font-bold ${modes.test ? "text-white" : "text-ink-soft"}`}>{(modes.test ? testRows : rows).length.toLocaleString()} รายการ</span>
          </div>
          <div className="max-h-[520px] overflow-auto">
            <table className="data-table w-full">
              <thead className="sticky top-0">
                <tr>
                  <th>{codeHeader}</th>
                  <th className="text-right">QTY</th>
                  <th>STATUS</th>
                  <th>DATETIME</th>
                </tr>
              </thead>
              <tbody>
                {(modes.test ? testRows : rows).map((r, i) => (
                  <tr key={`${r.time}-${i}`}>
                    <td>
                      <div className="break-all">{r.code}</div>
                      {multi && <div className="text-[11px] text-accent">{r.stockCode}</div>}
                      <div className="text-[11px] font-medium text-ink-soft">{r.partName}</div>
                    </td>
                    <td className="text-right">{qtyText(r.qty)}</td>
                    <td>
                      <StatusPill status={r.status} deduct={r.isDeductOut} />
                    </td>
                    <td className="whitespace-nowrap text-xs">{new Date(r.time).toLocaleTimeString("th-TH")}</td>
                  </tr>
                ))}
                {(modes.test ? testRows : rows).length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-ink-soft">
                      ยังไม่มีรายการ
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl bg-surface shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <h3 className="text-sm font-extrabold uppercase text-primary">Daily Stock Movement Summary</h3>
            {multi && scopeStocks.length > 1 && (
              <select className="field w-auto py-1" value={summaryStk ?? ""} onChange={(e) => setSummaryStk(e.target.value ? Number(e.target.value) : null)}>
                <option value="">ALL STOCKS</option>
                {scopeStocks.map((s) => (
                  <option key={s.stkId} value={s.stkId}>
                    {s.code}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="max-h-[520px] overflow-auto">
            <table className="data-table w-full">
              <thead className="sticky top-0">
                <tr>
                  <th>{summaryStk != null ? ctx.stocks.find((s) => s.stkId === summaryStk)?.codeHeader : codeHeader}</th>
                  <th className="text-right">IN (FREQ.)</th>
                  <th className="text-right">OUT (FREQ.)</th>
                  <th className="text-right">IN (QTY)</th>
                  <th className="text-right">OUT (QTY)</th>
                  <th className="text-right">INVENTORY BALANCE</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((s) => (
                  <tr key={`${s.stkId}-${s.partId}-${s.partCode}`}>
                    <td>
                      <div className="break-all">{s.code}</div>
                      {multi && <div className="text-[11px] text-accent">{s.stockCode}</div>}
                    </td>
                    <td className="text-right">{s.inCount}</td>
                    <td className="text-right">{s.outCount}</td>
                    <td className="text-right text-success">{qtyText(s.totalInQty)}</td>
                    <td className="text-right text-danger">{qtyText(s.totalOutQty)}</td>
                    <td className="text-right text-base font-extrabold">{qtyText(s.finalStock)}</td>
                  </tr>
                ))}
                {summary.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-ink-soft">
                      ยังไม่มีรายการ
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 🏬 เลือกคลังตอนสินค้าอยู่หลายคลัง (StockPickerWindow.ShowChoose) */}
      <Modal open={!!choose} title={choose?.result.title ?? ""} onClose={() => (setChoose(null), focusScan())}>
        <p className="mb-4 whitespace-pre-line text-sm font-semibold">{choose?.result.message}</p>
        <div className="grid gap-2">
          {choose?.result.candidates?.map((c) => (
            <button
              key={c.stkId}
              className="flex items-center justify-between rounded-xl border-2 border-line p-4 text-left hover:border-accent hover:bg-surface-2"
              onClick={() => {
                const p = { ...choose.pending, chosenStockId: c.stkId };
                setChoose(null);
                send(p);
              }}
            >
              <span className="text-lg font-extrabold text-primary">{c.code}</span>
              <span className="text-sm text-ink-soft">{c.name}</span>
            </button>
          ))}
        </div>
      </Modal>

      {/* 🔢 กรอกจำนวน (เศษ / คืนเหล็ก) */}
      <Modal
        open={!!qtyAsk}
        title={qtyAsk?.result.title ?? ""}
        onClose={() => (setQtyAsk(null), focusScan())}
        footer={
          <>
            <button className="btn-ghost" onClick={() => (setQtyAsk(null), focusScan())}>
              CANCEL
            </button>
            <button className="btn bg-success" form="qty-form">
              CONFIRM
            </button>
          </>
        }
      >
        <form
          id="qty-form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = Number(qtyValue);
            if (!Number.isFinite(v) || v <= 0) return toast.show("WARNING", "กรุณากรอกจำนวนที่มากกว่า 0", "warn");
            if (!qtyAsk!.result.qtyDecimal && !Number.isInteger(v)) return toast.show("WARNING", "คลังนี้กรอกได้เฉพาะจำนวนเต็ม", "warn");
            const p = { ...qtyAsk!.pending, enteredQty: v };
            setQtyAsk(null);
            send(p);
          }}
        >
          <p className="mb-4 whitespace-pre-line text-sm font-semibold">{qtyAsk?.result.message}</p>
          <input
            autoFocus
            className="field h-14 text-center text-2xl"
            inputMode="decimal"
            value={qtyValue}
            onChange={(e) => setQtyValue(e.target.value.replace(/[^0-9.]/g, ""))}
          />
        </form>
      </Modal>

      {/* ⛔ ยังไม่ได้กำหนดคลังสแกน */}
      <Modal open={locked !== null} title="NO SCAN STOCK" onClose={() => setLocked(null)}>
        <p className="whitespace-pre-line text-sm font-semibold">{locked || "ยังไม่ได้กำหนดคลังสแกน กรุณาติดต่อ Admin"}</p>
      </Modal>

      {showScope && (
        <ScopeModal
          ctx={ctx}
          onClose={() => (setShowScope(false), focusScan())}
          onSaved={async (serialized) => {
            try {
              localStorage.setItem(SCOPE_KEY, serialized);
            } catch {}
            setShowScope(false);
            await loadContext();
            sigRef.current = null;
            await loadToday(false);
            focusScan();
          }}
        />
      )}
      {showDisplay && (
        <DisplayModal
          onClose={() => (setShowDisplay(false), focusScan())}
          onSaved={async () => {
            setShowDisplay(false);
            await loadContext();
            sigRef.current = null;
            await loadToday(false);
            focusScan();
          }}
        />
      )}
      {showHistory && <HistoryModal onClose={() => (setShowHistory(false), focusScan())} />}
      {deductView && (
        <DeductModal
          deducted={deductView === "deducted"}
          onClose={() => (setDeductView(null), focusScan())}
          onChanged={() => {
            loadContext().catch(() => {});
            sigRef.current = null;
            loadToday(false).catch(() => {});
          }}
        />
      )}
      {showAdjust && (
        <AdjustModal
          onClose={() => (setShowAdjust(false), focusScan())}
          onChanged={() => {
            sigRef.current = null;
            loadToday(false).catch(() => {});
          }}
        />
      )}
    </div>
  );
}

function Banner({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg px-4 py-2 text-center text-sm font-extrabold text-white" style={{ background: color }}>
      {children}
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = { IN: "var(--success)", OUT: "var(--scanout)", RETURN: "var(--return)", TEST: "var(--warning)" };

function StatusPill({ status, deduct }: { status: string; deduct: boolean }) {
  return (
    <span className="rounded-md px-2 py-0.5 text-xs font-extrabold text-white" style={{ background: deduct ? "var(--danger)" : STATUS_COLOR[status] ?? "var(--primary)" }}>
      {deduct ? "OUT (DEDUCT)" : status}
    </span>
  );
}
