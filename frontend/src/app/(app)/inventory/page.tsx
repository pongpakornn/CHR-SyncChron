"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toasts";
import { useDialogs } from "@/components/ui/Dialogs";
import { Badge, Card, Empty, Loading, PageBody, PageHeader, SearchBox } from "@/components/ui/Page";
import { QrImage } from "@/components/ui/QrImage";
import { api, download, upload } from "@/lib/api";
import { qty } from "@/lib/format";
import { useDebounced } from "@/lib/useDebounced";
import { AdminModal } from "./AdminModal";
import { EMPTY_FORM, formOf, type Form, type Layout, type Meta, type Part } from "./types";

const PAGE = 100;
type CoilRow = { coilId: number; isMother: boolean; no: number; coilNo: string; motherCoil: string; weightKG: number; ton: number; received: string };

// 🏷️ INVENTORY REGISTRATION (ProductControlView) - ฟอร์มลงทะเบียน / แก้ไข + ตารางสินค้าตามคลัง
export default function InventoryPage() {
  const toast = useToast();
  const dlg = useDialogs();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [filter, setFilter] = useState<number | null>(null);
  const [key, setKey] = useState("");
  const [rows, setRows] = useState<Part[] | null>(null);
  const [total, setTotal] = useState(0);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [coilStk, setCoilStk] = useState<number | null>(null);
  const [ticked, setTicked] = useState<number[]>([]);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [editId, setEditId] = useState<number | null>(null);
  const [viewId, setViewId] = useState<number | null>(null);
  const [oldCode, setOldCode] = useState<string | null>(null);
  const [inMain, setInMain] = useState(true);
  const [others, setOthers] = useState<number[]>([]);
  const [coilText, setCoilText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [coils, setCoils] = useState<Record<number, CoilRow[] | "loading">>({});
  const [admin, setAdmin] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [tplOptions, setTplOptions] = useState<{ stkId: number; code: string; name: string; heads: string; countCoil: boolean }[]>([]);
  const [exportOpen, setExportOpen] = useState<{ all: number } | null>(null);
  const [codeSuggest, setCodeSuggest] = useState<Part[]>([]);
  const k = useDebounced(key, 300);
  const codeKey = useDebounced(form.partCode, 300);
  const verRef = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);
  const loadingMore = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);

  // คลังที่ติ๊กไว้ตอนลงทะเบียนใหม่ = ค่าที่ผู้ใช้เลือกค้างไว้ ("main|id,id" / ยังไม่เคยเลือก = คลังหลัก)
  const applyDefaultStocks = useCallback((m: Meta) => {
    let main = true;
    const ids: number[] = [];
    if (m.savedStocks) {
      const [a, b] = m.savedStocks.split("|");
      main = a === "1";
      for (const t of (b ?? "").split(",")) {
        const id = Number(t);
        if (id && m.stocks.some((s) => s.stkId === id && !s.isMain)) ids.push(id);
      }
      if (!main && ids.length === 0) main = true;
    }
    setInMain(main);
    setOthers(ids);
  }, []);

  useEffect(() => {
    api<Meta>("/products/meta")
      .then((m) => {
        setMeta(m);
        setFilter(m.savedFilter);
        applyDefaultStocks(m);
      })
      .catch((e) => toast.show("ERROR", e.message, "error"));
  }, [toast, applyDefaultStocks]);

  const query = useCallback(
    (skip: number) => api<{ total: number; layout: Layout; coilStkId: number | null; rows: Part[] }>("/products", { query: { key: k, stkId: filter ?? undefined, skip, take: PAGE } }),
    [k, filter],
  );

  const reload = useCallback(async () => {
    if (!meta) return;
    const v = ++verRef.current;
    try {
      const r = await query(0);
      if (v !== verRef.current) return;
      setRows(r.rows);
      setTotal(r.total);
      setLayout(r.layout);
      setCoilStk(r.coilStkId);
      setTicked((t) => t.filter((id) => r.rows.some((x) => x.ptId === id)));
    } catch (e) {
      toast.show("ERROR", "โหลดข้อมูลไม่สำเร็จ: " + (e as Error).message, "error");
    }
  }, [meta, query, toast]);

  useEffect(() => {
    const t = setTimeout(reload, 0);
    return () => clearTimeout(t);
  }, [reload]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !rows || rows.length >= total) return;
    const io = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting || loadingMore.current) return;
      loadingMore.current = true;
      const v = verRef.current;
      try {
        const r = await query(rows.length);
        if (v === verRef.current) setRows((cur) => [...(cur ?? []), ...r.rows]);
      } finally {
        loadingMore.current = false;
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [rows, total, query]);

  // PRODUCT CODE: แนะนำสินค้าที่มีแล้ว (เลือก = ดึงข้อมูลทั้งหมดมาแก้)
  useEffect(() => {
    if (editId || codeKey.trim().length < 2) {
      queueMicrotask(() => setCodeSuggest([]));
      return;
    }
    let alive = true;
    api<{ rows: Part[] }>("/products", { query: { key: codeKey, take: 12 } })
      .then((r) => alive && setCodeSuggest(r.rows))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [codeKey, editId]);

  const groups = useMemo(() => {
    const g: { key: string; items: Part[] }[] = [];
    const none = layout?.groupBy === "NONE";
    const list = [...(rows ?? [])];
    if (!none) list.sort((a, b) => (a.groupKey ?? "").localeCompare(b.groupKey ?? ""));
    for (const p of list) {
      const gk = none ? "" : p.groupKey || "-";
      const last = g[g.length - 1];
      if (last && last.key === gk) last.items.push(p);
      else g.push({ key: gk, items: [p] });
    }
    return g;
  }, [rows, layout]);

  if (!meta) return <Loading />;
  const can = meta.can;
  const filterStock = meta.stocks.find((s) => s.stkId === filter) ?? null;
  const cols = layout?.columns ?? [];
  const label = (k: string) => meta.columns.find((c) => c.key === k)?.label ?? k;

  function clear() {
    setForm(EMPTY_FORM);
    setEditId(null);
    setViewId(null);
    setOldCode(null);
    setCoilText(null);
    if (meta) applyDefaultStocks(meta);
  }

  async function fill(p: Part, edit: boolean) {
    setForm(formOf(p));
    setViewId(p.ptId);
    setEditId(edit ? p.ptId : null);
    setOldCode(edit ? p.partCode : null);
    setCoilText(null);
    try {
      const d = await api<{ stockIds: number[]; coilText: string | null }>(`/products/${p.ptId}/detail`, { query: { code: p.partCode, stkId: filter ?? undefined } });
      setInMain(p.isShowMain);
      setOthers(d.stockIds);
      setCoilText(d.coilText);
    } catch {
      /* แสดงข้อมูลได้แม้โหลดคลังไม่สำเร็จ */
    }
  }

  async function changeFilter(v: number | null) {
    setFilter(v);
    setCoils({});
    api("/products/filter", { method: "POST", body: v }).catch(() => {});
  }

  function toggleStock(id: number | "main") {
    const nextMain = id === "main" ? !inMain : inMain;
    const nextOthers = id === "main" ? others : others.includes(id) ? others.filter((x) => x !== id) : [...others, id];
    setInMain(nextMain);
    setOthers(nextOthers);
    if (!editId && !viewId) api("/products/default-stocks", { method: "POST", body: `${nextMain ? "1" : "0"}|${nextOthers.join(",")}` }).catch(() => {});
  }

  async function save(isEdit: boolean) {
    if (!form.partCode.trim()) return toast.show("WARNING", "กรุณากรอกรหัสสินค้าก่อนทำการลงทะเบียนครับ", "warn");
    if (form.packSize.trim() && !/^\d+$/.test(form.packSize.trim())) return toast.show("WARNING", "PACKSIZE ต้องเป็นตัวเลขเท่านั้นครับ", "warn");
    if (!inMain && others.length === 0) return toast.show("WARNING", "กรุณาเลือกคลัง (STOCK) อย่างน้อย 1 คลังครับ", "warn");
    setBusy(true);
    try {
      const body = { ...form, inMain, otherStockIds: others, filterStkId: filter, oldCode };
      const r = await api<{ message: string }>(isEdit ? `/products/${editId}` : "/products", { method: isEdit ? "PUT" : "POST", body });
      await dlg.alert({ title: isEdit ? "SAVE CHANGES" : "REGISTER", message: r.message, tone: r.message.includes("⚠") ? "warn" : "ok" });
      clear();
      reload();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Part) {
    if (!(await dlg.confirm({ title: "CONFIRM", danger: true, ok: "DELETE", message: `ลบสินค้า: ${p.partName}?` }))) return;
    try {
      const r = await api<{ message: string }>(`/products/${p.ptId}/delete`, { method: "POST", body: { partCode: p.partCode, partName: p.partName } });
      toast.show("DELETE", r.message, "ok");
      if (viewId === p.ptId) clear();
      reload();
    } catch (e) {
      dlg.alert({ title: "DELETE", tone: "error", message: (e as Error).message });
    }
  }

  async function toggleShow(p: Part) {
    try {
      const r = await api<{ message: string }>(`/products/${p.ptId}/toggle`, { method: "POST", body: { partCode: p.partCode, partName: p.partName, show: !p.isShow, stkId: filter } });
      setRows((cur) => cur?.map((x) => (x.ptId === p.ptId ? { ...x, isShow: !p.isShow } : x)) ?? cur);
      toast.show("SHOW / HIDE", r.message, "ok");
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  async function uploadImage(file: File) {
    // คลังของรูป: คลังในช่องกรอง (ถ้าติ๊กไว้) > คลังแรกที่ติ๊ก > คลังในช่องกรอง > คลังหลัก
    const tickedStocks = meta!.stocks.filter((s) => (s.isMain ? inMain : others.includes(s.stkId)));
    const code =
      (filterStock && tickedStocks.some((s) => s.stkId === filterStock.stkId) ? filterStock.code : null) ??
      tickedStocks[0]?.code ??
      filterStock?.code ??
      meta!.stocks.find((s) => s.isMain)?.code ??
      "STOCK";
    try {
      const r = await upload<{ imageFileName: string; imageUrl: string }>("/products/image", file, { stockCode: code, current: form.imageFileName ?? "" });
      setForm((f) => ({ ...f, imageFileName: r.imageFileName, imageUrl: r.imageUrl }));
      toast.show("IMAGE", "อัปโหลดรูปภาพสำเร็จ (กด REGISTER / SAVE CHANGES เพื่อบันทึก)", "ok");
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  async function doImport(file: File) {
    setBusy(true);
    try {
      const pv = await upload<{ id: string; summary: string }>("/products/import", file);
      if (!(await dlg.confirm({ title: "CONFIRM IMPORT", message: pv.summary, ok: "IMPORT" }))) return;
      const r = await api<{ message: string }>("/products/import/apply", { method: "POST", body: pv.id });
      await dlg.alert({ title: "IMPORT", message: r.message });
      reload();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function openExport() {
    try {
      const r = await api<{ count: number }>("/products/count", { query: { stkId: filter ?? undefined } });
      setExportOpen({ all: r.count });
    } catch (e) {
      toast.show("ERROR", "โหลดรายการสินค้าไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }

  async function exportQr(mode: "SELECTED" | "ALL") {
    setExportOpen(null);
    if (mode === "SELECTED" && ticked.length === 0) return toast.show("WARNING", "กรุณาเลือกรายการที่ต้องการ Export อย่างน้อย 1 รายการครับ", "warn");
    try {
      await download("/products/export-qr", undefined, { mode, ids: ticked, stkId: filter, stockName: filterStock?.code ?? "ALL STOCKS" });
      toast.show("EXPORT QR", "ส่งออกไฟล์ QR เรียบร้อยแล้ว!", "ok");
    } catch (e) {
      toast.show("ERROR", "Export ไม่สำเร็จ: " + (e as Error).message, "error");
    }
  }

  async function toggleCoils(p: Part) {
    if (!coilStk || p.coilCount <= 0) return;
    if (coils[p.ptId]) {
      setCoils((c) => {
        const n = { ...c };
        delete n[p.ptId];
        return n;
      });
      return;
    }
    setCoils((c) => ({ ...c, [p.ptId]: "loading" }));
    try {
      const r = await api<CoilRow[]>(`/products/${p.ptId}/coils`, { query: { stkId: coilStk } });
      setCoils((c) => ({ ...c, [p.ptId]: r }));
    } catch {
      setCoils((c) => ({ ...c, [p.ptId]: [] }));
    }
  }

  const input = (label: string, k: keyof Form, opt: { list?: string; numeric?: boolean; placeholder?: string } = {}) => (
    <label className="block">
      <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">{label}</span>
      <input
        className="field"
        list={opt.list}
        inputMode={opt.numeric ? "numeric" : undefined}
        placeholder={opt.placeholder}
        value={(form[k] as string) ?? ""}
        onChange={(e) => setForm({ ...form, [k]: opt.numeric ? e.target.value.replace(/\D/g, "") : e.target.value })}
      />
    </label>
  );

  const cell = (p: Part, c: string) => {
    switch (c) {
      case "IMAGE":
        return (
          <td key={c}>
            {p.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.imageUrl} alt="" loading="lazy" className="h-12 w-12 rounded-lg bg-surface-2 object-contain" />
            ) : (
              <div className="grid h-12 w-12 place-items-center rounded-lg bg-surface-2 text-line">▣</div>
            )}
          </td>
        );
      case "SUPPLIER":
        return <td key={c}>{p.supplier}</td>;
      case "CUSTOMER":
        return <td key={c}>{p.customer}</td>;
      case "CATEGORY":
        return <td key={c}>{p.category}</td>;
      case "PARTA":
        return <td key={c}>{p.partA}</td>;
      case "PARTB":
        return <td key={c}>{p.partB}</td>;
      case "MODEL":
        return <td key={c}>{p.model}</td>;
      case "CODE":
        return (
          <td key={c} className="whitespace-nowrap">
            <button className={`font-extrabold ${coilStk && p.coilCount > 0 ? "text-accent hover:underline" : "cursor-default text-primary"}`} onClick={() => toggleCoils(p)}>
              {p.partCode} {coilStk && p.coilCount > 0 && <Badge color="var(--accent)">🧲 {p.coilCount}</Badge>}
            </button>
          </td>
        );
      case "PARTNO":
        return <td key={c}>{p.partNo}</td>;
      case "NAME":
        return <td key={c} className="min-w-[220px]">{p.partName}</td>;
      case "PACKSIZE":
        return <td key={c} className="text-right">{p.packSize}</td>;
      case "BIN":
        return <td key={c}>{p.location}</td>;
      case "MOTHER":
        return <td key={c} className="whitespace-pre-line text-xs">{p.motherCoil}</td>;
      case "COILNO":
        return <td key={c} className="whitespace-pre-line text-xs">{p.coilNo}</td>;
      case "QRCODE":
        return <td key={c} className="max-w-[160px] truncate font-mono text-xs" title={p.qrCodeData}>{p.qrCodeData}</td>;
      default:
        return <td key={c} />;
    }
  };

  const stockChip = (id: number | "main", text: string, on: boolean, title?: string) => (
    <button
      key={String(id)}
      type="button"
      title={title}
      onClick={() => toggleStock(id)}
      className={`rounded-full border px-3 py-1.5 text-xs font-extrabold ${on ? "border-accent bg-accent text-white" : "border-line bg-surface hover:border-accent"}`}
    >
      {text}
    </button>
  );

  const allTicked = (rows ?? []).length > 0 && (rows ?? []).every((r) => ticked.includes(r.ptId));
  const ncols = cols.length + 2;

  return (
    <PageBody>
      <PageHeader
        icon="/icons/InventoryRegistration.png"
        title="INVENTORY REGISTRATION"
        subtitle="ลงทะเบียนสินค้า / แก้ไข / QR CODE"
        actions={
          <>
            {can.add && (
              <>
                <button
                  className="btn-ghost"
                  onClick={async () => {
                    setTplOptions(await api("/products/template/options"));
                    setTplOpen(true);
                  }}
                >
                  📄 TEMPLATE
                </button>
                <button className="btn bg-info" disabled={busy} onClick={() => fileRef.current?.click()}>
                  📥 IMPORT EXCEL
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
            {can.admin && (
              <button className="btn bg-primary-dark" onClick={() => setAdmin(true)}>
                🛠 ADMIN
              </button>
            )}
          </>
        }
      />

      <div className="grid gap-4 2xl:grid-cols-[440px_1fr]">
        {/* ฟอร์มลงทะเบียน / แก้ไข */}
        <Card
          title={editId ? "✏️ EDIT PRODUCT" : viewId ? "👁 VIEW PRODUCT" : "＋ REGISTER PRODUCT"}
          actions={
            (editId || viewId || form.partCode) && (
              <button className="btn-ghost px-3 py-1 text-xs" onClick={clear}>
                CLEAR
              </button>
            )
          }
          bodyClass="p-4"
          className="self-start 2xl:sticky 2xl:top-4"
        >
          <div className="flex gap-4">
            <div className="shrink-0">
              <button
                type="button"
                disabled={!(can.add || can.edit)}
                onClick={() => imgRef.current?.click()}
                className="grid h-28 w-28 place-items-center overflow-hidden rounded-2xl border-2 border-dashed border-line bg-surface-2 text-xs font-bold text-ink-soft hover:border-accent"
                title="เลือกรูปสินค้า"
              >
                {form.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.imageUrl} alt="" className="h-full w-full object-contain" />
                ) : (
                  "🖼 IMAGE"
                )}
              </button>
              <input
                ref={imgRef}
                type="file"
                accept=".png,.jpg,.jpeg"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) uploadImage(f);
                }}
              />
              <div className="mt-3">
                <QrImage text={form.partCode.trim()} size={112} />
              </div>
            </div>
            <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="relative sm:col-span-2">
                {input("PRODUCT CODE", "partCode")}
                {codeSuggest.length > 0 && !editId && (
                  <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-line bg-surface shadow-xl">
                    {codeSuggest.map((p) => (
                      <button
                        key={p.ptId}
                        type="button"
                        className="block w-full border-b border-line/60 px-3 py-2 text-left hover:bg-surface-2"
                        onClick={() => {
                          setCodeSuggest([]);
                          fill(p, can.edit);
                          setKey(p.partCode);
                          toast.show("PRODUCT CODE", `ดึงข้อมูล ${p.partCode} มาแล้ว - แก้ / เพิ่ม Coil แล้วกด SAVE CHANGES`, "info");
                        }}
                      >
                        <div className="text-sm font-extrabold text-primary">
                          {p.partCode} {p.partA && <span className="text-ink-soft">• PART A {p.partA}</span>}
                        </div>
                        <div className="truncate text-xs">{p.partName}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="sm:col-span-2">{input("PRODUCT NAME", "partName")}</div>
              {input("SUPPLIER", "supplier", { list: "dl-sup" })}
              {input("CATEGORY", "category", { list: "dl-cat" })}
              {input("CUSTOMER", "customer", { list: "dl-cus" })}
              {input("PACKSIZE", "packSize", { numeric: true })}
              {input("BIN", "bin")}
              {input("QR CODE (SUPPLIER)", "qrCode")}
              {input("PART A", "partA")}
              {input("PART B", "partB")}
              {input("PART NO", "partNo")}
              {input("MODEL", "model")}
            </div>
          </div>
          <datalist id="dl-sup">{meta.suggestions.suppliers.map((s) => <option key={s} value={s} />)}</datalist>
          <datalist id="dl-cat">{meta.suggestions.categories.map((s) => <option key={s} value={s} />)}</datalist>
          <datalist id="dl-cus">{meta.suggestions.customers.map((s) => <option key={s} value={s} />)}</datalist>

          <div className="mt-4">
            <span className="mb-2 block text-[11px] font-extrabold uppercase text-ink-soft">STOCK</span>
            <div className="flex flex-wrap gap-2">
              {meta.stocks.map((s) => (s.isMain ? stockChip("main", s.code, inMain, s.name) : stockChip(s.stkId, s.code, others.includes(s.stkId), s.name)))}
            </div>
          </div>

          {meta.hasCoilRegister && (
            <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-[#f8f6fd] p-3">
              <div className="col-span-3 text-[11px] font-extrabold uppercase text-accent">🧲 ADD COIL (คลังที่นับ Coil)</div>
              {input("MASTER COIL", "masterCoil")}
              {input("COIL NO", "coilNo")}
              {input("WEIGHT (KG)", "coilKg", { placeholder: "0.000" })}
              {coilText && <div className="col-span-3 text-xs font-bold text-accent">{coilText}</div>}
            </div>
          )}

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {editId ? (
              can.edit && (
                <button className="btn bg-success" disabled={busy} onClick={() => save(true)}>
                  💾 SAVE CHANGES
                </button>
              )
            ) : (
              can.add && (
                <button className="btn bg-accent" disabled={busy} onClick={() => save(false)}>
                  ＋ REGISTER
                </button>
              )
            )}
          </div>
        </Card>

        {/* ตารางสินค้า */}
        <Card
          title={`PRODUCTS • ${total.toLocaleString()}`}
          actions={
            <>
              <select className="field w-auto py-1.5" value={filter ?? ""} onChange={(e) => changeFilter(e.target.value ? Number(e.target.value) : null)}>
                <option value="">ALL STOCKS</option>
                {meta.stocks.map((s) => (
                  <option key={s.stkId} value={s.stkId}>
                    {s.code}
                  </option>
                ))}
              </select>
              <button className="btn bg-success py-1.5" onClick={openExport}>
                ▣ EXPORT QR {ticked.length > 0 ? `(${ticked.length})` : ""}
              </button>
            </>
          }
        >
          <div className="border-b border-line/60 p-3">
            <SearchBox value={key} onChange={setKey} placeholder="ค้นหา PRODUCT CODE / ชื่อ / PART A / BIN / COIL" />
          </div>
          <div className="max-h-[calc(100dvh-280px)] min-h-[360px] overflow-auto">
            {!rows ? (
              <Loading />
            ) : rows.length === 0 ? (
              <Empty />
            ) : (
              <table className="data-table w-full">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th>
                      <input type="checkbox" checked={allTicked} onChange={(e) => setTicked(e.target.checked ? rows.map((r) => r.ptId) : [])} />
                    </th>
                    {cols.map((c) => (
                      <th key={c}>{label(c)}</th>
                    ))}
                    <th className="text-right">ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <Fragment key={g.key || "_"}>
                      {g.key && (
                        <tr>
                          <td colSpan={ncols} className="bg-surface-2 text-xs font-extrabold uppercase text-accent">
                            {layout?.groupBy} : {g.key} <span className="text-ink-soft">({g.items.length} ITEMS)</span>
                          </td>
                        </tr>
                      )}
                      {g.items.map((p) => (
                        <Fragment key={p.ptId}>
                          <tr className={`${viewId === p.ptId ? "bg-accent-soft/40" : ""} ${p.isShow ? "" : "opacity-50"}`}>
                            <td>
                              <input type="checkbox" checked={ticked.includes(p.ptId)} onChange={(e) => setTicked((t) => (e.target.checked ? [...t, p.ptId] : t.filter((x) => x !== p.ptId)))} />
                            </td>
                            {cols.map((c) => cell(p, c))}
                            <td className="whitespace-nowrap text-right">
                              <div className="inline-flex gap-1">
                                <button className="btn-ghost px-2 py-1 text-xs" onClick={() => (viewId === p.ptId && !editId ? clear() : fill(p, false))} title="VIEW">
                                  👁
                                </button>
                                {can.edit && (
                                  <button className="btn-ghost px-2 py-1 text-xs" onClick={() => (editId === p.ptId ? clear() : fill(p, true))} title="EDIT">
                                    ✏️
                                  </button>
                                )}
                                {can.edit && (
                                  <button className="btn-ghost px-2 py-1 text-xs" onClick={() => toggleShow(p)} title={p.isShow ? "HIDE" : "SHOW"}>
                                    {p.isShow ? "🙈" : "👁‍🗨"}
                                  </button>
                                )}
                                {can.delete && (
                                  <button className="btn-ghost px-2 py-1 text-xs text-danger" onClick={() => remove(p)} title="DELETE">
                                    🗑
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {coils[p.ptId] && (
                            <tr>
                              <td colSpan={ncols} className="bg-[#f8f6fd] p-2 text-xs">
                                {coils[p.ptId] === "loading"
                                  ? "⏳ LOADING COILS..."
                                  : (coils[p.ptId] as CoilRow[]).map((r) => (
                                      <div key={r.coilId + (r.isMother ? "m" : "c")} className={`flex gap-4 px-2 py-1 ${r.isMother ? "font-extrabold text-accent" : "text-ink-soft"}`}>
                                        <span className="w-8 text-right">{r.isMother ? "" : r.no}</span>
                                        <span className="w-44">{r.isMother ? `MASTER ${r.coilNo}` : `↳ ${r.coilNo}`}</span>
                                        <span className="w-28">{r.motherCoil || "-"}</span>
                                        <span className="w-28 text-right">{qty(r.weightKG)} KG</span>
                                        <span>{r.received}</span>
                                      </div>
                                    ))}
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
            {rows && rows.length < total && <div ref={sentinel} className="py-4 text-center text-xs text-ink-soft">⏳ LOADING MORE...</div>}
          </div>
        </Card>
      </div>

      {/* 📄 TEMPLATE: เลือกคลัง -> คอลัมน์ตาม Store (Max-Min) ของคลังนั้น */}
      <Modal open={tplOpen} wide title="📄 TEMPLATE EXCEL" onClose={() => setTplOpen(false)}>
        <p className="mb-3 text-sm font-semibold text-ink-soft">เลือกคลัง: ระบบสร้าง Template ตามคอลัมน์ที่คลังนั้นแสดงใน Store (Max-Min)</p>
        <div className="grid gap-2">
          {[{ stkId: 0, code: "ALL COLUMNS (ทุกคลัง)", name: "", heads: "ทุกคอลัมน์ที่ระบบอ่านได้ ใส่รหัสคลังเองที่ STOCK1 - STOCK3", countCoil: false }, ...tplOptions].map((o) => (
            <button
              key={o.stkId}
              className="rounded-xl border-2 border-line p-3 text-left hover:border-accent"
              onClick={async () => {
                setTplOpen(false);
                try {
                  await download("/products/template", { stkId: o.stkId || undefined });
                } catch (e) {
                  toast.show("ERROR", "สร้างไฟล์ Template ไม่สำเร็จ\n" + (e as Error).message, "error");
                }
              }}
            >
              <div className="font-extrabold text-primary">
                {o.code} {o.name && <span className="text-ink-soft">• {o.name}</span>}
              </div>
              <div className="text-xs">{o.heads}</div>
            </button>
          ))}
        </div>
      </Modal>

      {/* ▣ EXPORT QR: ที่ติ๊กไว้ / ทั้งหมดในคลัง */}
      <Modal open={!!exportOpen} title="▣ EXPORT QR" onClose={() => setExportOpen(null)}>
        <p className="mb-3 text-sm font-semibold text-ink-soft">QR CODE ตามรูปแบบที่ตั้งไว้ของ {filterStock?.code ?? "ALL STOCKS"} (ปุ่ม ADMIN &gt; QR CODE)</p>
        <div className="grid gap-2">
          <button className="rounded-xl border-2 border-line p-4 text-left hover:border-accent disabled:opacity-50" disabled={ticked.length === 0} onClick={() => exportQr("SELECTED")}>
            <div className="font-extrabold text-primary">☑ EXPORT SELECTED ({ticked.length.toLocaleString()})</div>
            <div className="text-xs">{ticked.length === 0 ? "ยังไม่ได้ติ๊กรายการในตาราง" : `เฉพาะ ${ticked.length} รายการที่ติ๊กไว้ในตาราง`}</div>
          </button>
          <button className="rounded-xl border-2 border-line p-4 text-left hover:border-accent" onClick={() => exportQr("ALL")}>
            <div className="font-extrabold text-primary">
              ▦ EXPORT ALL IN {filterStock?.code ?? "ALL STOCKS"} ({exportOpen?.all.toLocaleString()})
            </div>
            <div className="text-xs">สินค้าทั้งหมดในคลัง (ไม่ต้องติ๊ก / ไม่ขึ้นกับคำค้นหา)</div>
          </button>
        </div>
      </Modal>

      {admin && (
        <AdminModal
          ticked={ticked}
          onClose={(changed) => {
            setAdmin(false);
            if (changed) {
              setTicked([]);
              reload();
            }
          }}
        />
      )}
    </PageBody>
  );
}
