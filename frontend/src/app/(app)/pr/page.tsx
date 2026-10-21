"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toasts";
import { useDialogs } from "@/components/ui/Dialogs";
import { Badge, Card, Empty, Loading, PageBody, PageHeader, SearchBox } from "@/components/ui/Page";
import { api, download } from "@/lib/api";
import { useDebounced } from "@/lib/useDebounced";
import { ApprovedModal } from "./ApprovedModal";
import { STATUS_COLOR, type Pr } from "./types";


type Meta = {
  can: { submit: boolean; edit: boolean; delete: boolean; approve: boolean; deleteAll: boolean };
  hasPrStock: boolean;
  stocks: { stkId: number; code: string; name: string; countCoil: boolean }[];
  selected: number | null;
  userName: string;
  today: string;
  noStockText: string | null;
};
type PartOpt = { partId: number; code: string; name: string; inStock: boolean };


// 🧾 PURCHASE REQUEST (PRView + PRViewModel)
export default function PrPage() {
  const toast = useToast();
  const dlg = useDialogs();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [stk, setStk] = useState<number | null>(null);
  const [key, setKey] = useState("");
  const [rows, setRows] = useState<Pr[] | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [part, setPart] = useState<PartOpt | null>(null);
  const [opts, setOpts] = useState<PartOpt[]>([]);
  const [qtyText, setQtyText] = useState("");
  const [f, setF] = useState({ requester: "", dept: "", remark: "", target: "" });
  const [look, setLook] = useState<Record<string, string[]>>({});
  const [viewing, setViewing] = useState<Pr | null>(null);
  const [approve, setApprove] = useState<Pr | null>(null);
  const [approvedOpen, setApprovedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const k = useDebounced(key, 400);
  const codeK = useDebounced(code, 250);
  const sigRef = useRef("");

  useEffect(() => {
    api<Meta>("/pr/meta")
      .then((m) => {
        setMeta(m);
        setStk(m.selected);
        setF((x) => ({ ...x, requester: m.userName }));
      })
      .catch((e) => toast.show("ERROR", e.message, "error"));
  }, [toast]);

  const load = useCallback(
    async (onlyIfChanged = false) => {
      if (!meta) return;
      try {
        const r = await api<{ signature: string; rows: Pr[] }>("/pr", { query: { key: k, stkId: stk ?? undefined } });
        if (onlyIfChanged && r.signature === sigRef.current) return;
        sigRef.current = r.signature;
        setRows(r.rows);
        setSel((s) => s.filter((n) => r.rows.some((x) => x.prNumber === n)));
      } catch (e) {
        if (!onlyIfChanged) toast.show("ERROR", "โหลดข้อมูล PR ไม่สำเร็จ: " + (e as Error).message, "error");
      }
    },
    [meta, k, stk, toast],
  );

  useEffect(() => {
    const t = setTimeout(() => load(), 0);
    const live = setInterval(() => !document.hidden && load(true), 5000);
    return () => (clearTimeout(t), clearInterval(live));
  }, [load]);

  useEffect(() => {
    if (!codeK.trim() || part) {
      queueMicrotask(() => setOpts([]));
      return;
    }
    let alive = true;
    api<PartOpt[]>("/pr/parts", { query: { key: codeK, stkId: stk ?? undefined } })
      .then((r) => {
        if (!alive) return;
        setOpts(r);
        const exact = r.filter((o) => o.code.toLowerCase() === codeK.trim().toLowerCase());
        if (exact.length === 1) setPart(exact[0]);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [codeK, stk, part]);

  const lookup = async (field: string, text: string) => {
    try {
      const r = await api<string[]>("/pr/lookups", { query: { field, text } });
      setLook((l) => ({ ...l, [field]: r }));
    } catch {
      /* ไม่มีรายการแนะนำก็พิมพ์เองได้ */
    }
  };

  if (!meta) return <Loading />;
  const can = meta.can;
  const stock = meta.stocks.find((s) => s.stkId === stk) ?? null;

  function clear() {
    setViewing(null);
    setPart(null);
    setCode("");
    setQtyText("");
    setF({ requester: meta!.userName, dept: "", remark: "", target: "" });
  }

  async function submit() {
    if (meta!.hasPrStock && !stock) return toast.show("WARNING", "กรุณาเลือกคลัง (STOCK) ก่อนครับ", "warn");
    if (!part) return toast.show("WARNING", "กรุณาเลือก Product Code ที่มีในระบบ (พิมพ์รหัสแล้วเลือกจากรายการ)", "warn");
    const q = Number(qtyText);
    if (!Number.isInteger(q) || q <= 0) return toast.show("WARNING", "กรุณาใส่ QTY เป็นตัวเลขมากกว่า 0", "warn");
    if (!f.requester.trim() || !f.dept.trim() || !f.target.trim()) return toast.show("WARNING", "กรุณากรอก Requester, Department และ Target Dept ให้ครบถ้วน", "warn");
    setBusy(true);
    try {
      const r = await api<{ prNo: string; message: string }>("/pr", { method: "POST", body: { stkId: stk, partId: part.partId, partCode: part.code, qty: q, ...f } });
      toast.show("PR", `${r.message} • ${r.prNo}`, "ok");
      clear();
      load();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function reject(p: Pr) {
    if (!(await dlg.confirm({ title: "ยืนยัน", danger: true, ok: "REJECT", message: `คุณต้องการ Reject รายการ ${p.prNumber} ใช่หรือไม่?` }))) return;
    try {
      await api(`/pr/${encodeURIComponent(p.prNumber)}/reject`, { method: "POST" });
      load();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  async function deleteAll() {
    const list = (rows ?? []).map((r) => r.prNumber);
    if (list.length === 0) return toast.show("WARNING", "ไม่มี PR ในตารางให้ลบ", "warn");
    const by = Object.entries((rows ?? []).reduce<Record<string, number>>((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {}))
      .map(([s, n]) => `${s} ${n}`)
      .join("  •  ");
    if (!(await dlg.confirm({ title: "DELETE ALL PR", danger: true, message: `ลบ PR ทั้งหมดที่แสดงในตาราง ${list.length} รายการ${key ? `\n(เฉพาะที่ค้นหา "${key}")` : ""}\n${by}\n\nลบแล้วกู้คืนไม่ได้ ยืนยันหรือไม่?` }))) return;
    if (!(await dlg.confirm({ title: "DELETE ALL PR", danger: true, message: `ยืนยันอีกครั้ง: ลบ PR ${list.length} รายการ` }))) return;
    try {
      const r = await api<{ message: string }>("/pr/delete-all", { method: "POST", body: { prNos: list, key } });
      toast.show("Deleted", r.message, "ok");
      clear();
      load();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    }
  }

  async function exportSelected() {
    if (sel.length === 0) return toast.show("WARNING", "เลือกรายการก่อนครับ", "warn");
    try {
      await download("/pr/export", undefined, { mode: "FILE", prNos: sel, stkId: stk });
      toast.show("Export", "ส่งออกเรียบร้อย", "ok");
      setSel([]);
      load();
    } catch (e) {
      toast.show("ERROR", "Export ไม่สำเร็จ: " + (e as Error).message, "error");
    }
  }

  const lookInput = (label: string, field: string, k: keyof typeof f) => (
    <label className="block">
      <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">{label}</span>
      <input
        className="field"
        list={`dl-${field}`}
        value={f[k]}
        onFocus={() => lookup(field, "")}
        onChange={(e) => {
          setF({ ...f, [k]: e.target.value });
          lookup(field, e.target.value);
        }}
        readOnly={!!viewing}
      />
      <datalist id={`dl-${field}`}>{(look[field] ?? []).map((v) => <option key={v} value={v} />)}</datalist>
    </label>
  );

  const all = rows ?? [];
  const allSel = all.length > 0 && all.every((r) => sel.includes(r.prNumber));
  const coil = !!stock?.countCoil;

  return (
    <PageBody>
      <PageHeader
        icon="/icons/PR.png"
        title="PURCHASE REQUISITION"
        subtitle={stock ? `STOCK : ${stock.code} • ${stock.name}` : "PR"}
        actions={
          <>
            {meta.hasPrStock && meta.stocks.length > 0 && (
              <select
                className="field w-auto"
                value={stk ?? ""}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setStk(v);
                  clear();
                  api("/pr/stock", { method: "POST", body: v }).catch(() => {});
                }}
              >
                {meta.stocks.map((s) => (
                  <option key={s.stkId} value={s.stkId}>
                    {s.code}
                  </option>
                ))}
              </select>
            )}
            <button className="btn bg-success" onClick={() => setApprovedOpen(true)}>
              ✔ APPROVED LIST
            </button>
          </>
        }
      />
      {meta.noStockText && <div className="rounded-xl bg-[#fff3e0] p-3 text-sm font-bold text-warning">{meta.noStockText}</div>}

      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        <Card
          title={viewing ? `👁 ${viewing.prNumber}` : "＋ NEW PR"}
          actions={
            viewing && (
              <button className="btn-ghost px-3 py-1 text-xs" onClick={clear}>
                CLEAR
              </button>
            )
          }
          bodyClass="grid gap-3 p-4"
          className="self-start xl:sticky xl:top-4"
        >
          <label className="block">
            <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">PR DATE</span>
            <input className="field bg-surface-2" readOnly value={viewing?.date ?? meta.today} />
          </label>
          <div className="relative">
            <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">PRODUCT CODE</span>
            <input
              className="field"
              value={viewing ? viewing.partCode : code}
              readOnly={!!viewing}
              onChange={(e) => {
                setCode(e.target.value);
                if (part && part.code.toLowerCase() !== e.target.value.trim().toLowerCase()) setPart(null);
              }}
              placeholder="พิมพ์รหัสแล้วเลือกจากรายการ"
            />
            {!viewing && !part && opts.length > 0 && (
              <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-line bg-surface shadow-xl">
                {opts.map((o) => (
                  <button
                    key={o.partId}
                    type="button"
                    className="block w-full border-b border-line/60 px-3 py-2 text-left hover:bg-surface-2"
                    onClick={() => {
                      setPart(o);
                      setCode(o.code);
                      setOpts([]);
                    }}
                  >
                    <div className="text-sm font-extrabold text-primary">
                      {o.code} {o.inStock && <Badge color="var(--success)">IN STOCK</Badge>}
                    </div>
                    <div className="truncate text-xs">{o.name}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <label className="block">
            <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">PRODUCT NAME</span>
            <input className="field bg-surface-2" readOnly value={viewing ? viewing.partName : part?.name ?? ""} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">QTY</span>
            <input className="field" inputMode="numeric" readOnly={!!viewing} value={viewing ? String(viewing.qty) : qtyText} onChange={(e) => setQtyText(e.target.value.replace(/\D/g, ""))} />
          </label>
          {lookInput("REQUESTER", "REQUESTER", "requester")}
          {lookInput("DEPARTMENT", "DEPT", "dept")}
          {lookInput("REMARK", "REMARK", "remark")}
          {lookInput("TARGET DEPT", "TARGET", "target")}
          {can.submit && !viewing && (
            <button className="btn mt-1 bg-accent py-3" disabled={busy || (meta.hasPrStock && !stock)} onClick={submit}>
              📨 SUBMIT PR
            </button>
          )}
        </Card>

        <Card
          title={`PR LIST • ${all.length.toLocaleString()}`}
          actions={
            <>
              <button className="btn bg-success py-1.5" onClick={exportSelected} disabled={!can.approve}>
                📤 EXPORT {sel.length > 0 ? `(${sel.length})` : ""}
              </button>
              {can.deleteAll && (
                <button className="btn bg-danger py-1.5" onClick={deleteAll}>
                  🗑 DELETE ALL
                </button>
              )}
            </>
          }
        >
          <div className="border-b border-line/60 p-3">
            <SearchBox value={key} onChange={setKey} placeholder="ค้นหา PR NO / รหัส / ชื่อสินค้า / ผู้ขอ" />
          </div>
          <div className="max-h-[calc(100dvh-280px)] min-h-[360px] overflow-auto">
            {!rows ? (
              <Loading />
            ) : all.length === 0 ? (
              <Empty />
            ) : (
              <table className="data-table w-full">
                <thead className="sticky top-0">
                  <tr>
                    <th>
                      <input type="checkbox" checked={allSel} onChange={(e) => setSel(e.target.checked ? all.map((r) => r.prNumber) : [])} />
                    </th>
                    <th>PR NO</th>
                    <th>DATE</th>
                    <th>PRODUCT</th>
                    {coil && <th>MASTER COIL</th>}
                    {coil && <th>COIL NO</th>}
                    <th className="text-right">QTY</th>
                    <th>STATUS</th>
                    <th>REQUESTER</th>
                    <th>DEPARTMENT</th>
                    <th className="text-right">ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {all.map((p) => (
                    <tr key={p.prNumber} className={viewing?.prNumber === p.prNumber ? "bg-accent-soft/40" : ""}>
                      <td>
                        <input type="checkbox" checked={sel.includes(p.prNumber)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, p.prNumber] : s.filter((x) => x !== p.prNumber)))} />
                      </td>
                      <td className="whitespace-nowrap font-extrabold text-primary">{p.prNumber}</td>
                      <td className="whitespace-nowrap text-xs">{p.date}</td>
                      <td>
                        <div>{p.partCode}</div>
                        <div className="text-[11px] font-medium text-ink-soft">{p.partName}</div>
                      </td>
                      {coil && <td className="text-xs">{p.motherCoil}</td>}
                      {coil && <td className="text-xs">{p.coilNo}</td>}
                      <td className="whitespace-nowrap text-right">
                        {p.qty.toLocaleString()} <span className="text-[11px] text-ink-soft">{p.unit}</span>
                      </td>
                      <td>
                        <Badge color={STATUS_COLOR[p.status] ?? "var(--primary)"}>{p.status}</Badge>
                      </td>
                      <td className="whitespace-nowrap">{p.requester}</td>
                      <td className="max-w-[200px] truncate text-xs" title={p.department}>
                        {p.department}
                      </td>
                      <td className="whitespace-nowrap text-right">
                        <div className="inline-flex gap-1">
                          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => (viewing?.prNumber === p.prNumber ? clear() : (setViewing(p), setF({ requester: p.requester, dept: p.department, remark: p.remark, target: p.targetDept })))}>
                            👁
                          </button>
                          {can.approve && p.status === "Waiting" && (
                            <>
                              <button className="btn bg-success px-2 py-1 text-xs" onClick={() => setApprove(p)}>
                                ✔
                              </button>
                              <button className="btn bg-danger px-2 py-1 text-xs" onClick={() => reject(p)}>
                                ✖
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </div>

      {approve && (
        <ApproveModal
          pr={approve}
          onClose={() => setApprove(null)}
          onDone={(msg) => {
            setApprove(null);
            toast.show("Approved", msg, "ok");
            load();
          }}
        />
      )}
      {approvedOpen && (
        <ApprovedModal
          stock={stock}
          can={can}
          onClose={(changed) => {
            setApprovedOpen(false);
            if (changed) load();
          }}
        />
      )}
    </PageBody>
  );
}

// ✔ APPROVE (PRApproveWindow): อนุมัติทั้งหมด / กำหนดยอด - ยอดที่เหลือสร้าง PR ใหม่ (Waiting) หรือไม่เก็บ
function ApproveModal({ pr, onClose, onDone }: { pr: Pr; onClose: () => void; onDone: (msg: string) => void }) {
  const toast = useToast();
  const dlg = useDialogs();
  const [mode, setMode] = useState<"ALL" | "SET">("ALL");
  const [q, setQ] = useState(String(pr.qty));
  const [keep, setKeep] = useState(true);
  const n = mode === "ALL" ? pr.qty : Number(q);
  const partial = Number.isInteger(n) && n > 0 && n < pr.qty;

  async function confirm() {
    if (!Number.isInteger(n) || n <= 0 || n > pr.qty) return toast.show("WARNING", `กรุณากรอกยอดที่อนุมัติ 1 - ${pr.qty.toLocaleString()}`, "warn");
    const msg =
      `อนุมัติ ${pr.prNumber}\n${pr.partName}\n\nยอดที่อนุมัติ ${n.toLocaleString()} จาก ${pr.qty.toLocaleString()} ${pr.unit}` +
      (partial ? (keep ? `\nยอดที่เหลือ ${(pr.qty - n).toLocaleString()} จะสร้างเป็น PR ใหม่ (Waiting)` : `\nยอดที่เหลือ ${(pr.qty - n).toLocaleString()} ไม่เก็บไว้`) : "") +
      "\n\nยืนยันการอนุมัติหรือไม่?";
    if (!(await dlg.confirm({ title: "CONFIRM APPROVE", message: msg, ok: "APPROVE" }))) return;
    try {
      const r = await api<{ message: string }>(`/pr/${encodeURIComponent(pr.prNumber)}/approve`, { method: "POST", body: { qty: n, keepRemainder: partial && keep } });
      onDone(r.message);
    } catch (e) {
      toast.show("ERROR", "อนุมัติไม่สำเร็จ: " + (e as Error).message, "error");
    }
  }

  return (
    <Modal
      open
      title={`✔ APPROVE • ${pr.prNumber}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            CANCEL
          </button>
          <button className="btn bg-success" onClick={confirm}>
            CONFIRM
          </button>
        </>
      }
    >
      <div className="mb-1 font-bold">{pr.partName}</div>
      <div className="mb-4 text-sm text-ink-soft">
        REQUESTED : {pr.qty.toLocaleString()} {pr.unit}
      </div>
      <label className="mb-2 flex items-center gap-2 text-sm font-bold">
        <input type="radio" checked={mode === "ALL"} onChange={() => setMode("ALL")} /> APPROVE ALL ({pr.qty.toLocaleString()})
      </label>
      <label className="flex items-center gap-2 text-sm font-bold">
        <input type="radio" checked={mode === "SET"} onChange={() => setMode("SET")} /> SET QTY
        <input className="field ml-2 w-28" inputMode="numeric" disabled={mode !== "SET"} value={q} onChange={(e) => setQ(e.target.value.replace(/\D/g, ""))} />
        <span className="text-ink-soft">{pr.unit}</span>
      </label>
      {partial && (
        <div className="mt-4 rounded-xl bg-surface-2 p-3 text-sm">
          <div className="mb-2 font-extrabold">
            REMAINING : {(pr.qty - n).toLocaleString()} {pr.unit} (approve {n.toLocaleString()} of {pr.qty.toLocaleString()})
          </div>
          <label className="mb-1 flex items-center gap-2 font-bold">
            <input type="radio" checked={keep} onChange={() => setKeep(true)} /> KEEP AS NEW PR (Waiting)
          </label>
          <label className="flex items-center gap-2 font-bold">
            <input type="radio" checked={!keep} onChange={() => setKeep(false)} /> DON&apos;T KEEP
          </label>
        </div>
      )}
    </Modal>
  );
}
