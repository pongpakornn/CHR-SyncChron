"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toasts";
import { useDialogs } from "@/components/ui/Dialogs";
import { Loading } from "@/components/ui/Page";
import { api } from "@/lib/api";
import type { Formula, Stock } from "./types";

type Form = { formulaId: number; isDefault: boolean; name: string; qtySource: Formula["qtySource"]; roundMode: Formula["roundMode"]; defDayMax: string; defDayMin: string; defWorkdays: string };

const toForm = (f?: Formula): Form => ({
  formulaId: f?.formulaId ?? 0,
  isDefault: f?.isDefault ?? false,
  name: f?.name ?? "",
  qtySource: f?.qtySource ?? "ORDER",
  roundMode: f?.roundMode ?? "UP",
  defDayMax: String(f?.defDayMax ?? 3),
  defDayMin: String(f?.defDayMin ?? 1),
  defWorkdays: String(f?.defWorkdays ?? 21),
});

const int = (s: string) => (/^\d+$/.test(s) ? Number(s) : 0);
const digits = (s: string) => s.replace(/\D/g, "");
const n0 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
const n2 = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// คำอธิบายสูตร (MaxMinFormula.Describe)
function describe(f: Form, inBox: boolean) {
  const qty = f.qtySource === "FORECAST" ? "Forecast" : "Order";
  const div = inBox ? " / PackSize" : "";
  const r = f.roundMode === "DOWN" ? "RoundDown" : f.roundMode === "NEAREST" ? "Round" : "RoundUp";
  return `MAX = ${r}(${qty} / Workdays${div}) x MAX DAYS   •   MIN = ${r}(${qty} / Workdays${div}) x MIN DAYS`;
}

// ⚙ รายการสูตร (MaxMinFormulaWindow): เพิ่ม / แก้ไข / ลบ + ตัวอย่างสด (ไม่ได้บันทึก)
export function FormulaModal({ open, stock, selectId, canEdit, onClose, onChanged }: { open: boolean; stock: Stock | null; selectId?: number; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const dlg = useDialogs();
  const [list, setList] = useState<Formula[] | null>(null);
  const [form, setForm] = useState<Form>(toForm());
  const [ex, setEx] = useState({ qty: "20000", wd: "21", pack: "50" });
  const [busy, setBusy] = useState(false);
  const inBox = !stock || stock.inBox;
  const unit = stock?.coil ? "COIL" : inBox ? "BOX" : (stock?.unit ?? "");

  const reload = useCallback(
    async (id?: number | null) => {
      try {
        const l = await api<Formula[]>("/maxmin/formulas");
        setList(l);
        setForm(toForm(l.find((f) => f.formulaId === id) ?? l[0]));
      } catch (e) {
        toast.show("ERROR", "โหลดรายการสูตรไม่สำเร็จ\n" + (e as Error).message, "error");
      }
    },
    [toast],
  );

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => reload(selectId), 0);
    return () => clearTimeout(t);
  }, [open, selectId, reload]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  // ตัวอย่าง: ปัดยอดต่อวันก่อน แล้วคูณจำนวนวัน (MaxMinFormula.Example)
  const qty = Number(ex.qty) || 0;
  const wd = int(ex.wd);
  const pack = int(ex.pack);
  const dmax = int(form.defDayMax);
  const dmin = int(form.defDayMin);
  let steps = "";
  let exMax = "-";
  let exMin = "-";
  if (wd <= 0 || (inBox && pack <= 0)) steps = "กรอก WORKDAYS" + (inBox ? " และ PACKSIZE" : "") + " ให้มากกว่า 0";
  else {
    const perDay = qty / wd;
    const perUnit = inBox ? perDay / pack : perDay;
    const r = form.roundMode === "DOWN" ? Math.floor(perUnit) : form.roundMode === "NEAREST" ? Math.round(perUnit) : Math.ceil(perUnit);
    steps = inBox
      ? `${n0(qty)} / ${wd} days = ${n2(perDay)} per day   →   / ${pack} = ${n2(perUnit)}   →   ${n0(r)} box per day`
      : `${n0(qty)} / ${wd} days = ${n2(perDay)}   →   ${n0(r)} ${unit} per day`;
    exMax = n0(r * dmax);
    exMin = n0(r * dmin);
  }

  async function save() {
    const name = form.name.trim();
    if (!name) return toast.show("WARNING", "กรุณากรอกชื่อสูตร (FORMULA NAME)", "warn");
    if (dmax <= 0) return toast.show("WARNING", "DEFAULT MAX (DAYS) ต้องมากกว่า 0 และ MIN (DAYS) ต้องไม่ติดลบ", "warn");
    if (dmin > dmax) return toast.show("WARNING", "DEFAULT MIN (DAYS) ต้องไม่มากกว่า MAX (DAYS)", "warn");
    const w = int(form.defWorkdays);
    if (w <= 0 || w > 31) return toast.show("WARNING", "DEFAULT WORKDAYS ต้องอยู่ระหว่าง 1 - 31 วัน", "warn");
    setBusy(true);
    try {
      const r = await api<{ id: number; message: string }>("/maxmin/formulas", {
        method: "POST",
        body: { formulaId: form.formulaId, name, qtySource: form.qtySource, roundMode: form.roundMode, defDayMax: dmax, defDayMin: dmin, defWorkdays: w },
      });
      toast.show("Formula saved", r.message, "ok");
      onChanged();
      await reload(r.id);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!form.formulaId || form.isDefault) return;
    if (!(await dlg.confirm({ title: "DELETE FORMULA", message: `ลบสูตร "${form.name}" ?`, ok: "DELETE", danger: true }))) return;
    try {
      const r = await api<{ message: string }>(`/maxmin/formulas/${form.formulaId}`, { method: "DELETE" });
      toast.show("Formula deleted", r.message, "ok");
      onChanged();
      await reload(null);
    } catch (e) {
      toast.show("WARNING", (e as Error).message, "warn");
    }
  }

  const ro = !canEdit;
  return (
    <Modal
      open={open}
      wide
      title="⚙ MAX / MIN FORMULAS"
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            CLOSE
          </button>
          {canEdit && (
            <>
              <button className="btn bg-danger" disabled={!form.formulaId || form.isDefault} onClick={remove}>
                🗑 DELETE
              </button>
              <button className="btn bg-accent" disabled={busy} onClick={save}>
                💾 SAVE
              </button>
            </>
          )}
        </>
      }
    >
      {!list ? (
        <Loading />
      ) : (
        <div className="grid gap-4 md:grid-cols-[240px_1fr]">
          <div className="grid content-start gap-2">
            {canEdit && (
              <button className="btn-ghost w-full" onClick={() => setForm(toForm())}>
                ＋ NEW FORMULA
              </button>
            )}
            {list.map((f) => (
              <button
                key={f.formulaId}
                onClick={() => setForm(toForm(f))}
                className={`rounded-xl border-2 px-3 py-2 text-left text-sm font-extrabold ${form.formulaId === f.formulaId ? "border-accent bg-surface-2 text-accent" : "border-line text-primary hover:border-accent/60"}`}
              >
                {f.displayName}
              </button>
            ))}
          </div>

          <div className="grid content-start gap-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 sm:col-span-3">
                <span className="text-[11px] font-extrabold uppercase text-ink-soft">FORMULA NAME</span>
                <input className="field" value={form.name} readOnly={ro || (form.isDefault && form.formulaId > 0)} onChange={(e) => set("name", e.target.value)} />
              </label>
              <label className="grid gap-1">
                <span className="text-[11px] font-extrabold uppercase text-ink-soft">QUANTITY SOURCE</span>
                <select className="field" disabled={ro} value={form.qtySource} onChange={(e) => set("qtySource", e.target.value as Form["qtySource"])}>
                  <option value="ORDER">ORDER</option>
                  <option value="FORECAST">FORECAST</option>
                </select>
              </label>
              <label className="grid gap-1 sm:col-span-2">
                <span className="text-[11px] font-extrabold uppercase text-ink-soft">ROUND</span>
                <select className="field" disabled={ro} value={form.roundMode} onChange={(e) => set("roundMode", e.target.value as Form["roundMode"])}>
                  <option value="UP">ROUND UP</option>
                  <option value="NEAREST">ROUND (NEAREST)</option>
                  <option value="DOWN">ROUND DOWN</option>
                </select>
              </label>
              {(
                [
                  ["defDayMax", "DEFAULT MAX (DAYS)"],
                  ["defDayMin", "DEFAULT MIN (DAYS)"],
                  ["defWorkdays", "DEFAULT WORKDAYS"],
                ] as const
              ).map(([k, l]) => (
                <label key={k} className="grid gap-1">
                  <span className="text-[11px] font-extrabold uppercase text-ink-soft">{l}</span>
                  <input className="field" inputMode="numeric" readOnly={ro} value={form[k]} onChange={(e) => set(k, digits(e.target.value))} />
                </label>
              ))}
            </div>

            <div className="rounded-xl bg-surface-2 p-3 text-xs font-bold text-primary">{describe(form, inBox)}</div>

            {/* ตัวอย่างสด (ไม่ได้บันทึก / ไม่ได้ใช้คำนวณจริง) */}
            <div className="rounded-2xl border border-line/60 p-3">
              <div className="mb-2 text-[11px] font-extrabold uppercase text-ink-soft">EXAMPLE (NOT SAVED)</div>
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="grid gap-1">
                  <span className="text-[11px] font-extrabold uppercase text-ink-soft">{form.qtySource === "FORECAST" ? "FORECAST" : "ORDER"}</span>
                  <input className="field" inputMode="decimal" value={ex.qty} onChange={(e) => setEx((x) => ({ ...x, qty: e.target.value.replace(/[^\d.]/g, "") }))} />
                </label>
                <label className="grid gap-1">
                  <span className="text-[11px] font-extrabold uppercase text-ink-soft">WORKDAYS</span>
                  <input className="field" inputMode="numeric" value={ex.wd} onChange={(e) => setEx((x) => ({ ...x, wd: digits(e.target.value) }))} />
                </label>
                <label className="grid gap-1">
                  <span className="text-[11px] font-extrabold uppercase text-ink-soft">PACKSIZE</span>
                  <input className="field" inputMode="numeric" disabled={!inBox} value={ex.pack} onChange={(e) => setEx((x) => ({ ...x, pack: digits(e.target.value) }))} />
                </label>
              </div>
              <div className="mt-2 text-xs font-semibold text-ink-soft">{steps}</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-surface-2 p-2">
                  <div className="text-[11px] font-extrabold text-ink-soft">
                    MAX ({unit}) = x {dmax} DAYS
                  </div>
                  <div className="text-2xl font-extrabold text-success">{exMax}</div>
                </div>
                <div className="rounded-xl bg-surface-2 p-2">
                  <div className="text-[11px] font-extrabold text-ink-soft">
                    MIN ({unit}) = x {dmin} DAYS
                  </div>
                  <div className="text-2xl font-extrabold text-danger">{exMin}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
