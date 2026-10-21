"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/Toasts";
import { useDialogs } from "@/components/ui/Dialogs";
import { Badge, Empty, Loading, PageBody, PageHeader, SearchBox, Stat } from "@/components/ui/Page";
import { api, download, upload } from "@/lib/api";
import { qty } from "@/lib/format";
import { useDebounced } from "@/lib/useDebounced";
import { STATUS_COLOR, type Counts, type Product, type Stock } from "./types";

type Meta = {
  stock: Stock;
  columns: string[];
  coilRowOrder: string[];
  allLabel: string;
  groupLabel: string;
  categories: string[];
  counts: Counts;
  canEdit: boolean;
  canImport: boolean;
  hasCoilRegister: boolean;
};
type CoilRow = { coilId: number; isMother: boolean; no: number; coilNo: string; motherCoil: string; weightKG: number; ton: number; labelDate: string; received: string };
type Field = "max" | "min" | "qty" | "stockBox" | "stockPcs" | "remark";

const PAGE = 100;

// 📋 ตารางของคลัง (StoreMaxMinView): กรองสถานะ / กลุ่ม / ค้นหา, แก้ในตาราง, แถว Coil, Import / Export, SHOW PRODUCTION / SHOW CARDS
export function StockTable({ stkId, onBack, initialFilter = "" }: { stkId: number; onBack: () => void; initialFilter?: string }) {
  const toast = useToast();
  const dlg = useDialogs();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [rows, setRows] = useState<Product[] | null>(null);
  const [more, setMore] = useState(true);
  const [key, setKey] = useState("");
  const [cat, setCat] = useState("");
  const [filter, setFilter] = useState(["OVER_MAX", "UNDER_MIN", "NO_ORDER"].includes(initialFilter) ? initialFilter : "");
  const [production, setProduction] = useState(false);
  const [cards, setCards] = useState(false);
  const [speed, setSpeed] = useState(12);
  const [coils, setCoils] = useState<Record<number, CoilRow[] | "loading">>({});
  const [busy, setBusy] = useState(false);
  const k = useDebounced(key, 350);
  const tokenRef = useRef<string | null>(null);
  const editingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const loadingMore = useRef(false);
  const verRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadMeta = useCallback(async () => {
    try {
      const m = await api<Meta>(`/store/${stkId}`);
      setMeta(m);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
      onBack();
    }
  }, [stkId, toast, onBack]);

  const query = useCallback(
    (skip: number, take: number) => api<{ token: string | null; rows: Product[] }>(`/store/${stkId}/products`, { query: { key: k, cat, filter, skip, take } }),
    [stkId, k, cat, filter],
  );

  // โหลดใหม่ทั้งชุด (เปลี่ยนตัวกรอง / SHOW PRODUCTION = ทุกรายการ)
  const reload = useCallback(async () => {
    const v = ++verRef.current;
    try {
      const r = await query(0, production || cards ? 100000 : PAGE);
      if (v !== verRef.current) return;
      setRows(r.rows);
      setMore(!(production || cards) && r.rows.length >= PAGE);
      tokenRef.current = r.token;
    } catch (e) {
      if (v === verRef.current) toast.show("ERROR", "โหลดข้อมูลคลังไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }, [query, production, cards, toast]);

  useEffect(() => {
    const t = setTimeout(loadMeta, 0);
    return () => clearTimeout(t);
  }, [loadMeta]);

  useEffect(() => {
    const t = setTimeout(reload, 0);
    return () => clearTimeout(t);
  }, [reload]);

  // เลื่อนถึงท้ายตาราง -> โหลดเพิ่ม
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more) return;
    const io = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting || loadingMore.current || !rows) return;
      loadingMore.current = true;
      const v = verRef.current;
      try {
        const r = await query(rows.length, PAGE);
        if (v !== verRef.current) return;
        setRows((cur) => [...(cur ?? []), ...r.rows]);
        setMore(r.rows.length >= PAGE);
      } finally {
        loadingMore.current = false;
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [more, rows, query]);

  // ⚡ เรียลไทม์ทุก 3 วินาที: ถามว่าเปลี่ยนไหม -> เปลี่ยนเฉพาะตัวเลขของแถวที่แสดง (ไม่ทับช่องที่กำลังแก้)
  useEffect(() => {
    const t = setInterval(async () => {
      if (document.hidden || editingRef.current || !rows) return;
      try {
        const r = await api<{ token: string; changed: boolean; counts: Counts; rows?: Partial<Product>[] }>(`/store/${stkId}/numbers`, { query: { token: tokenRef.current } });
        tokenRef.current = r.token;
        if (!r.changed || !r.rows) return;
        const map = new Map(r.rows.map((x) => [x.partId, x]));
        setRows((cur) => cur?.map((p) => ({ ...p, ...(map.get(p.partId) ?? {}) })) ?? cur);
        setMeta((m) => (m ? { ...m, counts: r.counts } : m));
      } catch {
        /* รอบหน้าลองใหม่ */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [stkId, rows]);

  // 🔁 SHOW PRODUCTION: เลื่อนตารางลงเรื่อย ๆ ถึงท้ายแล้ววนกลับต้น (หยุดเมื่อเมาส์อยู่บนตาราง)
  useEffect(() => {
    if (!production) return;
    let raf = 0;
    let last = performance.now();
    let hover = false;
    const el = scrollRef.current;
    const enter = () => (hover = true);
    const leave = () => (hover = false);
    el?.addEventListener("mouseenter", enter);
    el?.addEventListener("mouseleave", leave);
    let acc = 0;
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (el && !hover) {
        acc += speed * dt;
        if (acc >= 1) {
          el.scrollTop += Math.floor(acc);
          acc -= Math.floor(acc);
        }
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) el.scrollTop = 0;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      el?.removeEventListener("mouseenter", enter);
      el?.removeEventListener("mouseleave", leave);
    };
  }, [production, speed]);

  const groups = useMemo(() => {
    const g: { key: string; items: Product[] }[] = [];
    for (const p of rows ?? []) {
      const gk = p.groupKey || "-";
      const last = g[g.length - 1];
      if (last && last.key === gk) last.items.push(p);
      else g.push({ key: gk, items: [p] });
    }
    return g;
  }, [rows]);

  if (!meta) return <Loading />;
  const s = meta.stock;

  // คอลัมน์ที่แสดงจริง (BOX / COIL ใช้ช่องเดียวกัน = STOCK (BOX) หรือ STOCK (COIL))
  const cols = meta.columns.filter((c, i, a) => !(c === "COIL" && a.includes("BOX")) && !(c === "BOX" && a.indexOf("COIL") > -1 && a.indexOf("COIL") < i));
  const header = (c: string) =>
    ({ NO: "NO.", IMAGE: "IMAGE", CUSTOMER: "CUSTOMER", CODE: "PD CODE", PARTA: "PART A", PARTB: "PART B", PARTNO: "PART NO", MODEL: "MODEL", NAME: "PRODUCT NAME", QTY: s.qtyHeader, BOX: s.boxHeader, COIL: s.boxHeader, PCS: "STOCK (PCS)", REMARK: "REMARK" })[c] ?? c;
  const width = cols.reduce((a, c) => a + (c === "MAXMIN" ? 2 : 1), 0) + (s.useMaxMin ? 0 : 0);

  async function save(p: Product, field: Field, value: string) {
    const original = { partCode: p.partCode, remark: p.remark, max: p.max, min: p.min, qty: p.qty, stockBox: p.stockBox, stockPcs: p.stockPcs };
    if ((original[field] ?? "") === value) return;
    const next = { ...original, [field]: value };
    setRows((cur) => cur?.map((x) => (x.partId === p.partId ? { ...x, [field]: value } : x)) ?? cur);
    try {
      await api(`/store/${stkId}/products/${p.partId}`, { method: "PUT", body: { ...next, original } });
      tokenRef.current = null; // ดึงตัวเลขล่าสุด (BOX / PCS คำนวณใหม่ใน SQL)
    } catch (e) {
      toast.show("ERROR", "ไม่สามารถบันทึกข้อมูลได้\n" + (e as Error).message, "error");
      reload();
    }
  }

  async function toggleCoils(p: Product) {
    if (!s.showCoilRows || !meta?.hasCoilRegister) return;
    if (coils[p.partId]) {
      setCoils((c) => {
        const n = { ...c };
        delete n[p.partId];
        return n;
      });
      return;
    }
    setCoils((c) => ({ ...c, [p.partId]: "loading" }));
    try {
      const r = await api<CoilRow[]>(`/store/${stkId}/coils/${p.partId}`);
      setCoils((c) => ({ ...c, [p.partId]: r }));
    } catch {
      setCoils((c) => ({ ...c, [p.partId]: [] }));
    }
  }

  async function doImport(file: File) {
    setBusy(true);
    try {
      const pv = await upload<{ id: string; kind: string; summary: string }>(`/store/${stkId}/import`, file);
      if (!(await dlg.confirm({ title: "CONFIRM IMPORT", message: pv.summary, ok: "IMPORT" }))) return;
      const r = await api<{ message: string }>(`/store/${stkId}/import/apply`, { method: "POST", body: { id: pv.id, kind: pv.kind } });
      await dlg.alert({ title: "IMPORT", message: r.message });
      reload();
      loadMeta();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function template(coil: boolean) {
    const ok = await dlg.confirm({
      title: "TEMPLATE EXCEL",
      ok: "YES",
      message: coil
        ? `ต้องการสร้างไฟล์ Template สำหรับนำเข้า COIL LIST ของคลัง ${s.code} ใช่หรือไม่?\n\n• กรอก PRODUCT CODE / MASTER COIL / COIL NO / WEIGHT (KG.) ของ Coil ลูกแต่ละม้วน\n• นำเข้ากลับด้วยปุ่ม IMPORT EXCEL`
        : `ต้องการสร้างไฟล์ Template สำหรับ IMPORT EXCEL ของคลัง ${s.code} ใช่หรือไม่?\n\n• คอลัมน์ตามที่ ${s.code} แสดงในหน้านี้ + ข้อมูลสินค้าปัจจุบันใส่ไว้ให้แล้ว\n${s.countCoil ? "• คลังนับ Coil: 1 แถว = 1 Coil (เลข Coil / Master Coil / น้ำหนัก)\n" : ""}• แก้ตัวเลข / เพิ่มสินค้าใหม่ แล้วนำเข้ากลับด้วยปุ่ม IMPORT EXCEL`,
    });
    if (!ok) return;
    try {
      await download(`/store/${stkId}/template`, { coil });
    } catch (e) {
      toast.show("ERROR", "สร้างไฟล์ Template ไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }

  const c = meta.counts;
  const editable = (f: Field) => (f === "remark" ? !s.isLiveView : meta.canEdit);

  const cell = (p: Product, col: string, no: number) => {
    switch (col) {
      case "NO":
        return <td key={col} className="text-center text-ink-soft">{no}</td>;
      case "IMAGE":
        return (
          <td key={col} className="w-20">
            {p.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.imageUrl} alt="" loading="lazy" className="h-14 w-14 rounded-lg bg-surface-2 object-contain" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
            ) : (
              <div className="grid h-14 w-14 place-items-center rounded-lg bg-surface-2 text-line">▣</div>
            )}
          </td>
        );
      case "CODE":
        return (
          <td key={col} className="whitespace-nowrap">
            <button
              className={`flex items-center gap-2 font-extrabold ${s.showCoilRows && meta.hasCoilRegister ? "text-accent hover:underline" : "cursor-default text-primary"}`}
              onClick={() => toggleCoils(p)}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR(p.stockStatus) }} />
              {p.partCode}
              {s.showCoilRows && meta.hasCoilRegister && <span className="text-[10px]">{coils[p.partId] ? "▲" : "▼"}</span>}
            </button>
          </td>
        );
      case "CUSTOMER":
        return <td key={col}>{p.customer}</td>;
      case "PARTA":
        return <td key={col}>{p.partA}</td>;
      case "PARTB":
        return <td key={col}>{p.partB}</td>;
      case "PARTNO":
        return <td key={col}>{p.partNo}</td>;
      case "MODEL":
        return <td key={col}>{p.model}</td>;
      case "NAME":
        return <td key={col} className="min-w-[240px]">{p.partName}</td>;
      case "MAXMIN":
        return (
          <Fragment key={col}>
            <Edit value={p.max} align="right" disabled={!editable("max")} onEditing={(v) => (editingRef.current = v)} onSave={(v) => save(p, "max", v)} />
            <Edit value={p.min} align="right" disabled={!editable("min")} onEditing={(v) => (editingRef.current = v)} onSave={(v) => save(p, "min", v)} />
          </Fragment>
        );
      case "QTY":
        return (
          <Edit
            key={col}
            value={p.qty}
            align="right"
            strong
            color={STATUS_COLOR(p.stockStatus)}
            disabled={!editable("qty")}
            onEditing={(v) => (editingRef.current = v)}
            onSave={(v) => save(p, "qty", v)}
          />
        );
      case "BOX":
      case "COIL":
        return <Edit key={col} value={p.stockBox} align="right" disabled={!editable("stockBox")} onEditing={(v) => (editingRef.current = v)} onSave={(v) => save(p, "stockBox", v)} />;
      case "PCS":
        return <Edit key={col} value={p.stockPcs} align="right" disabled={!editable("stockPcs")} onEditing={(v) => (editingRef.current = v)} onSave={(v) => save(p, "stockPcs", v)} />;
      case "REMARK":
        return <Edit key={col} value={p.remark} wide disabled={!editable("remark")} onEditing={(v) => (editingRef.current = v)} onSave={(v) => save(p, "remark", v)} />;
      default:
        return <td key={col} />;
    }
  };

  const filterBtn = (f: string) => () => setFilter((cur) => (cur === f ? "" : f));
  const coilCols = meta.coilRowOrder;

  return (
    <PageBody>
      <PageHeader
        icon="/icons/StoreMaxMin.png"
        title={
          <span className="flex flex-wrap items-center gap-2">
            <button className="rounded-lg px-2 text-base text-ink-soft hover:bg-surface-2" onClick={onBack} title="กลับไปหน้าเลือกคลัง">
              ←
            </button>
            {s.code}
            {s.isMain && <Badge>MAIN</Badge>}
          </span>
        }
        subtitle={`${s.name} • ${s.unitDisplay}${meta.canEdit ? "" : " • ดู / แก้ REMARK เท่านั้น"}`}
        actions={
          <>
            <button className="btn bg-success" onClick={() => download(`/store/${stkId}/export`, { key: k, cat, filter }).catch((e) => toast.show("ERROR", e.message, "error"))}>
              📤 EXPORT
            </button>
            {meta.canImport && (
              <>
                <button className="btn bg-info" disabled={busy} onClick={() => fileRef.current?.click()}>
                  {busy ? "⏳ IMPORTING..." : "📥 IMPORT EXCEL"}
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
                <button className="btn-ghost" onClick={() => template(false)}>
                  📄 TEMPLATE
                </button>
                {s.countCoil && meta.hasCoilRegister && (
                  <button className="btn-ghost" onClick={() => template(true)}>
                    🧲 COIL TEMPLATE
                  </button>
                )}
              </>
            )}
          </>
        }
      />

      {c && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="TOTAL ITEMS" value={c.total.toLocaleString()} onClick={() => setFilter("")} active={filter === ""} />
          <Stat label="MAX STOCK" tone="success" value={c.max.toLocaleString()} onClick={filterBtn("OVER_MAX")} active={filter === "OVER_MAX"} hint="ถึง MAX / เกิน" />
          <Stat label="MIN STOCK" tone="danger" value={c.min.toLocaleString()} onClick={filterBtn("UNDER_MIN")} active={filter === "UNDER_MIN"} hint="ต่ำกว่า MIN / หมด" />
          <Stat label={s.thirdButtonText} tone="warning" value={c.noOrder.toLocaleString()} onClick={filterBtn("NO_ORDER")} active={filter === "NO_ORDER"} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line/60 bg-surface p-3 shadow-sm">
        <SearchBox className="min-w-[220px] flex-1" value={key} onChange={setKey} placeholder="ค้นหา PD CODE / ชื่อสินค้า / PART A / Coil" />
        <select className="field w-auto" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">{meta.allLabel}</option>
          {meta.categories.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <button className="btn-ghost" onClick={() => (setKey(""), setCat(""), setFilter(""))}>
          SHOW ALL
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {s.cardStyle !== "OFF" && (
            <label className="flex items-center gap-2 text-xs font-extrabold">
              <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={cards} onChange={(e) => setCards(e.target.checked)} /> SHOW CARDS
            </label>
          )}
          <label className="flex items-center gap-2 text-xs font-extrabold">
            <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={production} onChange={(e) => setProduction(e.target.checked)} /> SHOW PRODUCTION
          </label>
          {production && (
            <input
              className="field w-20 py-1 text-center"
              title="ความเร็ว (พิกเซล / วินาที)"
              inputMode="numeric"
              value={speed}
              onChange={(e) => setSpeed(Math.min(200, Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1)))}
            />
          )}
        </div>
      </div>

      {cards && rows && <CardStrip rows={rows} withImage={s.cardStyle === "IMAGE"} unit={s.unitDisplay} />}

      <div ref={scrollRef} className={`overflow-auto rounded-2xl border border-line/60 bg-surface shadow-sm ${production ? "max-h-[75vh] [scrollbar-width:none]" : "max-h-[calc(100dvh-330px)] min-h-[320px]"}`}>
        {!rows ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty />
        ) : (
          <table className="data-table w-full">
            <thead className="sticky top-0 z-10">
              <tr>
                {cols.map((col) =>
                  col === "MAXMIN" ? (
                    <Fragment key={col}>
                      <th className="text-right">{s.maxHeader}</th>
                      <th className="text-right">{s.minHeader}</th>
                    </Fragment>
                  ) : (
                    <th key={col} className={["QTY", "BOX", "COIL", "PCS"].includes(col) ? "text-right" : ""}>
                      {header(col)}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.key}>
                  <tr>
                    <td colSpan={width} className="bg-surface-2 text-xs font-extrabold uppercase text-accent">
                      {meta.groupLabel} : {g.key} <span className="text-ink-soft">({g.items.length.toLocaleString()} ITEMS)</span>
                    </td>
                  </tr>
                  {g.items.map((p, i) => (
                    <Fragment key={p.partId}>
                      <tr>{cols.map((col) => cell(p, col, i + 1))}</tr>
                      {coils[p.partId] && (
                        <tr>
                          <td colSpan={width} className="bg-[#f8f6fd] p-0">
                            {coils[p.partId] === "loading" ? (
                              <div className="p-3 text-xs text-ink-soft">⏳ LOADING COILS...</div>
                            ) : (coils[p.partId] as CoilRow[]).length === 0 ? (
                              <div className="p-3 text-xs text-ink-soft">ไม่มี Coil ในคลังนี้</div>
                            ) : (
                              <table className="w-full text-xs">
                                <tbody>
                                  {(coils[p.partId] as CoilRow[]).map((r) => (
                                    <tr key={r.coilId + (r.isMother ? "m" : "c")} className={r.isMother ? "bg-[#efe9fb] font-extrabold text-accent" : "text-ink-soft"}>
                                      <td className="w-10 px-3 py-1.5 text-right">{r.isMother ? "" : r.no}</td>
                                      {coilCols.map((cc) => (
                                        <td key={cc} className="px-3 py-1.5">
                                          {cc === "COILNO" && (r.isMother ? `MASTER ${r.coilNo}` : `↳ ${r.coilNo}`)}
                                          {cc === "MOTHER" && (r.motherCoil || "-")}
                                          {cc === "WEIGHT" && `${qty(r.weightKG)} KG`}
                                          {cc === "COIL" && (r.isMother ? "" : "1")}
                                          {cc === "TON" && `${qty(Math.round(r.ton * 1000) / 1000)} TON`}
                                          {cc === "RECEIVED" && r.received}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
        {more && <div ref={sentinel} className="py-4 text-center text-xs text-ink-soft">⏳ LOADING MORE...</div>}
      </div>
    </PageBody>
  );
}

// ✏️ ช่องที่แก้ในตาราง: คลิก -> พิมพ์ -> Enter / ออกจากช่อง = บันทึก, Esc = ยกเลิก
function Edit({
  value,
  onSave,
  onEditing,
  disabled,
  align,
  strong,
  color,
  wide,
}: {
  value: string;
  onSave: (v: string) => void;
  onEditing: (v: boolean) => void;
  disabled?: boolean;
  align?: "right";
  strong?: boolean;
  color?: string;
  wide?: boolean;
}) {
  const [edit, setEdit] = useState<string | null>(null);
  const done = (commit: boolean) => {
    if (edit !== null && commit) onSave(edit.trim());
    setEdit(null);
    onEditing(false);
  };
  if (edit !== null)
    return (
      <td className="p-1">
        <input
          autoFocus
          className={`field py-1 ${align === "right" ? "text-right" : ""} ${wide ? "min-w-[180px]" : "w-24"}`}
          value={edit}
          onChange={(e) => setEdit(e.target.value)}
          onBlur={() => done(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") done(true);
            if (e.key === "Escape") done(false);
          }}
        />
      </td>
    );
  return (
    <td
      className={`${align === "right" ? "text-right" : ""} ${disabled ? "" : "cursor-text hover:bg-accent-soft/40"} ${strong ? "text-base font-extrabold" : ""} ${wide ? "min-w-[160px]" : "whitespace-nowrap"}`}
      style={color ? { color } : undefined}
      title={disabled ? undefined : "คลิกเพื่อแก้ไข"}
      onClick={() => {
        if (disabled) return;
        onEditing(true);
        setEdit(value ?? "");
      }}
    >
      {value || (disabled ? "-" : <span className="text-line">-</span>)}
    </td>
  );
}

// 🃏 การ์ดสินค้าเลื่อนวน (SHOW CARDS) - มีรูป / ไม่มีรูป (ตัวเลขใหญ่) ตามที่คลังตั้ง
function CardStrip({ rows, withImage, unit }: { rows: Product[]; withImage: boolean; unit: string }) {
  const list = rows.slice(0, 400);
  const dur = Math.max(30, list.length * 3);
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-line/60 bg-surface py-3 shadow-sm">
      <div className="flex w-max gap-3 px-3 group-hover:[animation-play-state:paused]" style={{ animation: `chr-marquee ${dur}s linear infinite` }}>
        {[...list, ...list].map((p, i) => (
          <div key={i} className="flex w-56 shrink-0 gap-3 rounded-xl border-l-8 bg-surface-2 p-3" style={{ borderColor: STATUS_COLOR(p.stockStatus) }}>
            {withImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.imageUrl ?? "/icons/CIMS.png"} alt="" loading="lazy" className="h-16 w-16 shrink-0 rounded-lg bg-surface object-contain" />
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-extrabold text-primary">{p.partCode}</div>
              {withImage && <div className="truncate text-[11px] text-ink-soft">{p.partName}</div>}
              <div className="mt-1 text-xl font-extrabold" style={{ color: STATUS_COLOR(p.stockStatus) }}>
                {p.qty || "0"} <span className="text-[10px] text-ink-soft">{unit}</span>
              </div>
              <div className="text-[10px] font-bold text-ink-soft">
                MAX {p.max || "-"} • MIN {p.min || "-"}
              </div>
            </div>
          </div>
        ))}
      </div>
      <style>{`@keyframes chr-marquee { from { transform: translateX(0) } to { transform: translateX(-50%) } }`}</style>
    </div>
  );
}
