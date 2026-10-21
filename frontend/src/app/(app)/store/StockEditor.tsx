"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toasts";
import { Loading } from "@/components/ui/Page";
import { api } from "@/lib/api";
import { FormatsModal } from "./FormatsModal";
import type { Stock } from "./types";

type Fmt = { fmtId: number; name: string; isActive: boolean };

const COLUMNS: [string, string][] = [
  ["NO", "No."],
  ["IMAGE", "IMAGE"],
  ["CUSTOMER", "CUSTOMER"],
  ["CODE", "PD CODE"],
  ["PARTA", "PART A"],
  ["PARTB", "PART B"],
  ["PARTNO", "PART NO"],
  ["MODEL", "MODEL"],
  ["NAME", "PRODUCT NAME"],
  ["MAXMIN", "MAX / MIN"],
  ["QTY", "QTY"],
  ["BOX", "STOCK (BOX)"],
  ["COIL", "STOCK (COIL)"],
  ["PCS", "STOCK (PCS)"],
  ["REMARK", "REMARK"],
];
const SUB_ROWS: [string, string][] = [
  ["COILNO", "COIL NO"],
  ["MOTHER", "MASTER COIL"],
  ["WEIGHT", "WEIGHT (KG)"],
  ["COIL", "COIL"],
  ["TON", "TON"],
  ["RECEIVED", "RECEIVED"],
];
const SUB_DEFAULT = SUB_ROWS.map(([k]) => k);

const NEW_STOCK: Partial<Stock> = {
  stkId: 0,
  code: "",
  name: "",
  unit: "KG",
  groupBy: "CATEGORY",
  maxMinBasis: "KG",
  allowDecimal: false,
  maxMinDecimalSetting: false,
  notSetButton: false,
  showCoilRowsSetting: true,
  cardStyleSetting: "IMAGE",
  inExcel: true,
  inSysQr: true,
  outSysQr: true,
  inPickList: false,
  inSupplier: false,
  outPickList: false,
  outSupplier: false,
  formatIds: [],
};

// ⚙ ตั้งค่าคลัง (StockEditorWindow): ข้อมูลคลัง / คอลัมน์ตาราง (ลำดับตามที่ติ๊ก) / แถว Coil ย่อย / การ์ด / ช่องทางสแกน / รูปแบบป้าย
export function StockEditor({ stkId, canFormats, onClose, onSaved }: { stkId: number | null; canFormats: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [s, setS] = useState<Partial<Stock> | null>(stkId ? null : NEW_STOCK);
  const [cols, setCols] = useState<string[]>(stkId ? [] : ["IMAGE", "CODE", "NAME", "MAXMIN", "QTY", "REMARK"]);
  const [subs, setSubs] = useState<string[]>(SUB_DEFAULT);
  const [formats, setFormats] = useState<Fmt[]>([]);
  const [busy, setBusy] = useState(false);
  const [manage, setManage] = useState(false);

  const loadFormats = () => api<Fmt[]>("/store/formats/brief").then(setFormats).catch(() => {});

  useEffect(() => {
    if (!stkId) {
      api<Fmt[]>("/store/formats/brief").then(setFormats).catch(() => {});
      return;
    }
    api<{ stock: Stock; columns: string[]; coilRowOrder: string[]; formats: Fmt[] }>(`/store/stocks/${stkId}/settings`)
      .then((r) => {
        setS({ ...r.stock, maxMinBasis: ["KG", "PCS", "SHEET", "BOX", "COIL"].includes(r.stock.maxMinUnit) ? r.stock.maxMinUnit : "KG", maxMinDecimalSetting: r.stock.maxMinDecimal, showCoilRowsSetting: r.stock.showCoilRowsSetting ?? true, cardStyleSetting: r.stock.cardStyle });
        setCols(r.columns);
        setSubs(r.stock.coilRowColumns === "-" ? [] : r.coilRowOrder);
        setFormats(r.formats);
      })
      .catch((e) => toast.show("ERROR", e.message, "error"));
  }, [stkId, toast]);

  if (!s)
    return (
      <Modal open wide title="EDIT STOCK" onClose={onClose}>
        <Loading />
      </Modal>
    );

  const set = <K extends keyof Stock>(k: K, v: Stock[K]) => setS({ ...s, [k]: v });
  const toggleCol = (k: string) => setCols((l) => (l.includes(k) ? l.filter((x) => x !== k) : [...l, k]));
  const toggleSub = (k: string) => setSubs((l) => (l.includes(k) ? l.filter((x) => x !== k) : [...l, k]));
  const supplier = !!(s.inSupplier || s.outSupplier);

  async function save() {
    if (!s) return;
    if (!s.code?.trim()) return toast.show("WARNING", "กรุณากรอกรหัสคลัง (STOCK CODE)", "warn");
    if (!s.name?.trim()) return toast.show("WARNING", "กรุณากรอกชื่อคลัง (STOCK NAME)", "warn");
    if (cols.length === 0) return toast.show("WARNING", "กรุณาเลือกคอลัมน์ที่ต้องการแสดงอย่างน้อย 1 คอลัมน์", "warn");
    if (supplier && (s.formatIds ?? []).length === 0) return toast.show("WARNING", "เปิดช่องทาง SUPPLIER LABEL แล้ว กรุณาเลือกรูปแบบบาร์โค้ด Supplier อย่างน้อย 1 รูปแบบ", "warn");
    const body = {
      ...s,
      columnOrder: cols.join(","),
      coilRowColumns: subs.join(",") === SUB_DEFAULT.join(",") ? null : subs.length === 0 ? "-" : subs.join(","),
    };
    setBusy(true);
    try {
      const r = await api<{ message: string }>(stkId ? `/store/stocks/${stkId}` : "/store/stocks", { method: stkId ? "PUT" : "POST", body });
      toast.show("Stock", r.message, "ok");
      onSaved();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const chip = (on: boolean, label: React.ReactNode, onClick: () => void, disabled = false) => (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-extrabold transition disabled:opacity-40 ${on ? "border-accent bg-accent text-white" : "border-line bg-surface text-ink hover:border-accent"}`}
    >
      {label}
    </button>
  );
  const check = (k: keyof Stock, label: string) => (
    <label className="flex items-center gap-2 text-sm font-bold">
      <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={!!s[k]} onChange={(e) => set(k, e.target.checked as never)} />
      {label}
    </label>
  );
  const section = (title: string, children: React.ReactNode, hint?: string) => (
    <div className="rounded-2xl border border-line/70 p-4">
      <div className="mb-3 text-xs font-extrabold uppercase tracking-wide text-primary">{title}</div>
      {children}
      {hint && <div className="mt-2 text-xs font-semibold text-ink-soft">{hint}</div>}
    </div>
  );

  return (
    <Modal
      open
      wide
      title={stkId ? "EDIT STOCK" : "ADD STOCK"}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            CANCEL
          </button>
          <button className="btn bg-accent" onClick={save} disabled={busy}>
            {stkId ? "SAVE" : "CREATE STOCK"}
          </button>
        </>
      }
    >
      <p className="mb-4 text-sm font-semibold text-ink-soft">
        {stkId ? `${s.code} • ${s.name}${s.isMain ? " • MAIN STOCK" : ""}` : "Create a new stock - every user gets VIEW permission automatically"}
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {section(
          "STOCK",
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 sm:col-span-1">
              <span className="mb-1 block text-xs font-bold text-ink-soft">STOCK CODE</span>
              <input className="field" maxLength={30} value={s.code ?? ""} onChange={(e) => set("code", e.target.value)} />
            </label>
            <label className="col-span-2 sm:col-span-1">
              <span className="mb-1 block text-xs font-bold text-ink-soft">STOCK NAME</span>
              <input className="field" value={s.name ?? ""} onChange={(e) => set("name", e.target.value)} />
            </label>
            <label>
              <span className="mb-1 block text-xs font-bold text-ink-soft">UNIT</span>
              <select className="field" value={s.unit} onChange={(e) => set("unit", e.target.value)}>
                <option>KG</option>
                <option>PCS</option>
                <option>SHEET</option>
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs font-bold text-ink-soft">GROUP BY</span>
              <select className="field" value={s.groupBy} onChange={(e) => set("groupBy", e.target.value)}>
                <option>CATEGORY</option>
                <option>CUSTOMER</option>
                <option>SUPPLIER</option>
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs font-bold text-ink-soft">MAX / MIN UNIT</span>
              <select className="field" value={s.maxMinBasis} onChange={(e) => set("maxMinBasis", e.target.value)}>
                {["KG", "PCS", "SHEET", "BOX", "COIL"].map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </label>
            <div className="col-span-2 mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {check("allowDecimal", "DECIMAL QTY")}
              {check("maxMinDecimalSetting", "MAX / MIN DECIMAL")}
              {check("notSetButton", "3rd button = MAX-MIN NOT SET")}
            </div>
          </div>,
        )}
        {section(
          "TABLE COLUMNS (order = order ticked)",
          <>
            <div className="flex flex-wrap gap-2">{COLUMNS.map(([k, l]) => chip(cols.includes(k), cols.includes(k) ? `${cols.indexOf(k) + 1}. ${l}` : l, () => toggleCol(k)))}</div>
            <div className="mt-3 text-xs font-bold text-ink-soft">ORDER: {cols.length ? cols.map((k) => COLUMNS.find((c) => c[0] === k)?.[1]).join("  →  ") : "-"}</div>
          </>,
          "STOCK (COIL) = นับ Coil (คลัง KG) • ติ๊กก่อน = แสดงก่อน",
        )}
        {section(
          "COIL SUB ROWS",
          <>
            <label className="mb-3 flex items-center gap-2 text-sm font-bold">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--accent)]"
                checked={s.showCoilRowsSetting ?? true}
                onChange={(e) => set("showCoilRowsSetting", e.target.checked)}
                disabled={!cols.includes("COIL")}
              />
              Click PD CODE shows the coils
            </label>
            <div className="flex flex-wrap gap-2">
              {SUB_ROWS.map(([k, l]) => chip(subs.includes(k), subs.includes(k) ? `${subs.indexOf(k) + 1}. ${l}` : l, () => toggleSub(k), !cols.includes("COIL")))}
            </div>
          </>,
          "ใช้กับคลังที่เปิด STOCK (COIL)",
        )}
        {section(
          "PRODUCT CARDS",
          <select className="field" value={s.cardStyleSetting ?? "OFF"} onChange={(e) => set("cardStyleSetting", e.target.value)}>
            <option value="IMAGE">WITH IMAGE</option>
            <option value="TEXT">NO IMAGE</option>
            <option value="OFF">OFF</option>
          </select>,
          s.cardStyleSetting === "IMAGE" && !cols.includes("IMAGE")
            ? "IMAGE column is off - cards will show as NO IMAGE. Tick IMAGE in TABLE COLUMNS to show pictures on the cards."
            : "Cards that scroll above the table (SHOW CARDS on the Store page).",
        )}
        {section(
          "SCAN CHANNELS",
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <div className="text-xs font-extrabold text-success">IN (รับเข้า)</div>
              {check("inPickList", "PICK LIST QR")}
              {check("inSupplier", "SUPPLIER LABEL")}
              {check("inSysQr", "SYSTEM QR")}
              {check("inExcel", "IMPORT EXCEL")}
            </div>
            <div className="grid gap-2">
              <div className="text-xs font-extrabold text-danger">OUT (จ่ายออก)</div>
              {check("outPickList", "PICK LIST QR")}
              {check("outSupplier", "SUPPLIER LABEL")}
              {check("outSysQr", "SYSTEM QR")}
            </div>
          </div>,
        )}
        {section(
          "SUPPLIER LABEL FORMATS",
          <>
            <div className={`flex flex-wrap gap-2 ${supplier ? "" : "opacity-50"}`}>
              {formats.length === 0 && <span className="text-sm text-ink-soft">ยังไม่มีรูปแบบบาร์โค้ด</span>}
              {formats.map((f) =>
                chip(
                  (s.formatIds ?? []).includes(f.fmtId),
                  f.isActive ? f.name : `${f.name} (INACTIVE)`,
                  () => set("formatIds", (s.formatIds ?? []).includes(f.fmtId) ? (s.formatIds ?? []).filter((x) => x !== f.fmtId) : [...(s.formatIds ?? []), f.fmtId]),
                  !supplier,
                ),
              )}
            </div>
            {canFormats && (
              <button type="button" className="btn-ghost mt-3 px-3 py-1 text-xs" onClick={() => setManage(true)}>
                🏷️ MANAGE FORMATS
              </button>
            )}
          </>,
          "เลือกได้เมื่อเปิดช่องทาง SUPPLIER LABEL",
        )}
      </div>
      {manage && (
        <FormatsModal
          onClose={() => {
            setManage(false);
            loadFormats();
          }}
        />
      )}
    </Modal>
  );
}
