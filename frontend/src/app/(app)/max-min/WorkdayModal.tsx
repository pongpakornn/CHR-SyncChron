"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toasts";
import { useDialogs } from "@/components/ui/Dialogs";
import { Empty, Loading } from "@/components/ui/Page";
import { api, download, upload } from "@/lib/api";
import { isoDate } from "@/lib/format";

type Customer = { customer: string; yearDays: number; monthsSet: number };
const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
const DOW = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

const daysIn = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
const key = (y: number, m: number, d: number) => isoDate(new Date(y, m, d));

// 📅 วันทำงานของลูกค้า (WorkdayWindow): การ์ดลูกค้า -> ปฏิทิน 12 เดือน (กดวัน = วันทำงาน / กดซ้ำ = ยกเลิก บันทึกทันที)
export function WorkdayModal({ open, canEdit, onClose, onChanged }: { open: boolean; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const dlg = useDialogs();
  const [year, setYear] = useState(new Date().getFullYear());
  const [customer, setCustomer] = useState<string | null>(null);
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [days, setDays] = useState<Set<string> | null>(null);
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const monthRefs = useRef<(HTMLDivElement | null)[]>([]);
  const today = isoDate(new Date());

  const loadCustomers = useCallback(async () => {
    setCustomers(null);
    try {
      setCustomers(await api<Customer[]>("/maxmin/workdays/customers", { query: { year } }));
    } catch (e) {
      toast.show("ERROR", "โหลดรายชื่อลูกค้าไม่สำเร็จ\n" + (e as Error).message, "error");
      setCustomers([]);
    }
  }, [year, toast]);

  const loadDays = useCallback(async () => {
    if (!customer) return;
    setDays(null);
    try {
      setDays(new Set(await api<string[]>("/maxmin/workdays", { query: { customer, year } })));
    } catch (e) {
      toast.show("ERROR", "โหลดวันทำงานไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }, [customer, year, toast]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => (customer ? loadDays() : loadCustomers()), 0);
    return () => clearTimeout(t);
  }, [open, customer, loadDays, loadCustomers]);

  // ปีปัจจุบัน -> เลื่อนไปที่เดือนนี้ให้เลย
  useEffect(() => {
    if (!days || year !== new Date().getFullYear()) return;
    monthRefs.current[new Date().getMonth()]?.scrollIntoView({ block: "nearest" });
  }, [days, year]);

  async function save(dates: string[], working: boolean) {
    if (dates.length === 0) return true;
    try {
      const r = await api<{ saved: string }>("/maxmin/workdays", { method: "POST", body: { customer, dates, working } });
      setSaved("✓ SAVED " + r.saved);
      onChanged();
      return true;
    } catch (e) {
      toast.show("Save failed", (e as Error).message, "error");
      return false;
    }
  }

  async function toggle(k: string) {
    if (!canEdit || !days) return;
    const on = !days.has(k);
    const next = new Set(days);
    if (on) next.add(k);
    else next.delete(k);
    setDays(next);
    if (!(await save([k], on)))
      setDays((cur) => {
        const s = new Set(cur);
        if (on) s.delete(k);
        else s.add(k);
        return s;
      });
  }

  // MON-FRI = วันจันทร์ - ศุกร์เป็นวันทำงาน / CLEAR = ล้างทั้งเดือน
  async function setMonth(m: number, weekdaysOnly: boolean) {
    if (!days) return;
    const before = days;
    const all = Array.from({ length: daysIn(year, m) }, (_, i) => new Date(year, m, i + 1));
    const toClear = all.map(isoDate).filter((k) => days.has(k));
    const toSet = weekdaysOnly ? all.filter((d) => d.getDay() !== 0 && d.getDay() !== 6).map(isoDate) : [];
    const next = new Set(days);
    toClear.forEach((k) => next.delete(k));
    toSet.forEach((k) => next.add(k));
    setDays(next);
    let ok = await save(toClear, false);
    if (ok && toSet.length) ok = await save(toSet, true);
    if (!ok) setDays(before);
  }

  async function template() {
    const who = customer ?? "ทุกลูกค้า";
    if (
      !(await dlg.confirm({
        title: "TEMPLATE EXCEL",
        ok: "YES",
        message: `ต้องการสร้างไฟล์ Template สำหรับ IMPORT WORKDAYS (${who} ปี ${year}) ใช่หรือไม่?\n\n• 1 แถว = 1 วันทำงาน (CUSTOMER / DATE) - วันทำงานที่มีอยู่แล้วใส่ไว้ให้\n• แก้แล้วนำเข้ากลับด้วยปุ่ม IMPORT WORKDAYS`,
      }))
    )
      return;
    download("/maxmin/workdays/template", { year, customer: customer ?? undefined }).catch((e) => toast.show("ERROR", e.message, "error"));
  }

  async function doImport(file: File) {
    setBusy(true);
    try {
      const r = await upload<{ message: string }>("/maxmin/workdays/import", file);
      toast.show("Workdays imported", r.message, "ok");
      onChanged();
      if (customer) await loadDays();
      else await loadCustomers();
    } catch (e) {
      toast.show("Import failed", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const countMonth = (m: number) => (days ? [...days].filter((k) => k.startsWith(`${year}-${String(m + 1).padStart(2, "0")}`)).length : 0);
  const total = days ? [...days].filter((k) => k.startsWith(`${year}-`)).length : 0;

  return (
    <Modal
      open={open}
      wide
      title={customer ? `📅 ${customer}` : "📅 CUSTOMER WORKDAYS"}
      onClose={onClose}
      footer={
        <>
          {customer && days && <span className="mr-auto text-sm font-extrabold text-primary">{`${total} WORKDAYS IN ${year}`}</span>}
          {saved && <span className="text-xs font-bold text-success">{saved}</span>}
          <button className="btn-ghost" onClick={onClose}>
            CLOSE
          </button>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {customer && (
          <button className="btn-ghost" onClick={() => setCustomer(null)}>
            ← BACK
          </button>
        )}
        <div className="flex items-center gap-1 rounded-xl border border-line p-1">
          <button className="btn-ghost border-0 px-3 py-1" onClick={() => setYear((y) => y - 1)} aria-label="Previous year">
            ◀
          </button>
          <span className="w-16 text-center text-lg font-extrabold text-primary">{year}</span>
          <button className="btn-ghost border-0 px-3 py-1" onClick={() => setYear((y) => y + 1)} aria-label="Next year">
            ▶
          </button>
        </div>
        <span className="text-xs font-semibold text-ink-soft">
          {customer ? (canEdit ? "Click a day = working day / click again = not working (saved automatically)" : "View only") : "Select a customer to set the working days of each month"}
        </span>
        {canEdit && (
          <div className="ml-auto flex gap-2">
            <button className="btn-ghost" onClick={template}>
              📄 TEMPLATE
            </button>
            <button className="btn bg-info" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? "⏳ IMPORTING..." : "📥 IMPORT WORKDAYS"}
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
          </div>
        )}
      </div>

      {!customer ? (
        !customers ? (
          <Loading />
        ) : customers.length === 0 ? (
          <Empty>NO CUSTOMER - add CUSTOMER to the products in Inventory Registration first.</Empty>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {customers.map((c) => (
              <button
                key={c.customer}
                onClick={() => {
                  setSaved("");
                  setCustomer(c.customer);
                }}
                className="overflow-hidden rounded-2xl border-2 border-line/60 bg-surface text-left shadow-sm transition hover:border-accent"
              >
                <div className={`h-1.5 ${c.monthsSet >= 12 ? "bg-primary" : "bg-accent"}`} />
                <div className="p-4">
                  <div className="truncate text-base font-extrabold text-primary">👥 {c.customer}</div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold text-accent">{c.yearDays.toLocaleString()}</span>
                    <span className="text-[11px] font-extrabold text-ink-soft">WORKDAYS {year}</span>
                  </div>
                  <span className="mt-1 inline-block rounded-lg bg-surface-2 px-2 py-0.5 text-[10px] font-extrabold text-primary">{c.monthsSet} / 12 MONTHS SET</span>
                </div>
              </button>
            ))}
          </div>
        )
      ) : !days ? (
        <Loading />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {MONTHS.map((name, m) => {
            const lead = new Date(year, m, 1).getDay();
            return (
              <div
                key={name}
                ref={(el) => {
                  monthRefs.current[m] = el;
                }}
                className="rounded-2xl border border-line/60 bg-surface p-3 shadow-sm"
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-extrabold text-primary">{name}</span>
                  <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-extrabold text-white">{countMonth(m)} DAYS</span>
                </div>
                {canEdit && (
                  <div className="mb-2 flex gap-1">
                    <button className="btn-ghost px-2 py-0.5 text-[10px]" title="Set Monday - Friday as working days" onClick={() => setMonth(m, true)}>
                      MON-FRI
                    </button>
                    <button className="btn-ghost px-2 py-0.5 text-[10px]" title="Clear this month" onClick={() => setMonth(m, false)}>
                      CLEAR
                    </button>
                  </div>
                )}
                <div className="grid grid-cols-7 gap-0.5 text-center">
                  {DOW.map((d) => (
                    <span key={d} className={`text-[10px] font-extrabold ${d === "SU" || d === "SA" ? "text-danger" : "text-ink-soft"}`}>
                      {d}
                    </span>
                  ))}
                  {Array.from({ length: lead }, (_, i) => (
                    <span key={`e${i}`} />
                  ))}
                  {Array.from({ length: daysIn(year, m) }, (_, i) => {
                    const k = key(year, m, i + 1);
                    const on = days.has(k);
                    const dow = (lead + i) % 7;
                    const weekend = dow === 0 || dow === 6;
                    return (
                      <button
                        key={k}
                        disabled={!canEdit}
                        title={new Date(year, m, i + 1).toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                        onClick={() => toggle(k)}
                        className={`h-7 rounded-lg text-xs font-bold transition disabled:cursor-default ${on ? "bg-accent text-white" : weekend ? "bg-surface-2 text-danger" : "bg-surface-2 text-ink"} ${k === today ? "ring-2 ring-primary" : ""}`}
                      >
                        {i + 1}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
