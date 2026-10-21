"use client";

import { daysAgo, monthStart, today } from "@/lib/format";

// FROM / TO + ปุ่มด่วน TODAY / 7 DAYS / THIS MONTH / ALL (แบบหน้า DEDUCTED เดิม)
export function DateRange({ from, to, onChange, quick = true }: { from: string; to: string; onChange: (from: string, to: string) => void; quick?: boolean }) {
  const t = today();
  const btn = (label: string, f: string) => (
    <button
      type="button"
      className={`rounded-lg px-2.5 py-1.5 text-xs font-extrabold ${from === f && to === t ? "bg-accent text-white" : "bg-surface-2 text-ink hover:bg-line"}`}
      onClick={() => onChange(f, t)}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="date" className="field w-auto" value={from} onChange={(e) => onChange(e.target.value, to)} />
      <span className="text-xs font-bold text-ink-soft">TO</span>
      <input type="date" className="field w-auto" value={to} onChange={(e) => onChange(from, e.target.value)} />
      {quick && (
        <div className="flex flex-wrap gap-1">
          {btn("TODAY", t)}
          {btn("7 DAYS", daysAgo(6))}
          {btn("THIS MONTH", monthStart())}
          {btn("ALL", "2000-01-01")}
        </div>
      )}
    </div>
  );
}
