"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toasts";
import { useDialogs } from "@/components/ui/Dialogs";
import { Empty, Loading } from "@/components/ui/Page";
import { api, upload } from "@/lib/api";
import { useDebounced } from "@/lib/useDebounced";

type Section = "PR" | "EXCEL" | "DEPT";
type Dirty = Record<Section, boolean>;
const NAMES: Record<Section, string> = { PR: "PR SETTINGS", EXCEL: "EXCEL SETUP", DEPT: "DEPARTMENTS" };
const L = "mb-1 block text-[11px] font-extrabold uppercase text-ink-soft";

// ⚙ SETUP (SystemSetupWindow - Admin Level 1): 🧾 PR SETTINGS / 📊 EXCEL SETUP / 🏢 DEPARTMENTS
export function SetupModal({ onClose }: { onClose: () => void }) {
  const dlg = useDialogs();
  const [sec, setSec] = useState<Section>("PR");
  const [dirty, setDirty] = useState<Dirty>({ PR: false, EXCEL: false, DEPT: false });
  const mark = useCallback((s: Section, v: boolean) => setDirty((d) => (d[s] === v ? d : { ...d, [s]: v })), []);

  async function tryClose() {
    const unsaved = (Object.keys(dirty) as Section[]).filter((s) => dirty[s]).map((s) => NAMES[s]);
    if (unsaved.length && !(await dlg.confirm({ title: "UNSAVED CHANGES", message: `มีการตั้งค่าที่ยังไม่ได้กด SAVE (${unsaved.join(", ")})\nต้องการปิดหน้าต่างโดยไม่บันทึกหรือไม่?`, ok: "CLOSE" })))
      return;
    onClose();
  }

  return (
    <Modal open wide title="⚙ SETUP" onClose={tryClose}>
      <div className="grid gap-4 md:grid-cols-[200px_1fr]">
        <nav className="flex gap-2 md:flex-col">
          {(
            [
              ["PR", "🧾 PR SETTINGS"],
              ["EXCEL", "📊 EXCEL SETUP"],
              ["DEPT", "🏢 DEPARTMENTS"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setSec(k)}
              className={`rounded-xl px-3 py-2 text-left text-sm font-extrabold transition ${sec === k ? "bg-primary text-white" : "bg-surface-2 text-primary hover:bg-accent-soft"}`}
            >
              {l}
              {dirty[k] && <span className="ml-1 text-warning">●</span>}
            </button>
          ))}
          <div className="hidden text-[11px] font-bold text-ink-soft md:block">ADMIN LEVEL 1</div>
        </nav>
        <div className="min-w-0">
          {/* ทุกแผงเปิดค้างไว้ (เก็บค่าที่ยังไม่ SAVE) - ซ่อนแผงที่ไม่ได้เลือก */}
          <div hidden={sec !== "PR"}>
            <PrPanel onDirty={(v) => mark("PR", v)} />
          </div>
          <div hidden={sec !== "EXCEL"}>
            <ExcelPanel onDirty={(v) => mark("EXCEL", v)} />
          </div>
          <div hidden={sec !== "DEPT"}>
            <DeptPanel onDirty={(v) => mark("DEPT", v)} />
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- 🧾 PR SETTINGS
type PrStock = { stkId: number; code: string; name: string; keep: boolean; file: string | null };

function PrPanel({ onDirty }: { onDirty: (v: boolean) => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<PrStock[] | null>(null);
  const [orig, setOrig] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<PrStock[]>("/setup/pr");
      setRows(r);
      setOrig(Object.fromEntries(r.map((x) => [x.stkId, x.keep])));
    } catch (e) {
      toast.show("ERROR", "โหลดการตั้งค่า PR ไม่สำเร็จ\n" + (e as Error).message, "error");
      setRows([]);
    }
  }, [toast]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const changed = (rows ?? []).filter((r) => r.keep !== orig[r.stkId]);
  useEffect(() => onDirty(changed.length > 0), [changed.length, onDirty]);

  async function save() {
    setBusy(true);
    try {
      const r = await api<{ message: string }>("/setup/pr", { method: "POST", body: Object.fromEntries(changed.map((c) => [c.stkId, c.keep])) });
      toast.show("Saved", r.message, "ok");
      await load();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (!rows) return <Loading />;
  return (
    <div className="grid gap-3">
      <p className="text-xs font-bold text-ink-soft">KEEP PR = scanning OUT creates a PR and the stock shows in the PR page dropdown • the Excel file of EXPORT PATH is set in EXCEL SETUP</p>
      <div className="grid gap-2">
        {rows.map((r) => (
          <label key={r.stkId} className={`flex flex-wrap items-center gap-3 rounded-xl border-2 px-3 py-2 ${r.keep ? "border-accent" : "border-line/60"}`}>
            <input type="checkbox" checked={r.keep} onChange={(e) => setRows((rs) => rs!.map((x) => (x.stkId === r.stkId ? { ...x, keep: e.target.checked } : x)))} />
            <span className="font-extrabold text-primary">{r.code}</span>
            <span className="text-sm font-semibold text-ink-soft">{r.name}</span>
            <span className="ml-auto text-xs font-bold text-ink-soft">{r.file ? "📊 " + r.file : "📊 no Excel file (EXCEL SETUP)"}</span>
            <span className="text-xs font-extrabold text-accent">KEEP PR</span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs font-bold text-warning">{changed.length > 0 ? `${changed.length} stock(s) changed - press SAVE` : ""}</span>
        <button className="btn bg-success ml-auto" disabled={busy || changed.length === 0} onClick={save}>
          💾 SAVE
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 📊 EXCEL SETUP
type Entry = { field: string; isTable: boolean; target: string };
type Opt = { key: string; label: string };
type XRow = {
  stkId: number;
  code: string;
  keepPr?: boolean;
  path: string;
  startRow: number;
  entries: Entry[];
  fileFound: boolean;
  addSheet?: boolean;
  baseSheet?: string;
  sheetName?: string;
  dateMode?: string;
  txTypes?: string;
};
type ExcelData = { hasPrStock: boolean; hasScanRpa: boolean; prFields: Opt[]; rpaFields: Opt[]; prDefault: Entry[]; rpaDefault: Entry[]; pr: XRow[]; rpa: XRow[] };

const rowKey = (r: XRow, rpa: boolean) =>
  JSON.stringify([r.path.trim(), r.startRow, r.entries.map((e) => [e.field, e.isTable, e.target.trim().toUpperCase()]), ...(rpa ? [r.addSheet, (r.baseSheet ?? "").trim(), (r.sheetName ?? "").trim(), r.dateMode, r.txTypes] : [])]);

function ExcelPanel({ onDirty }: { onDirty: (v: boolean) => void }) {
  const toast = useToast();
  const dlg = useDialogs();
  const [data, setData] = useState<ExcelData | null>(null);
  const [pr, setPr] = useState<XRow[]>([]);
  const [rpa, setRpa] = useState<XRow[]>([]);
  const [orig, setOrig] = useState<Record<string, string>>({});
  const [isRpa, setIsRpa] = useState(false);
  const [cur, setCur] = useState<number | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<ExcelData>("/setup/excel");
      setData(d);
      setPr(d.pr);
      setRpa(d.rpa);
      setOrig(Object.fromEntries([...d.pr.map((r) => ["P" + r.stkId, rowKey(r, false)]), ...d.rpa.map((r) => ["R" + r.stkId, rowKey(r, true)])]));
    } catch (e) {
      toast.show("ERROR", "โหลด EXCEL SETUP ไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }, [toast]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const rows = isRpa ? rpa : pr;
  const setRows = isRpa ? setRpa : setPr;
  const row = rows.find((r) => r.stkId === cur) ?? rows[0] ?? null;
  const fields = (isRpa ? data?.rpaFields : data?.prFields) ?? [];
  const label = (k: string) => fields.find((f) => f.key === k)?.label ?? k;
  const isChanged = (r: XRow, rp: boolean) => rowKey(r, rp) !== orig[(rp ? "R" : "P") + r.stkId];
  const changed = useMemo(() => [...pr.filter((r) => isChanged(r, false)).map((r) => ({ r, rpa: false })), ...rpa.filter((r) => isChanged(r, true)).map((r) => ({ r, rpa: true }))], [pr, rpa, orig]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => onDirty(changed.length > 0), [changed.length, onDirty]);

  const patch = (p: Partial<XRow>) => row && setRows((rs) => rs.map((r) => (r.stkId === row.stkId ? { ...r, ...p } : r)));
  const patchEntry = (i: number, p: Partial<Entry>) => row && patch({ entries: row.entries.map((e, j) => (j === i ? { ...e, ...p } : e)) });

  // ตัวอย่างที่จะลง (คำนวณที่ Server เหมือน ExcelSetupPanel.Refresh)
  const previewKey = useDebounced(row ? JSON.stringify([isRpa, row]) : "", 250);
  useEffect(() => {
    if (!previewKey) return;
    const [rp, r] = JSON.parse(previewKey) as [boolean, XRow];
    let live = true;
    api<{ text: string }>("/setup/excel/preview", { method: "POST", body: { ...r, isRpa: rp } })
      .then((x) => live && setPreview(x.text))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [previewKey]);

  async function uploadFile(file: File) {
    if (!row) return;
    try {
      const r = await upload<{ path: string; sheets: string[] }>("/setup/excel/file", file);
      patch({ path: r.path, fileFound: true });
      setSheets(r.sheets);
      toast.show("Uploaded", `อัปโหลด ${r.path} เข้า CHR-Synchron แล้ว`, "ok");
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  async function loadSheets() {
    if (!row) return;
    try {
      setSheets(await api<string[]>("/setup/excel/sheets", { query: { path: row.path } }));
    } catch (e) {
      toast.show("WARNING", (e as Error).message, "warn");
    }
  }

  function addField() {
    if (!row) return;
    const used = new Set(row.entries.map((e) => e.field));
    const next = fields.find((f) => !used.has(f.key))?.key ?? fields[fields.length - 1]?.key ?? "";
    patch({ entries: [...row.entries, { field: next, isTable: true, target: "" }] });
  }

  async function save(confirmed = false): Promise<void> {
    setBusy(true);
    try {
      const body = changed.map(({ r, rpa: rp }) => ({ ...r, isRpa: rp }));
      const res = await api<{ message?: string; confirm?: string }>("/setup/excel", { method: "POST", body, query: { confirmed: confirmed || undefined } });
      if (res.confirm) {
        setBusy(false);
        if (await dlg.confirm({ title: "EXCEL SETUP", message: res.confirm, ok: "SAVE" })) return save(true);
        return;
      }
      toast.show("Saved", res.message ?? "", "ok");
      await load();
    } catch (e) {
      toast.show("WARNING", (e as Error).message, "warn");
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <Loading />;
  const canSave = (changed.some((c) => !c.rpa) ? data.hasPrStock : true) && (changed.some((c) => c.rpa) ? data.hasScanRpa : true);
  const status =
    isRpa && !data.hasScanRpa
      ? "⚠ Run Database/Update_20261020b.sql first - cannot save MULTI-SCANNER yet"
      : !isRpa && !data.hasPrStock
        ? "⚠ Run Database/Update_20261017.sql first - cannot save PR yet"
        : changed.length
          ? `${changed.length} stock(s) changed (${changed.map((c) => (c.rpa ? "RPA " : "PR ") + c.r.code).join(", ")}) - press SAVE`
          : "";
  const types = (row?.txTypes ?? "").split(",").filter(Boolean);
  const toggleType = (t: string, on: boolean) => patch({ txTypes: ["OUT", "IN", "RETURN"].filter((x) => (x === t ? on : types.includes(x))).join(",") });
  const n = (i: number) => (isRpa ? i + 1 : i);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-extrabold text-ink-soft">SYSTEM</span>
        {(
          [
            [false, "🧾 PR", "PR page → APPROVED LIST → EXPORT → EXPORT PATH"],
            [true, "📡 MULTI-SCANNER (EXPORT RPA)", "Multi-Scanner → HISTORY → EXPORT → EXPORT RPA"],
          ] as const
        ).map(([v, l, tip]) => (
          <button
            key={String(v)}
            title={tip}
            onClick={() => {
              setIsRpa(v);
              setCur(null);
              setSheets([]);
            }}
            className={`rounded-xl px-3 py-1.5 text-sm font-extrabold ${isRpa === v ? "bg-accent text-white" : "bg-surface-2 text-primary"}`}
          >
            {l}
          </button>
        ))}
      </div>

      {rows.length === 0 || !row ? (
        <Empty />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
          <div>
            <span className={L}>1. STOCK</span>
            <div className="grid max-h-[55vh] gap-1 overflow-auto">
              {rows.map((r) => (
                <button
                  key={r.stkId}
                  onClick={() => {
                    setCur(r.stkId);
                    setSheets([]);
                  }}
                  className={`rounded-lg border-2 px-3 py-2 text-left ${r.stkId === row.stkId ? "border-accent bg-surface-2" : "border-line/60"}`}
                >
                  <div className="font-extrabold text-primary">
                    {r.code}
                    {isChanged(r, isRpa) && (
                      <span className="ml-1 text-warning" title="Changed - not saved yet">
                        ●
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[11px] font-semibold text-ink-soft">
                    {isRpa
                      ? !r.path.trim()
                        ? "no Excel file"
                        : (r.addSheet ? "ADD SHEET · " : "CONTINUE · ") + r.path.split(/[\\/]/).pop()
                      : (r.keepPr ? "KEEP PR · " : "") + (r.path.trim() ? r.path.split(/[\\/]/).pop() : "no Excel file")}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid content-start gap-4">
            <div>
              <span className={L}>2. EXCEL FILE</span>
              <div className="flex flex-wrap gap-2">
                <input className="field min-w-0 flex-1" value={row.path} placeholder="ชื่อไฟล์ใน CHR-Synchron (storage/excel)" onChange={(e) => patch({ path: e.target.value })} />
                <button className="btn bg-info" onClick={() => fileRef.current?.click()}>
                  ⤒ UPLOAD
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) uploadFile(f);
                  }}
                />
              </div>
              {row.path.trim() && <div className={`mt-1 text-[11px] font-bold ${row.fileFound ? "text-success" : "text-warning"}`}>{row.fileFound ? "✓ file is in CHR-Synchron" : "⚠ file not uploaded to CHR-Synchron yet"}</div>}
            </div>

            {isRpa && (
              <div className="grid gap-2">
                <span className={L}>3. HOW TO WRITE</span>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      [false, "⤓ CONTINUE BELOW THE LAST ROW", "Every export adds its rows under the last row that has data (same sheet)"],
                      [true, "＋ ADD A NEW SHEET FROM THE TEMPLATE", "Every export copies the TEMPLATE SHEET to a new sheet (NEW SHEET NAME) and writes the rows there"],
                    ] as const
                  ).map(([v, l, tip]) => (
                    <label key={String(v)} title={tip} className={`flex cursor-pointer items-center gap-2 rounded-lg border-2 px-3 py-1.5 text-xs font-extrabold ${!!row.addSheet === v ? "border-accent text-accent" : "border-line"}`}>
                      <input type="radio" checked={!!row.addSheet === v} onChange={() => patch({ addSheet: v, ...(v && !(row.sheetName ?? "").trim() ? { sheetName: "RPA {DATE}" } : {}) })} />
                      {l}
                    </label>
                  ))}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label>
                    <span className={L}>{row.addSheet ? "TEMPLATE SHEET  (copied for every export)" : "SHEET  (rows are added under its last row)"}</span>
                    <div className="flex gap-2">
                      <input className="field" title="Sheet name in the file (empty = the 1st sheet)" value={row.baseSheet ?? ""} onChange={(e) => patch({ baseSheet: e.target.value })} />
                      <button className="btn-ghost whitespace-nowrap" title="Read the sheet names from the file and pick one" onClick={loadSheets}>
                        ↻ SHEETS
                      </button>
                    </div>
                  </label>
                  {row.addSheet && (
                    <label>
                      <span className={L}>NEW SHEET NAME</span>
                      <input className="field" value={row.sheetName ?? ""} onChange={(e) => patch({ sheetName: e.target.value })} />
                    </label>
                  )}
                </div>
                {sheets.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {sheets.map((s) => (
                      <button key={s} className="btn-ghost px-2 py-0.5 text-xs" title="Use this sheet" onClick={() => patch({ baseSheet: s })}>
                        📄 {s}
                      </button>
                    ))}
                  </div>
                )}
                {row.addSheet && (
                  <p className="text-[11px] font-semibold text-ink-soft">
                    {"{DATE} = the day (20-10-2026)  ·  {STOCK} = stock code  ·  +1 or {N} = running no. (RPA-{DATE}+1 → RPA-20-10-2026-1, -2, -3 ...)"}
                    <br />
                    ADD A NEW SHEET: put the main sheet in the file once (e.g. &quot;RPA&quot; with the header row) and type its name in TEMPLATE SHEET. Every EXPORT RPA copies that sheet to a new sheet named by NEW SHEET NAME (e.g.
                    RPA {"{DATE}"} → &quot;RPA 20-10-2026&quot;) and writes the scans there. After the RPA has used it, delete that new sheet - the main sheet stays as it is for the next export. The same name again = it asks
                    before writing over it.
                  </p>
                )}
              </div>
            )}

            <div>
              <span className={L}>{n(3)}. TABLE START ROW</span>
              <input className="field w-28" inputMode="numeric" value={row.startRow} onChange={(e) => patch({ startRow: Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1) })} />
              <p className="mt-1 text-[11px] font-semibold text-ink-soft">first row of the table (MULTI-SCANNER: a TABLE COLUMN like B3 starts at its own row) - the next export continues after the last row that has data</p>
            </div>

            {isRpa && (
              <div className="grid gap-2">
                <span className={L}>5. WHICH SCANS</span>
                <div className="flex flex-wrap items-center gap-2 text-xs font-extrabold">
                  <span className="text-ink-soft">DAY</span>
                  {(
                    [
                      ["PICK", "PICK AT EXPORT", "EXPORT RPA asks which day (today is chosen first)"],
                      ["TODAY", "TODAY", "Always today's scans"],
                      ["FILTER", "HISTORY FROM - TO", "The FROM - TO dates of the HISTORY window"],
                    ] as const
                  ).map(([v, l, tip]) => (
                    <label key={v} title={tip} className={`flex cursor-pointer items-center gap-1 rounded-lg border-2 px-2 py-1 ${row.dateMode === v ? "border-accent text-accent" : "border-line"}`}>
                      <input type="radio" checked={row.dateMode === v} onChange={() => patch({ dateMode: v })} /> {l}
                    </label>
                  ))}
                  <span className="ml-3 text-ink-soft">TYPE</span>
                  {(
                    [
                      ["OUT", "Scan OUT (withdraw)"],
                      ["IN", "Scan IN"],
                      ["RETURN", "Return to stock"],
                    ] as const
                  ).map(([t, tip]) => (
                    <label key={t} title={tip} className="flex items-center gap-1">
                      <input type="checkbox" checked={types.includes(t)} onChange={(e) => toggleType(t, e.target.checked)} /> {t}
                    </label>
                  ))}
                  <span className="text-[11px] font-semibold text-ink-soft">cancelled scans are never exported</span>
                </div>
              </div>
            )}

            <div className="grid gap-2">
              <span className={L}>{n(isRpa ? 5 : 4)}. FIELDS (ONE CELL = one value in a cell, e.g. DATE → C1 • TABLE COLUMN = one row per item, e.g. PRODUCT CODE → B)</span>
              {row.entries.map((e, i) => (
                <div key={i} className="grid items-center gap-2 sm:grid-cols-[1.5fr_1fr_1fr_auto]">
                  <select className="field" value={e.field} onChange={(x) => patchEntry(i, { field: x.target.value })}>
                    {fields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <select className="field" value={e.isTable ? "1" : "0"} onChange={(x) => patchEntry(i, { isTable: x.target.value === "1" })}>
                    <option value="0">ONE CELL</option>
                    <option value="1">TABLE COLUMN</option>
                  </select>
                  <input
                    className="field uppercase"
                    value={e.target}
                    placeholder={e.isTable ? (isRpa ? "column B or start cell B3" : "column e.g. B") : "cell e.g. C1"}
                    onChange={(x) => patchEntry(i, { target: x.target.value })}
                  />
                  <button className="btn-ghost px-2 py-1 text-danger" title="Remove this field" onClick={() => patch({ entries: row.entries.filter((_, j) => j !== i) })}>
                    ✕
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <button className="btn-ghost" title="Add a field and choose its cell or column" onClick={addField}>
                  ＋ ADD FIELD
                </button>
                <button
                  className="btn-ghost"
                  title={
                    isRpa
                      ? "Table from row 2: NO = A · SCAN DATE = B · PRODUCT CODE = C · PRODUCT NAME = D · QTY = E · EMPLOYEE ID = F · DEPARTMENT = G · USER ID = H"
                      : "DATE = C1 · DEPARTMENT = C2 · REMARK = E1 · TARGET = E2 · table from row 4: NO = A · PRODUCT CODE = B · PRODUCT NAME = C · QTY = D"
                  }
                  onClick={() => patch({ entries: (isRpa ? data.rpaDefault : data.prDefault).map((x) => ({ ...x })), startRow: isRpa ? 2 : 4 })}
                >
                  ↺ DEFAULT
                </button>
              </div>
            </div>

            <div className="rounded-xl bg-surface-2 p-3">
              <div className="mb-1 text-[11px] font-extrabold text-ink-soft">PREVIEW</div>
              <div className="whitespace-pre-line text-xs font-bold text-primary">
                {preview ||
                  "ONE CELL  :  " +
                    row.entries
                      .filter((e) => !e.isTable)
                      .map((e) => `${e.target} = ${label(e.field)}`)
                      .join("   ")}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <span className="text-xs font-bold text-warning">{status}</span>
        <button className="btn bg-success ml-auto" disabled={busy || changed.length === 0 || !canSave} onClick={() => save()}>
          💾 SAVE
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 🏢 DEPARTMENTS
function DeptPanel({ onDirty }: { onDirty: (v: boolean) => void }) {
  const toast = useToast();
  const [names, setNames] = useState<string[] | null>(null);
  const [orig, setOrig] = useState("");
  const [canSave, setCanSave] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ canSave: boolean; names: string[] }>("/setup/departments");
      setNames(r.names);
      setOrig(r.names.join("\n"));
      setCanSave(r.canSave);
    } catch (e) {
      toast.show("ERROR", "โหลดรายการแผนกไม่สำเร็จ\n" + (e as Error).message, "error");
      setNames([]);
    }
  }, [toast]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const current = (names ?? []).map((n) => n.trim()).join("\n");
  const dirty = names !== null && current !== orig;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  function add() {
    const n = text.trim();
    if (!n || !names) return;
    if (names.some((x) => x.trim().toLowerCase() === n.toLowerCase())) return toast.show("WARNING", `มีแผนก "${n}" อยู่แล้ว`, "warn");
    setNames([...names, n]);
    setText("");
  }

  const move = (i: number, d: number) =>
    setNames((ns) => {
      if (!ns || i + d < 0 || i + d >= ns.length) return ns;
      const c = [...ns];
      [c[i], c[i + d]] = [c[i + d], c[i]];
      return c;
    });

  async function save() {
    if (!names) return;
    const list = names.map((n) => n.trim());
    if (list.some((n) => !n)) return toast.show("WARNING", "มีแผนกที่ชื่อว่าง กรุณาใส่ชื่อ หรือกด ✕ เพื่อลบ", "warn");
    const seen = new Set<string>();
    for (const n of list) {
      if (seen.has(n.toLowerCase())) return toast.show("WARNING", `ชื่อแผนก "${n}" ซ้ำกัน`, "warn");
      seen.add(n.toLowerCase());
    }
    setBusy(true);
    try {
      const r = await api<{ message: string }>("/setup/departments", { method: "POST", body: list });
      toast.show("Saved", r.message, "ok");
      await load();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (!names) return <Loading />;
  return (
    <div className="grid gap-3">
      <p className="text-xs font-bold text-ink-soft">
        The DEPARTMENT dropdown of the Multi-Scanner page • shown for the stocks whose PERMISSION → SCAN STOCKS has DEPT on • every scan of those stocks saves the chosen department
      </p>
      <div className="flex gap-2">
        <input className="field" autoFocus value={text} placeholder="DEPARTMENT NAME" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())} />
        <button className="btn bg-accent" onClick={add}>
          ＋ ADD
        </button>
      </div>
      {names.length === 0 ? (
        <Empty>NO DEPARTMENT YET - type a name above and press ＋ ADD</Empty>
      ) : (
        <div className="grid gap-1">
          {names.map((n, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-8 text-center font-extrabold text-ink-soft">{i + 1}</span>
              <input className="field" title="Click to edit the name" value={n} onChange={(e) => setNames((ns) => ns!.map((x, j) => (j === i ? e.target.value : x)))} />
              <button className="btn-ghost px-2 py-1" title="Move up" onClick={() => move(i, -1)}>
                ▲
              </button>
              <button className="btn-ghost px-2 py-1" title="Move down" onClick={() => move(i, 1)}>
                ▼
              </button>
              <button className="btn-ghost px-2 py-1 text-danger" title="Delete" onClick={() => setNames((ns) => ns!.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3">
        <span className="text-xs font-bold text-ink-soft">
          {!canSave ? "⚠ Run Database/Update_20261020b.sql first - cannot save yet" : dirty ? `${names.length} department(s) - changed, press SAVE` : `${names.length} department(s)`}
        </span>
        <button className="btn bg-success ml-auto" disabled={busy || !canSave || !dirty} onClick={save}>
          💾 SAVE
        </button>
      </div>
    </div>
  );
}
