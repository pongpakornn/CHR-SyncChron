"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useDebounced } from "@/lib/useDebounced";

export type PartOption = { partId: number; partCode: string; partName: string; partA: string; category: string; packSize: number | null };

// 🔎 เลือกสินค้าในระบบ (พิมพ์ PD CODE / ชื่อ / PART A แล้วเลือก)
export function PartPicker({
  value,
  onChange,
  stkId,
  initialKey = "",
  placeholder = "พิมพ์ PD CODE / ชื่อสินค้า",
}: {
  value: PartOption | null;
  onChange: (p: PartOption | null) => void;
  stkId?: number;
  initialKey?: string;
  placeholder?: string;
}) {
  const [key, setKey] = useState(initialKey);
  const [list, setList] = useState<PartOption[]>([]);
  const [open, setOpen] = useState(false);
  const k = useDebounced(key, 250);

  useEffect(() => {
    if (!k.trim()) return;
    let alive = true;
    api<PartOption[]>("/lookup/parts", { query: { key: k, stkId } })
      .then((r) => alive && setList(r))
      .catch(() => alive && setList([]));
    return () => {
      alive = false;
    };
  }, [k, stkId]);

  if (value)
    return (
      <div className="flex items-center gap-3 rounded-xl border-2 border-success bg-[#e8f5e9] p-3">
        <div className="min-w-0 flex-1">
          <div className="font-extrabold text-primary">{value.partCode}</div>
          <div className="truncate text-sm">{value.partName}</div>
        </div>
        <button type="button" className="btn-ghost px-3 py-1" onClick={() => onChange(null)}>
          เปลี่ยน
        </button>
      </div>
    );

  return (
    <div className="relative">
      <input
        className="field"
        placeholder={placeholder}
        value={key}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setKey(e.target.value);
          setOpen(true);
        }}
      />
      {open && key.trim() && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-line bg-surface shadow-xl">
          {list.length === 0 && <div className="p-3 text-sm text-ink-soft">ไม่พบสินค้า</div>}
          {list.map((p) => (
            <button
              type="button"
              key={p.partId}
              className="block w-full border-b border-line/60 px-3 py-2 text-left hover:bg-surface-2"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(p);
                setOpen(false);
              }}
            >
              <div className="text-sm font-extrabold text-primary">
                {p.partCode} {p.partA && <span className="font-semibold text-ink-soft">• {p.partA}</span>}
              </div>
              <div className="truncate text-xs">{p.partName}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
