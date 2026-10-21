"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toasts";
import { useDialogs } from "@/components/ui/Dialogs";
import { Badge, Loading } from "@/components/ui/Page";
import { api } from "@/lib/api";
import { useDebounced } from "@/lib/useDebounced";

type Fmt = {
  fmtId: number;
  name: string;
  delimiter: string;
  delimMode: string;
  trimChars: string | null;
  codePrefix: string;
  codeCut: number | null;
  matchStart: string | null;
  matchEnd: string | null;
  matchBy: string;
  nameFields: string | null;
  codePos: number;
  altCodePos: number | null;
  qtyPos: number | null;
  minFields: number;
  coilNoPos: number | null;
  motherCoilPos: number | null;
  sourceStkId: number | null;
  sampleText: string;
  isActive: boolean;
};
type Data = { canAdd: boolean; canEdit: boolean; canDelete: boolean; formats: Fmt[]; stocks: { stkId: number; display: string }[] };
type Test = { ok: boolean; fields: string[]; codes: string[]; qty: number | null; coilNo: string | null; mother: string | null; lookup: string | null; minFields: number; namePositions: number[] };

const BLANK: Fmt = {
  fmtId: 0,
  name: "",
  delimiter: ";",
  delimMode: "CHAR",
  trimChars: null,
  codePrefix: "NONE",
  codeCut: null,
  matchStart: null,
  matchEnd: null,
  matchBy: "CODE",
  nameFields: null,
  codePos: 1,
  altCodePos: null,
  qtyPos: null,
  minFields: 1,
  coilNoPos: null,
  motherCoilPos: null,
  sourceStkId: null,
  sampleText: "",
  isActive: true,
};

const pos = (v: string) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// 🏷️ BARCODE FORMATS (BarcodeFormatWindow): รูปแบบป้าย Supplier + ทดสอบกับป้ายตัวอย่าง (แยกช่อง / หาสินค้าในระบบ)
export function FormatsModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const dlg = useDialogs();
  const [data, setData] = useState<Data | null>(null);
  const [f, setF] = useState<Fmt | null>(null);
  const [minTyped, setMinTyped] = useState("");
  const [test, setTest] = useState<Test | null>(null);
  const dF = useDebounced(f, 300);

  const load = useCallback(
    async (selectId?: number | null) => {
      try {
        const d = await api<Data>("/store/formats");
        setData(d);
        const pick = d.formats.find((x) => x.fmtId === selectId) ?? (selectId === undefined ? d.formats[0] : null);
        if (pick) {
          setF(pick);
          setMinTyped(String(pick.minFields));
        }
      } catch (e) {
        toast.show("ERROR", "ไม่สามารถโหลดรูปแบบบาร์โค้ดได้\n" + (e as Error).message, "error");
      }
    },
    [toast],
  );

  useEffect(() => {
    const t = setTimeout(() => load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    if (!dF) return;
    let alive = true;
    api<Test>("/store/formats/test", { method: "POST", body: { ...dF, minFields: pos(minTyped) ?? 1 } })
      .then((r) => alive && setTest(r))
      .catch(() => alive && setTest(null));
    return () => {
      alive = false;
    };
  }, [dF, minTyped]);

  async function save() {
    if (!f) return;
    if (f.sampleText && test && !test.ok && !(await dlg.confirm({ title: "CONFIRM SAVE", message: "ตัวอย่างบาร์โค้ดที่ทดสอบไว้ ไม่ตรงกับรูปแบบนี้\nต้องการบันทึกต่อหรือไม่?" }))) return;
    try {
      const r = await api<{ id: number; message: string }>("/store/formats", { method: "POST", body: { format: f, typedMinFields: pos(minTyped) } });
      toast.show("Barcode Format", r.message, "ok");
      load(r.id);
    } catch (e) {
      toast.show("WARNING", (e as Error).message, "warn");
    }
  }

  async function remove() {
    if (!f || !f.fmtId) return;
    if (!(await dlg.confirm({ title: "CONFIRM DELETE", danger: true, message: `ต้องการลบรูปแบบ "${f.name}" ใช่หรือไม่?\nคลังที่ใช้รูปแบบนี้จะไม่รับป้ายรูปแบบนี้อีก` }))) return;
    try {
      await api(`/store/formats/${f.fmtId}`, { method: "DELETE" });
      setF(null);
      load(null);
    } catch (e) {
      toast.show("ERROR", "ลบรูปแบบบาร์โค้ดไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }

  const canSave = f && (f.fmtId === 0 ? data?.canAdd : data?.canEdit);
  const set = <K extends keyof Fmt>(k: K, v: Fmt[K]) => f && setF({ ...f, [k]: v });
  const txt = (label: string, k: keyof Fmt, opt: { num?: boolean; disabled?: boolean; ph?: string } = {}) => (
    <label className="block">
      <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">{label}</span>
      <input
        className="field"
        disabled={opt.disabled}
        placeholder={opt.ph}
        inputMode={opt.num ? "numeric" : undefined}
        value={(f?.[k] as string | number | null) ?? ""}
        onChange={(e) => set(k, (opt.num ? pos(e.target.value.replace(/\D/g, "")) : e.target.value || null) as never)}
      />
    </label>
  );

  const color = (n: number) => {
    if (!f) return "#e3e1e8";
    if (f.matchBy === "NAME" ? test?.namePositions.includes(n) : n === f.codePos) return "var(--accent)";
    if (n === f.altCodePos) return "var(--info)";
    if (n === f.qtyPos) return "var(--success)";
    if (n === f.coilNoPos || n === f.motherCoilPos) return "var(--warning)";
    return "#cfccd6";
  };

  return (
    <Modal
      open
      wide
      title="🏷️ BARCODE FORMATS"
      onClose={onClose}
      footer={
        <>
          {data?.canAdd && (
            <button className="btn-ghost mr-auto" onClick={() => (setF({ ...BLANK }), setMinTyped(""))}>
              ＋ NEW FORMAT
            </button>
          )}
          {data?.canDelete && f && f.fmtId > 0 && (
            <button className="btn bg-danger" onClick={remove}>
              🗑 DELETE
            </button>
          )}
          {canSave && (
            <button className="btn bg-accent" onClick={save}>
              SAVE
            </button>
          )}
        </>
      }
    >
      {!data ? (
        <Loading />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          <div className="flex max-h-[60vh] flex-col gap-1 overflow-auto">
            {data.formats.map((x) => (
              <button
                key={x.fmtId}
                onClick={() => (setF(x), setMinTyped(String(x.minFields)))}
                className={`rounded-xl px-3 py-2 text-left text-sm font-bold ${f?.fmtId === x.fmtId ? "bg-accent text-white" : "hover:bg-surface-2"}`}
              >
                {x.name} {!x.isActive && <Badge color="var(--ink-soft)">INACTIVE</Badge>}
              </button>
            ))}
            {data.formats.length === 0 && <div className="p-3 text-sm text-ink-soft">ยังไม่มีรูปแบบ</div>}
          </div>
          {f && (
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="col-span-2">{txt("FORMAT NAME", "name")}</div>
                <label className="col-span-2 flex items-end gap-2 pb-2 text-sm font-bold">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={f.isActive} onChange={(e) => set("isActive", e.target.checked)} /> ACTIVE
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">SPLIT FIELDS BY</span>
                  <select className="field" value={f.delimMode} onChange={(e) => set("delimMode", e.target.value)}>
                    <option value="CHAR">DELIMITER</option>
                    <option value="SPACES">ANY SPACES</option>
                  </select>
                </label>
                {txt("DELIMITER", "delimiter", { disabled: f.delimMode === "SPACES" })}
                {txt("TRIM CHARS", "trimChars", { ph: "เช่น |" })}
                <label className="block">
                  <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">CODE PREFIX</span>
                  <select className="field" value={f.codePrefix} onChange={(e) => set("codePrefix", e.target.value)}>
                    <option value="NONE">NONE</option>
                    <option value="DIGIT">CUT 1st DIGIT (2A250 → A250)</option>
                    <option value="CUT">CUT N CHARS</option>
                  </select>
                </label>
                {txt("CUT N", "codeCut", { num: true, disabled: f.codePrefix !== "CUT" })}
                {txt("STARTS WITH", "matchStart")}
                {txt("ENDS WITH", "matchEnd")}
                <label className="block">
                  <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">MATCH BY</span>
                  <select className="field" value={f.matchBy} onChange={(e) => set("matchBy", e.target.value)}>
                    <option value="CODE">PRODUCT CODE</option>
                    <option value="NAME">PRODUCT NAME</option>
                  </select>
                </label>
                {txt("NAME FIELDS #", "nameFields", { disabled: f.matchBy !== "NAME", ph: "เช่น 6,7" })}
                {txt("CODE FIELD #", "codePos", { num: true })}
                {txt("ALT CODE FIELD #", "altCodePos", { num: true })}
                {txt("QTY FIELD #", "qtyPos", { num: true })}
                <label className="block">
                  <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">MIN FIELDS</span>
                  <input className="field" inputMode="numeric" placeholder={test ? `auto ${test.minFields}` : ""} value={minTyped} onChange={(e) => setMinTyped(e.target.value.replace(/\D/g, ""))} />
                </label>
                {txt("COIL NO FIELD #", "coilNoPos", { num: true })}
                {txt("MASTER COIL FIELD #", "motherCoilPos", { num: true })}
                <label className="col-span-2 block">
                  <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">DEDUCT FROM STOCK (ตัดยอดจากคลัง)</span>
                  <select className="field" value={f.sourceStkId ?? ""} onChange={(e) => set("sourceStkId", e.target.value ? Number(e.target.value) : null)}>
                    <option value="">— NONE —</option>
                    {data.stocks.map((s) => (
                      <option key={s.stkId} value={s.stkId}>
                        {s.display}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="rounded-2xl bg-surface-2 p-4">
                <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">🧪 TEST LABEL (SAMPLE)</span>
                <input className="field font-mono" value={f.sampleText ?? ""} onChange={(e) => set("sampleText", e.target.value)} placeholder="ยิง / วางป้ายตัวอย่างที่นี่" />
                {test && test.fields.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {test.fields.map((v, i) => (
                      <span key={i} className="rounded-lg px-2 py-1 text-xs font-bold text-white" style={{ background: color(i + 1) }}>
                        #{i + 1} {v || "∅"}
                      </span>
                    ))}
                  </div>
                )}
                {test && f.sampleText && (
                  <div className="mt-3 grid gap-1 text-sm font-bold">
                    <div className={test.ok ? "text-success" : "text-danger"}>
                      {test.ok ? `✔ MATCH • ${f.matchBy === "NAME" ? "NAME" : "CODE"}: ${test.codes.join(" / ")}${test.qty !== null ? ` • QTY ${test.qty}` : ""}` : "✖ ป้ายนี้ไม่ตรงกับรูปแบบ"}
                    </div>
                    {(test.coilNo || test.mother) && (
                      <div className="text-warning">
                        🧲 COIL NO: {test.coilNo ?? "-"} • MASTER COIL: {test.mother ?? "-"}
                      </div>
                    )}
                    {test.lookup && <div className={test.lookup.startsWith("FOUND") ? "text-success" : "text-ink-soft"}>{test.lookup}</div>}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
