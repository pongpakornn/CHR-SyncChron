"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toasts";
import { DateRange } from "@/components/ui/DateRange";
import { useDialogs } from "@/components/ui/Dialogs";
import { Badge, Empty, Loading, SearchBox } from "@/components/ui/Page";
import { api, download, upload } from "@/lib/api";
import { monthStart, today } from "@/lib/format";
import { useDebounced } from "@/lib/useDebounced";
import type { Pr } from "./types";

type PathStock = { stkId: number; code: string; name: string; file: string; fileFound: boolean; fields: string; startRow: number };
type Data = { rows: Pr[]; hasCoil: boolean; exportStocks: { stkId: number; code: string; name: string }[]; pathStocks: PathStock[] };

// ✔ APPROVED LIST (PRApprovedWindow): ค้นหา / ช่วงวันที่ / EXPORT (ไฟล์ใหม่ หรือ ต่อลงไฟล์ของคลัง) / EDIT / DEL
export function ApprovedModal({
  stock,
  can,
  onClose,
}: {
  stock: { stkId: number; code: string } | null;
  can: { edit: boolean; delete: boolean; approve: boolean };
  onClose: (changed: boolean) => void;
}) {
  const toast = useToast();
  const dlg = useDialogs();
  const [key, setKey] = useState("");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [data, setData] = useState<Data | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [changed, setChanged] = useState(false);
  const [choose, setChoose] = useState<"MODE" | "FILE" | "PATH" | null>(null);
  const [edit, setEdit] = useState<Pr | null>(null);
  const k = useDebounced(key, 250);

  const load = useCallback(async () => {
    try {
      const r = await api<Data>("/pr/approved", { query: { key: k, from, to, stkId: stock?.stkId } });
      setData(r);
      setSel((s) => s.filter((n) => r.rows.some((x) => x.prNumber === n)));
    } catch (e) {
      toast.show("Approved PR", "โหลดรายการไม่สำเร็จ: " + (e as Error).message, "error");
    }
  }, [k, from, to, stock, toast]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const rows = data?.rows ?? [];
  const picked = rows.filter((r) => sel.includes(r.prNumber));

  async function doExport(mode: "FILE" | "PATH", s: { stkId: number; code: string } | null) {
    setChoose(null);
    const items = s ? picked.filter((r) => r.stockID === null || r.stockID === s.stkId) : picked;
    if (items.length === 0) return toast.show("WARNING", `ไม่มีรายการที่ติ๊กของคลัง ${s?.code}`, "warn");
    const again = items.filter((r) => r.isExported).length;
    const ps = data?.pathStocks.find((x) => x.stkId === s?.stkId);
    const ok = await dlg.confirm({
      title: mode === "PATH" ? "EXPORT PATH" : "EXPORT PR",
      message:
        mode === "PATH"
          ? `ต่อข้อมูล PR ${items.length} รายการ ลงไฟล์ของ ${s?.code}${again ? `\n(เคย Export แล้ว ${again} รายการ)` : ""}\n\n${ps?.file}\n\n${ps?.fields}\nเริ่มแถว ${ps?.startRow} (มีข้อมูลแล้ว = ต่อจากแถวสุดท้าย)\n\nยืนยันหรือไม่?`
          : `Export PR ${items.length} รายการ ของ ${s?.code ?? "ทุกคลัง"}${again ? `\n(เคย Export แล้ว ${again} รายการ จะถูก Export ซ้ำ)` : ""}\n\nยืนยันหรือไม่?`,
    });
    if (!ok) return;
    try {
      if (mode === "FILE") {
        await download("/pr/export", undefined, { mode, prNos: items.map((r) => r.prNumber), stkId: s?.stkId });
        toast.show("Export complete", `Export PR แล้ว ${items.length} รายการ`, "ok");
      } else {
        const r = await api<{ message: string; stkId: number }>("/pr/export", { method: "POST", body: { mode, prNos: items.map((x) => x.prNumber), stkId: s?.stkId } });
        toast.show("Export complete", r.message, "ok");
        download(`/pr/file/${r.stkId}`).catch(() => {});
      }
      setSel([]);
      setChanged(true);
      load();
    } catch (e) {
      toast.show("ERROR", "Export ไม่สำเร็จ: " + (e as Error).message, "error");
    }
  }

  async function remove(p: Pr) {
    if (!(await dlg.confirm({ title: "DELETE PR", danger: true, message: `ลบ ${p.prNumber}\n${p.partName}  จำนวน ${p.qty.toLocaleString()}\n\nลบแล้วกู้คืนไม่ได้ ยืนยันหรือไม่?` }))) return;
    try {
      const r = await api<{ message: string }>(`/pr/${encodeURIComponent(p.prNumber)}`, { method: "DELETE" });
      toast.show("Deleted", r.message, "ok");
      setChanged(true);
      load();
    } catch (e) {
      toast.show("ERROR", "ลบไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }

  return (
    <>
      <Modal
        open
        wide
        title="✔ APPROVED LIST"
        onClose={() => onClose(changed)}
        footer={
          <>
            <span className="mr-auto self-center text-xs font-bold text-ink-soft">
              {rows.length} APPROVED PR • {rows.filter((r) => !r.isExported).length} NOT EXPORTED YET • {sel.length} SELECTED
            </span>
            {can.approve && (
              <button className="btn bg-success" disabled={sel.length === 0} onClick={() => setChoose("MODE")}>
                📤 EXPORT
              </button>
            )}
          </>
        }
      >
        <p className="mb-3 text-sm font-semibold text-ink-soft">{stock ? `STOCK : ${stock.code} • ` : ""}Search, pick a date range, tick the items and export / edit / delete</p>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <SearchBox className="min-w-[220px] flex-1" value={key} onChange={setKey} placeholder="ค้นหา PR NO / สินค้า" />
          <DateRange from={from} to={to} onChange={(f, t) => (setFrom(f), setTo(t))} />
        </div>
        {!data ? (
          <Loading />
        ) : (
          <div className="overflow-auto rounded-xl border border-line">
            <table className="data-table w-full">
              <thead className="sticky top-0">
                <tr>
                  <th>
                    <input type="checkbox" checked={rows.length > 0 && rows.every((r) => sel.includes(r.prNumber))} onChange={(e) => setSel(e.target.checked ? rows.map((r) => r.prNumber) : [])} />
                  </th>
                  <th>PR NO</th>
                  <th>DATE</th>
                  <th>APPROVED</th>
                  <th>STOCK</th>
                  <th>PRODUCT</th>
                  {data.hasCoil && <th>MASTER COIL</th>}
                  {data.hasCoil && <th>COIL NO</th>}
                  <th className="text-right">QTY</th>
                  <th>DEPARTMENT</th>
                  <th>TARGET</th>
                  <th>EXPORT</th>
                  {(can.edit || can.delete) && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.prNumber}>
                    <td>
                      <input type="checkbox" checked={sel.includes(p.prNumber)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, p.prNumber] : s.filter((x) => x !== p.prNumber)))} />
                    </td>
                    <td className="whitespace-nowrap font-extrabold text-primary">{p.prNumber}</td>
                    <td className="whitespace-nowrap text-xs">{p.date}</td>
                    <td className="whitespace-nowrap text-xs">{p.appDate}</td>
                    <td>{p.stockCode}</td>
                    <td>
                      <div>{p.partCode}</div>
                      <div className="text-[11px] font-medium text-ink-soft">{p.partName}</div>
                    </td>
                    {data.hasCoil && <td className="text-xs">{p.motherCoil}</td>}
                    {data.hasCoil && <td className="text-xs">{p.coilNo}</td>}
                    <td className="text-right">{p.qty.toLocaleString()}</td>
                    <td className="max-w-[180px] truncate text-xs">{p.department}</td>
                    <td className="text-xs">{p.targetDept}</td>
                    <td>
                      <Badge color={p.isExported ? "var(--info)" : "var(--warning)"}>{p.export}</Badge>
                    </td>
                    {(can.edit || can.delete) && (
                      <td className="whitespace-nowrap">
                        {can.edit && (
                          <button className="btn-ghost mr-1 px-2 py-1 text-xs" onClick={() => setEdit(p)}>
                            ✏️
                          </button>
                        )}
                        {can.delete && (
                          <button className="btn-ghost px-2 py-1 text-xs text-danger" onClick={() => remove(p)}>
                            🗑
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <Empty />}
          </div>
        )}
      </Modal>

      {/* เลือกแบบ Export -> เลือกคลัง */}
      <Modal open={choose !== null} title="📤 EXPORT PR" onClose={() => setChoose(null)}>
        {choose === "MODE" && (
          <div className="grid gap-2">
            <p className="mb-1 text-sm font-semibold text-ink-soft">เลือกแบบการ Export PR ที่ติ๊กไว้ {sel.length} รายการ</p>
            <button className="rounded-xl border-2 border-line p-4 text-left hover:border-accent" onClick={() => ((data?.exportStocks.length ?? 0) > 0 ? setChoose("FILE") : doExport("FILE", null))}>
              <div className="font-extrabold text-primary">📤 EXPORT</div>
              <div className="text-sm">สร้างไฟล์ใหม่ PR-{today()}.xlsx (ดาวน์โหลด)</div>
            </button>
            <button
              className="rounded-xl border-2 border-line p-4 text-left hover:border-accent"
              onClick={() => ((data?.pathStocks.length ?? 0) > 0 ? setChoose("PATH") : toast.show("WARNING", "ยังไม่มีคลังที่ตั้งไฟล์ Excel\nตั้งได้ที่ User Management -> ⚙ SETUP -> EXCEL SETUP (Admin)", "warn"))}
            >
              <div className="font-extrabold text-primary">📥 EXPORT PATH</div>
              <div className="text-sm">ต่อข้อมูลลงไฟล์ Excel ของคลัง ตามช่องที่ตั้งไว้ (ไฟล์ของ CHR-Synchron)</div>
              <div className="text-xs text-ink-soft">{data?.pathStocks.map((s) => s.code).join("  •  ")}</div>
            </button>
          </div>
        )}
        {(choose === "FILE" || choose === "PATH") && (
          <div className="grid gap-2">
            <p className="mb-1 text-sm font-semibold text-ink-soft">{choose === "PATH" ? "เลือกคลัง: ระบบต่อรายการที่ติ๊กลงไฟล์ Excel ของคลังนั้น" : "เลือกคลัง"}</p>
            {(choose === "PATH" ? data?.pathStocks ?? [] : data?.exportStocks ?? []).map((s) => (
              <div key={s.stkId} className="flex items-center gap-2 rounded-xl border-2 border-line p-3">
                <button className="flex-1 text-left" onClick={() => (choose === "PATH" && !(s as PathStock).fileFound ? toast.show("WARNING", "ยังไม่มีไฟล์ใน CHR-Synchron - กด UPLOAD ก่อน", "warn") : doExport(choose, s))}>
                  <div className="font-extrabold text-primary">{s.code}</div>
                  <div className="text-xs text-ink-soft">{choose === "PATH" ? `📊 ${(s as PathStock).file}${(s as PathStock).fileFound ? "" : " • ⚠ ยังไม่มีไฟล์"}` : s.name}</div>
                </button>
                {choose === "PATH" && (
                  <label className="btn-ghost cursor-pointer px-3 py-1 text-xs">
                    📤 UPLOAD
                    <input
                      type="file"
                      accept=".xlsx"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) return;
                        try {
                          await upload(`/pr/file/${s.stkId}`, file);
                          toast.show("PR FILE", `${s.code}: อัปโหลดแล้ว`, "ok");
                          load();
                        } catch (err) {
                          toast.show("ERROR", (err as Error).message, "error");
                        }
                      }}
                    />
                  </label>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>

      {edit && (
        <EditModal
          pr={edit}
          onClose={() => setEdit(null)}
          onSaved={(msg) => {
            setEdit(null);
            toast.show("Saved", msg, "ok");
            setChanged(true);
            load();
          }}
        />
      )}
    </>
  );
}

// ✏️ แก้ไข PR (PREditWindow): QTY / DEPARTMENT / TARGET / REMARK
function EditModal({ pr, onClose, onSaved }: { pr: Pr; onClose: () => void; onSaved: (msg: string) => void }) {
  const toast = useToast();
  const [v, setV] = useState({ qty: String(pr.qty), dept: pr.department ?? "", target: pr.targetDept ?? "", remark: pr.remark ?? "" });
  async function save() {
    const q = Number(v.qty);
    if (!Number.isInteger(q) || q <= 0) return toast.show("WARNING", "จำนวนต้องมากกว่า 0", "warn");
    if (!v.dept.trim()) return toast.show("WARNING", "กรุณากรอก Department", "warn");
    try {
      const r = await api<{ message: string }>(`/pr/${encodeURIComponent(pr.prNumber)}`, { method: "PUT", body: { qty: q, dept: v.dept, target: v.target, remark: v.remark } });
      onSaved(r.message);
    } catch (e) {
      toast.show("ERROR", "แก้ไขไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }
  const field = (label: string, k: keyof typeof v, numeric = false) => (
    <label className="block">
      <span className="mb-1 block text-[11px] font-extrabold uppercase text-ink-soft">{label}</span>
      <input className="field" inputMode={numeric ? "numeric" : undefined} value={v[k]} onChange={(e) => setV({ ...v, [k]: numeric ? e.target.value.replace(/\D/g, "") : e.target.value })} />
    </label>
  );
  return (
    <Modal
      open
      title={`✏️ EDIT • ${pr.prNumber}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            CANCEL
          </button>
          <button className="btn bg-accent" onClick={save}>
            SAVE
          </button>
        </>
      }
    >
      <div className="mb-3 font-bold">{pr.partName}</div>
      <div className="grid gap-3">
        {field("QTY", "qty", true)}
        {field("DEPARTMENT", "dept")}
        {field("TARGET", "target")}
        {field("REMARK", "remark")}
      </div>
    </Modal>
  );
}
