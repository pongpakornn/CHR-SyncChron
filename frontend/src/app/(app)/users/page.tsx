"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/Toasts";
import { useDialogs } from "@/components/ui/Dialogs";
import { Empty, Loading, PageBody, PageHeader, SearchBox } from "@/components/ui/Page";
import { api, download, upload } from "@/lib/api";
import { useDebounced } from "@/lib/useDebounced";
import { ContactModal } from "./ContactModal";
import { PermissionModal } from "./PermissionModal";
import { SetupModal } from "./SetupModal";
import type { Can, User } from "./types";
import { UserEditModal } from "./UserEditModal";

const LEVEL_TONE: Record<number, string> = { 1: "var(--danger)", 2: "var(--accent)", 3: "var(--info)" };

// 👥 USER MANAGEMENT (UserManagementView): การ์ดผู้ใช้ - ดู / เพิ่ม / แก้ไข / ลบ / กำหนดสิทธิ์ / Import / ALERT CONTACT / ⚙ SETUP
export default function UsersPage() {
  const toast = useToast();
  const dlg = useDialogs();
  const [users, setUsers] = useState<User[] | null>(null);
  const [can, setCan] = useState<Can | null>(null);
  const [me, setMe] = useState("");
  const [key, setKey] = useState("");
  const k = useDebounced(key, 200);
  const [edit, setEdit] = useState<{ user: User | null } | null>(null);
  const [perm, setPerm] = useState<{ userId: string; readOnly: boolean } | null>(null);
  const [contact, setContact] = useState<((saved: boolean) => void) | null>(null);
  const [setup, setSetup] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const tokenRef = useRef("");

  const load = useCallback(
    async (live = false) => {
      try {
        const r = await api<{ can: Can; me: string; users: User[] }>("/users");
        setUsers(r.users);
        setCan(r.can);
        setMe(r.me);
      } catch (e) {
        if (!live) toast.show("ERROR", "โหลดรายชื่อผู้ใช้งานไม่สำเร็จ\n" + (e as Error).message, "error");
      }
    },
    [toast],
  );

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  // ⚡ เรียลไทม์ 3 วินาที (คงคำค้นไว้)
  useEffect(() => {
    const t = setInterval(async () => {
      if (document.hidden) return;
      try {
        const r = await api<{ token: string }>("/users/token");
        if (tokenRef.current && r.token !== tokenRef.current) load(true);
        tokenRef.current = r.token;
      } catch {
        /* รอบหน้า */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [load]);

  // ตรงที่สุดขึ้นก่อน: USER ID ตรงเป๊ะ > ขึ้นต้นด้วยคำค้น > มีคำค้นอยู่ข้างใน
  const list = useMemo(() => {
    const all = users ?? [];
    const q = k.trim().toLowerCase();
    if (!q) return all;
    const rank = (u: User) => (u.userId.toLowerCase() === q ? 0 : u.userId.toLowerCase().startsWith(q) || (u.name ?? "").toLowerCase().startsWith(q) ? 1 : 2);
    return all
      .filter((u) => [u.userId, u.name, u.position, u.department, u.section, u.division, u.levelText, u.statusText].some((v) => v && v.toLowerCase().includes(q)))
      .sort((a, b) => rank(a) - rank(b));
  }, [users, k]);

  const editContacts = () => new Promise<boolean>((resolve) => setContact(() => resolve));

  async function remove(u: User) {
    if (u.userId.toLowerCase() === me.toLowerCase()) return toast.show("WARNING", "ไม่สามารถลบบัญชีที่กำลังใช้งานอยู่ได้", "warn");
    if (u.isMasterAdmin) return toast.show("WARNING", `${u.userId} เป็นผู้ดูแลระบบหลัก (Master Admin) ลบไม่ได้`, "warn");
    if (!(await dlg.confirm({ title: "DELETE USER", message: `ลบผู้ใช้ ${u.userId}\n${u.name}\n\nสิทธิ์ทั้งหมดของผู้ใช้นี้จะถูกลบด้วย ยืนยันหรือไม่?`, ok: "DELETE", danger: true }))) return;
    try {
      const r = await api<{ message: string }>(`/users/${encodeURIComponent(u.userId)}`, { method: "DELETE" });
      toast.show("Deleted", r.message, "ok");
      load();
    } catch (e) {
      toast.show("WARNING", (e as Error).message, "warn");
    }
  }

  async function template() {
    if (
      !(await dlg.confirm({
        title: "TEMPLATE EXCEL",
        ok: "YES",
        message:
          "ต้องการสร้างไฟล์ Template สำหรับนำเข้าผู้ใช้และสิทธิ์ใช่หรือไม่?\n\n• ไฟล์มีชีท USERS และ PERMISSIONS พร้อมชีทวิธีกรอก และรายการรหัสระบบ / รหัสคลัง\n• กรอกข้อมูลแล้วนำเข้าด้วยปุ่ม IMPORT USER / PERMISSION",
      }))
    )
      return;
    download("/users/template")
      .then((f) => toast.show("Template", `สร้างไฟล์ Template แล้ว\n${f}`, "ok"))
      .catch((e) => toast.show("ERROR", e.message, "error"));
  }

  async function doImport(file: File) {
    setBusy(true);
    try {
      const pv = await upload<{ id: string; summary: string }>("/users/import", file);
      if (!(await dlg.confirm({ title: "IMPORT USER / PERMISSION", message: pv.summary, ok: "IMPORT" }))) return;
      const r = await api<{ message: string }>("/users/import/apply", { method: "POST", body: pv.id });
      await dlg.alert({ title: "IMPORT", message: r.message, tone: "ok" });
      load();
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (!users || !can) return <Loading />;
  const online = users.filter((u) => u.isOnline && !u.isLocked).length;
  const locked = users.filter((u) => u.isLocked).length;

  return (
    <PageBody>
      <PageHeader
        icon="/icons/management.png"
        title="USER MANAGEMENT"
        subtitle="View, add, edit and delete users and set the permissions of every system"
        actions={
          <>
            {can.contact && (
              <button className="btn bg-danger" onClick={() => editContacts()}>
                🔔 ALERT CONTACT
              </button>
            )}
            {can.setup && (
              <button className="btn bg-accent" onClick={() => setSetup(true)}>
                ⚙ SETUP
              </button>
            )}
            {can.import && (
              <>
                <button className="btn-ghost" onClick={template} title="Excel template for importing users and permissions">
                  📄 TEMPLATE
                </button>
                <button className="btn bg-info" disabled={busy} onClick={() => fileRef.current?.click()}>
                  {busy ? "⏳ IMPORTING..." : "📥 IMPORT USER / PERMISSION"}
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
            {can.add && (
              <button className="btn bg-success" onClick={() => setEdit({ user: null })}>
                ＋ ADD USER
              </button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={key} onChange={setKey} placeholder="Search User ID, name, position, department or level..." className="min-w-[240px] flex-1" />
        <span className="rounded-full bg-primary px-3 py-1 text-xs font-extrabold text-white">{users.length.toLocaleString()} USERS</span>
        <span className="rounded-full bg-success px-3 py-1 text-xs font-extrabold text-white">{online.toLocaleString()} ONLINE</span>
        <span className="rounded-full bg-danger px-3 py-1 text-xs font-extrabold text-white">{locked.toLocaleString()} LOCKED</span>
      </div>

      {list.length === 0 ? (
        <Empty>NO USER</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {list.map((u) => (
            <div key={u.userId} className={`flex flex-col overflow-hidden rounded-2xl border bg-surface shadow-sm transition hover:shadow-md ${u.isLocked ? "border-danger/50 opacity-80" : "border-line/60"}`}>
              <div className="h-1.5" style={{ background: LEVEL_TONE[u.level] ?? "var(--primary)" }} />
              <div className="flex gap-3 p-4">
                <div className="relative">
                  <div className="grid h-12 w-12 place-items-center rounded-full text-base font-extrabold text-white" style={{ background: LEVEL_TONE[u.level] ?? "var(--primary)" }}>
                    {u.initials}
                  </div>
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-surface ${u.isLocked ? "bg-danger" : u.isOnline ? "bg-success" : "bg-[#bdbdbd]"}`}
                    title={u.statusText}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-extrabold text-primary">{u.name}</div>
                  <div className="text-xs font-bold text-ink-soft">ID : {u.userId}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className="rounded-md px-1.5 py-0.5 text-[10px] font-extrabold text-white" style={{ background: LEVEL_TONE[u.level] ?? "var(--primary)" }}>
                      {u.levelText}
                    </span>
                    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-extrabold ${u.isLocked ? "bg-[#ffebee] text-danger" : u.isOnline ? "bg-[#e8f5e9] text-success" : "bg-surface-2 text-ink-soft"}`}>
                      {u.statusText}
                    </span>
                    <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-extrabold text-primary">{u.permCount} SYSTEMS</span>
                  </div>
                </div>
              </div>
              <div className="grid gap-0.5 px-4 pb-2 text-xs font-semibold text-ink-soft">
                {u.subText && <div className="truncate">{u.subText}</div>}
                {u.subText2 && <div className="truncate">{u.subText2}</div>}
                <div className="truncate">{u.lastLoginText}</div>
                {u.showScanChip && <div className={`truncate font-extrabold ${u.scanNotSet ? "text-danger" : "text-success"}`}>{u.scanChipText}</div>}
              </div>
              <div className="mt-auto flex flex-wrap gap-1 border-t border-line/60 p-2">
                <button className="btn-ghost px-3 py-1 text-xs" onClick={() => setPerm({ userId: u.userId, readOnly: true })}>
                  VIEW
                </button>
                {can.edit && (
                  <button className="btn bg-info px-3 py-1 text-xs" onClick={() => setEdit({ user: u })}>
                    EDIT
                  </button>
                )}
                {can.perms && (
                  <button className="btn bg-accent px-3 py-1 text-xs" onClick={() => setPerm({ userId: u.userId, readOnly: false })}>
                    🔑 PERMISSION
                  </button>
                )}
                {can.delete && (
                  <button className="btn bg-danger ml-auto px-3 py-1 text-xs" onClick={() => remove(u)}>
                    DEL
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {edit && (
        <UserEditModal
          user={edit.user}
          isSelf={!!edit.user && edit.user.userId.toLowerCase() === me.toLowerCase()}
          onClose={() => setEdit(null)}
          onSaved={(m) => {
            setEdit(null);
            toast.show(edit.user ? "Saved" : "User added", m, "ok");
            load();
          }}
        />
      )}
      {perm && (
        <PermissionModal
          userId={perm.userId}
          readOnly={perm.readOnly}
          canContact={can.contact}
          onClose={() => setPerm(null)}
          onEditContacts={editContacts}
          onSaved={(m) => {
            setPerm(null);
            toast.show("Saved", m, "ok");
            load();
          }}
        />
      )}
      {contact && (
        <ContactModal
          onClose={() => {
            contact(false);
            setContact(null);
          }}
          onSaved={(m) => {
            toast.show("Saved", m, "ok");
            contact(true);
            setContact(null);
          }}
        />
      )}
      {setup && <SetupModal onClose={() => setSetup(false)} />}
    </PageBody>
  );
}
