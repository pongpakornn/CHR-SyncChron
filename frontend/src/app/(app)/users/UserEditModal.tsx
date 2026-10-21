"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { api } from "@/lib/api";
import type { User } from "./types";

const L = "mb-1 block text-[11px] font-extrabold uppercase text-ink-soft";

// ＋ ADD USER / ✏ EDIT USER (UserEditWindow) - รหัสผ่านว่างตอนแก้ไข = ใช้รหัสเดิม / ล็อก-ลดระดับบัญชีตัวเองไม่ได้
export function UserEditModal({ user, isSelf, onClose, onSaved }: { user: User | null; isSelf: boolean; onClose: () => void; onSaved: (message: string) => void }) {
  const [f, setF] = useState({
    userId: user?.userId ?? "",
    name: user?.name ?? "",
    position: user?.position ?? "",
    department: user?.department ?? "",
    section: user?.section ?? "",
    division: user?.division ?? "",
    level: user?.level ?? 2,
    isLocked: user?.isLocked ?? false,
  });
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    const id = f.userId.trim();
    if (!id) return setErr("กรุณากรอก USER ID");
    if (id.includes(" ")) return setErr("USER ID ห้ามมีช่องว่าง");
    if (!f.name.trim()) return setErr("กรุณากรอก NAME");
    if (!user && !p1) return setErr("กรุณากรอก PASSWORD");
    if (p1 !== p2) return setErr("PASSWORD และ CONFIRM PASSWORD ไม่ตรงกัน");
    setBusy(true);
    setErr("");
    try {
      const body = { ...f, userId: id, password: p1 || null };
      const r = user
        ? await api<{ message: string }>(`/users/${encodeURIComponent(user.userId)}`, { method: "PUT", body })
        : await api<{ message: string }>("/users", { method: "POST", body });
      onSaved(r.message);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={user ? "✏ EDIT USER" : "＋ ADD USER"}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            CANCEL
          </button>
          <button className="btn bg-success" disabled={busy} onClick={save}>
            SAVE
          </button>
        </>
      }
    >
      <p className="mb-3 text-xs font-bold text-ink-soft">{user ? "Leave the password empty to keep the current password" : "Fill in the user profile - set the permissions afterwards"}</p>
      <form
        className="grid gap-3 sm:grid-cols-2"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label>
          <span className={L}>USER ID *</span>
          <input className="field" autoFocus={!user} readOnly={!!user} value={f.userId} onChange={(e) => set("userId", e.target.value)} />
        </label>
        <label>
          <span className={L}>NAME *</span>
          <input className="field" autoFocus={!!user} value={f.name} onChange={(e) => set("name", e.target.value)} />
        </label>
        {(
          [
            ["position", "POSITION  (ตำแหน่ง)"],
            ["department", "UNIT  (หน่วยงาน)"],
            ["section", "SECTION  (แผนก)"],
            ["division", "DIVISION  (ฝ่าย)"],
          ] as const
        ).map(([k, l]) => (
          <label key={k}>
            <span className={L}>{l}</span>
            <input className="field" value={f[k]} onChange={(e) => set(k, e.target.value)} />
          </label>
        ))}
        <label>
          <span className={L}>LEVEL *</span>
          <select className="field" disabled={isSelf} value={f.level} onChange={(e) => set("level", Number(e.target.value))}>
            <option value={1}>LEVEL 1 • ADMIN (all systems)</option>
            <option value={2}>LEVEL 2 • MANAGER</option>
            <option value={3}>LEVEL 3 • STAFF (by permission)</option>
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm font-extrabold text-danger">
          <input type="checkbox" disabled={isSelf} checked={f.isLocked} onChange={(e) => set("isLocked", e.target.checked)} /> LOCKED (cannot log in)
        </label>
        <label>
          <span className={L}>{user ? "NEW PASSWORD (optional)" : "PASSWORD *"}</span>
          <input className="field" type="password" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} />
        </label>
        <label>
          <span className={L}>CONFIRM PASSWORD</span>
          <input className="field" type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} />
        </label>
        {err && <p className="whitespace-pre-line rounded-lg bg-[#ffebee] px-3 py-2 text-sm font-bold text-danger sm:col-span-2">{err}</p>}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
