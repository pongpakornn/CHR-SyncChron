"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toasts";
import { Loading } from "@/components/ui/Page";
import { api } from "@/lib/api";
import type { PermData, PermRow, ScanStock } from "./types";

const FLAGS = ["view", "add", "edit", "delete", "approve"] as const;
const HEAD: Record<(typeof FLAGS)[number], string> = { view: "VIEW", add: "ADD", edit: "EDIT", delete: "DEL", approve: "APPROVE" };

// 🔑 PERMISSION / 👤 USER PROFILE (UserPermissionWindow) - สิทธิ์ทุกระบบ + ทุกคลัง
//   แถว Multi-Scanner กดขยาย = คลังที่สแกนได้ + ★ OUT FIRST + DEDUCTED + EMP ID / DEPT + DISPLAY
export function PermissionModal({
  userId,
  readOnly,
  canContact,
  onClose,
  onSaved,
  onEditContacts,
}: {
  userId: string;
  readOnly: boolean;
  canContact: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
  onEditContacts: () => Promise<boolean>;
}) {
  const toast = useToast();
  const [data, setData] = useState<PermData | null>(null);
  const [rows, setRows] = useState<PermRow[]>([]);
  const [stocks, setStocks] = useState<ScanStock[]>([]);
  const [open, setOpen] = useState(readOnly);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<PermData>(`/users/${encodeURIComponent(userId)}/permissions`);
      setData(d);
      setRows(d.rows);
      setStocks(d.scanner?.stocks ?? []);
    } catch (e) {
      toast.show("ERROR", "โหลดสิทธิ์ไม่สำเร็จ\n" + (e as Error).message, "error");
      onClose();
    }
  }, [userId, toast, onClose]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const setFlag = (sysId: string, k: (typeof FLAGS)[number], v: boolean) => setRows((rs) => rs.map((r) => (r.sysId === sysId ? { ...r, [k]: v } : r)));
  const setAll = (fn: (r: PermRow) => PermRow) => setRows((rs) => rs.map(fn));

  const setStock = (id: number, patch: Partial<ScanStock>) =>
    setStocks((ss) =>
      ss.map((s) => {
        if (s.stkId !== id) return s;
        const n = { ...s, ...patch };
        if (patch.on === false) Object.assign(n, { priority: false, deduct: false, askEmployee: false, askDepartment: false });
        // เลือกคลังกลุ่มตัดข้ามคลัง = เปิด DEDUCTED ให้ก่อน (ปิดเองได้)
        if (patch.on === true && s.deductEligible && !s.deduct) n.deduct = true;
        return n;
      }),
    );
  const togglePriority = (id: number) =>
    setStocks((ss) => {
      const cur = ss.find((s) => s.stkId === id);
      const on = !cur?.priority;
      return ss.map((s) => ({ ...s, priority: s.stkId === id ? on && s.on : false }));
    });

  const on = stocks.filter((s) => s.on);
  const summary =
    on.length === 0
      ? "⛔ NOT SET - this user cannot scan (the scan page asks them to contact the Admin)"
      : "STOCKS : " +
        on.map((i) => i.code + (i.priority ? " ★" : "") + (i.deduct ? " (DEDUCTED)" : "") + (i.askEmployee ? " (EMP ID)" : "") + (i.askDepartment ? " (DEPT)" : "")).join(",  ") +
        (on.length > 1 ? "   (scan together)" : "");

  async function save() {
    setBusy(true);
    try {
      const r = await api<{ message: string }>(`/users/${encodeURIComponent(userId)}/permissions`, {
        method: "POST",
        body: { rows, scanner: data?.scanner ? stocks : null },
      });
      onSaved(r.message);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const u = data?.user;
  return (
    <Modal
      open
      wide
      title={readOnly ? "👤 USER PROFILE" : "🔑 PERMISSION"}
      onClose={onClose}
      footer={
        <>
          {!readOnly && (
            <div className="mr-auto flex flex-wrap gap-2">
              <button className="btn-ghost" onClick={() => setAll((r) => ({ ...r, view: true }))}>
                VIEW ALL
              </button>
              <button className="btn-ghost" onClick={() => setAll((r) => ({ ...r, view: true, add: true, edit: true, delete: true, approve: true }))}>
                SELECT ALL
              </button>
              <button className="btn-ghost" onClick={() => setAll((r) => ({ ...r, view: false, add: false, edit: false, delete: false, approve: false }))}>
                CLEAR
              </button>
            </div>
          )}
          <button className="btn-ghost" onClick={onClose}>
            {readOnly ? "CLOSE" : "CANCEL"}
          </button>
          {!readOnly && (
            <button className="btn bg-success" disabled={busy || !data} onClick={save}>
              SAVE PERMISSION
            </button>
          )}
        </>
      }
    >
      {!data || !u ? (
        <Loading />
      ) : (
        <div className="grid gap-3">
          <div className="text-sm font-extrabold text-primary">{`${u.userId}  •  ${u.name}  •  ${u.levelText}`}</div>
          {u.level === 1 && <div className="rounded-xl bg-[#fff3e0] px-3 py-2 text-xs font-bold text-[#e65100]">LEVEL 1 (ADMIN) can see and do everything without these settings.</div>}

          {readOnly && (
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["USER ID", u.userId],
                  ["NAME", u.name],
                  ["POSITION", u.position],
                  ["UNIT", u.department],
                  ["SECTION", u.section],
                  ["DIVISION", u.division],
                  ["LEVEL", u.levelText],
                  ["STATUS", u.statusText],
                  ["LAST LOGIN", u.lastLogin ? new Date(u.lastLogin).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "-"],
                ] as const
              ).map(([l, v]) => (
                <div key={l} className="min-w-[140px] rounded-xl bg-surface-2 px-3 py-1.5">
                  <div className="text-[10px] font-bold text-ink-soft">{l}</div>
                  <div className="text-sm font-extrabold">{v?.trim() ? v : "-"}</div>
                </div>
              ))}
            </div>
          )}

          {data.contacts !== null && !readOnly && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line/60 p-3">
              <div className="min-w-0 flex-1 whitespace-pre-line text-xs font-semibold text-ink-soft">
                <span className="font-extrabold text-primary">🔔 ALERT CONTACT : </span>
                {data.contacts}
              </div>
              {canContact && (
                <button
                  className="btn bg-danger px-3 py-1 text-xs"
                  onClick={async () => {
                    if (await onEditContacts()) load();
                  }}
                >
                  🔔 SET ALERT CONTACT
                </button>
              )}
            </div>
          )}

          <div className="overflow-auto rounded-xl border border-line/60">
            <table className="data-table w-full">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th>SYSTEM</th>
                  {FLAGS.map((k) => (
                    <th key={k} className="w-20 text-center">
                      {HEAD[k]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const head = i === 0 || r.group !== rows[i - 1].group ? r.group : null;
                  const ms = r.sysId.toLowerCase() === "multiscanner" && data.scanner;
                  return (
                    <Fragment key={r.sysId}>
                      {head && (
                        <tr>
                          <td colSpan={6} className="bg-surface-2 text-xs font-extrabold uppercase text-accent">
                            {head}
                          </td>
                        </tr>
                      )}
                      <tr>
                        <td>
                          <div className="font-extrabold">{r.title}</div>
                          {r.hint && <div className="text-[11px] font-semibold text-ink-soft">{r.hint}</div>}
                          {ms && (
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <button className="btn-ghost px-2 py-0.5 text-[11px]" onClick={() => setOpen((o) => !o)}>
                                {(open ? "▾" : "▸") + " SCAN STOCKS + DISPLAY"}
                              </button>
                              <span className={`text-[11px] font-extrabold ${on.length ? "text-success" : "text-danger"}`}>{summary}</span>
                            </div>
                          )}
                        </td>
                        {FLAGS.map((k) => (
                          <td key={k} className="text-center">
                            <input type="checkbox" className="h-4 w-4" disabled={readOnly} checked={r[k]} onChange={(e) => setFlag(r.sysId, k, e.target.checked)} aria-label={`${r.title} ${HEAD[k]}`} />
                          </td>
                        ))}
                      </tr>
                      {ms && open && (
                        <tr>
                          <td colSpan={6} className="bg-surface-2/60">
                            <div className="grid gap-2">
                              {stocks.length === 0 && <div className="text-xs font-bold text-ink-soft">ยังไม่มีคลังที่เปิดช่องทางสแกน</div>}
                              {stocks.map((s) => (
                                <div key={s.stkId} className={`flex flex-wrap items-center gap-3 rounded-xl border bg-surface px-3 py-2 ${s.on ? "border-accent" : "border-line/60"}`}>
                                  <label className="flex min-w-[180px] items-center gap-2 font-extrabold">
                                    <input type="checkbox" disabled={readOnly} checked={s.on} onChange={(e) => setStock(s.stkId, { on: e.target.checked })} />
                                    <span className="text-primary">{s.code}</span>
                                    <span className="truncate text-xs font-semibold text-ink-soft">{s.name}</span>
                                  </label>
                                  <button
                                    className={`rounded-lg px-2 py-0.5 text-xs font-extrabold ${s.priority ? "text-[#e68a00]" : "text-ink-soft"}`}
                                    disabled={readOnly || !(s.on && s.canOut)}
                                    onClick={() => togglePriority(s.stkId)}
                                  >
                                    {s.priority ? "★ OUT FIRST" : "☆ OUT FIRST"}
                                  </button>
                                  {s.deductEligible && (
                                    <label className="flex items-center gap-1 text-[10px] font-extrabold text-ink-soft">
                                      DEDUCTED
                                      <input type="checkbox" disabled={readOnly || !s.on} checked={s.deduct} onChange={(e) => setStock(s.stkId, { deduct: e.target.checked })} />
                                    </label>
                                  )}
                                  {data.scanner?.hasWho && (
                                    <>
                                      <label className="flex items-center gap-1 text-[10px] font-extrabold text-ink-soft">
                                        EMP ID
                                        <input type="checkbox" disabled={readOnly || !s.on} checked={s.askEmployee} onChange={(e) => setStock(s.stkId, { askEmployee: e.target.checked })} />
                                      </label>
                                      <label className="flex items-center gap-1 text-[10px] font-extrabold text-ink-soft">
                                        DEPT
                                        <input type="checkbox" disabled={readOnly || !s.on} checked={s.askDepartment} onChange={(e) => setStock(s.stkId, { askDepartment: e.target.checked })} />
                                      </label>
                                    </>
                                  )}
                                  <label className="ml-auto flex items-center gap-1 text-[10px] font-extrabold text-ink-soft">
                                    DISPLAY
                                    <select className="field w-auto py-1 text-xs" disabled={readOnly || !s.on} value={s.display} onChange={(e) => setStock(s.stkId, { display: e.target.value })}>
                                      {s.options.map((o) => (
                                        <option key={o.key} value={o.key}>
                                          {o.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
