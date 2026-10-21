"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/Toasts";
import { DateRange } from "@/components/ui/DateRange";
import { Badge, Card, Empty, Loading, PageBody, PageHeader, SearchBox } from "@/components/ui/Page";
import { api, download } from "@/lib/api";
import { today } from "@/lib/format";
import { useDebounced } from "@/lib/useDebounced";

type Row = { date: string; user: string; action: string; detail: string; refCode: string; computer: string };
type Page = { total: number; page: number; pageSize: number; rows: Row[] };

// สีของประเภทการกระทำ (อ่านเร็วว่าเป็นงานกลุ่มไหน)
function actionColor(a: string) {
  if (/DELETE|REJECT|FAIL|CANCEL/.test(a)) return "var(--danger)";
  if (/LOGIN|LOGOUT|EXIT|OPEN_PAGE/.test(a)) return "#7a7484";
  if (/SCAN|DEDUCT/.test(a)) return "var(--accent)";
  if (/EXPORT|IMPORT|TEMPLATE/.test(a)) return "var(--info)";
  if (/APPROVE|CREATE|ADD|REGISTER/.test(a)) return "var(--success)";
  return "var(--warning)";
}

// 🕘 ACTIVITY LOG (ActivityLogView): ใคร ทำอะไร เมื่อไร เครื่องไหน - Log ใหม่ขึ้นเองเมื่อดูหน้าแรก
export default function ActivityLogPage() {
  const toast = useToast();
  const [key, setKey] = useState("");
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [user, setUser] = useState("");
  const [action, setAction] = useState("");
  const [lookups, setLookups] = useState<{ users: { id: string; name: string }[]; actions: string[] }>({ users: [], actions: [] });
  const [data, setData] = useState<Page | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const k = useDebounced(key, 350);
  const tokenRef = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<typeof lookups>("/activity/lookups")
      .then(setLookups)
      .catch((e) => toast.show("Activity Log", "โหลดตัวกรองไม่สำเร็จ: " + e.message, "error"));
  }, [toast]);

  const load = useCallback(
    async (p: number) => {
      setLoading(true);
      try {
        const r = await api<Page>("/activity", { query: { key: k, from, to, user: user || undefined, action: action || undefined, page: p } });
        setData(r);
        setPage(p);
      } catch (e) {
        toast.show("Activity Log", "โหลดข้อมูลไม่สำเร็จ: " + (e as Error).message, "error");
      } finally {
        setLoading(false);
      }
    },
    [k, from, to, user, action, toast],
  );

  useEffect(() => {
    const t = setTimeout(() => load(0), 0);
    return () => clearTimeout(t);
  }, [load]);

  // ⚡ เรียลไทม์: เฉพาะตอนอยู่หน้าแรกและอยู่บนสุด (กำลังเลื่อนอ่าน = ไม่ดึงทับ)
  useEffect(() => {
    const t = setInterval(async () => {
      if (document.hidden || page !== 0 || (scrollRef.current?.scrollTop ?? 0) > 2) return;
      try {
        const r = await api<{ token: string }>("/activity/token");
        if (tokenRef.current && r.token !== tokenRef.current) load(0);
        tokenRef.current = r.token;
      } catch {
        /* รอบหน้าลองใหม่ */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [page, load]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const first = data && data.total > 0 ? page * data.pageSize + 1 : 0;
  const last = data ? page * data.pageSize + data.rows.length : 0;

  return (
    <PageBody>
      <PageHeader
        icon="/icons/ActivityLog.png"
        title="ACTIVITY LOG"
        subtitle="ใคร ทำอะไร เมื่อไร เครื่องไหน"
        actions={
          <button
            className="btn bg-success"
            onClick={() =>
              download("/activity/export", { key: k, from, to, user: user || undefined, action: action || undefined })
                .then((n) => toast.show("Export complete", n, "ok"))
                .catch((e) => toast.show("ERROR", "Export ไม่สำเร็จ\n" + e.message, "error"))
            }
          >
            📤 EXPORT
          </button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line/60 p-3">
          <SearchBox className="min-w-[220px] flex-1" value={key} onChange={setKey} placeholder="ค้นหา ประเภท / รายละเอียด / อ้างอิง / ผู้ใช้ / เครื่อง" />
          <select className="field w-auto" value={user} onChange={(e) => setUser(e.target.value)}>
            <option value="">ALL USERS</option>
            {lookups.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ? `${u.id} - ${u.name}` : u.id}
              </option>
            ))}
          </select>
          <select className="field w-auto" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">ALL ACTIONS</option>
            {lookups.actions.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
          <DateRange from={from} to={to} onChange={(f, t) => (setFrom(f), setTo(t))} />
        </div>
        <div ref={scrollRef} className="max-h-[calc(100dvh-300px)] min-h-[360px] overflow-auto">
          {!data ? (
            <Loading />
          ) : data.rows.length === 0 ? (
            <Empty />
          ) : (
            <table className="data-table w-full">
              <thead className="sticky top-0">
                <tr>
                  <th>DATE TIME</th>
                  <th>USER</th>
                  <th>ACTION</th>
                  <th>DETAIL</th>
                  <th>REFERENCE</th>
                  <th>COMPUTER</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={`${r.date}-${i}`}>
                    <td className="whitespace-nowrap text-xs">{r.date}</td>
                    <td className="whitespace-nowrap">{r.user}</td>
                    <td>
                      <Badge color={actionColor(r.action)}>{r.action}</Badge>
                    </td>
                    <td className="min-w-[280px] break-words text-xs font-medium">{r.detail}</td>
                    <td className="max-w-[200px] break-all text-xs">{r.refCode}</td>
                    <td className="whitespace-nowrap text-xs text-ink-soft">{r.computer}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line/60 p-3">
          <span className="mr-auto text-xs font-bold text-ink-soft">
            {loading ? "⏳ LOADING..." : `${first.toLocaleString()} - ${last.toLocaleString()} OF ${(data?.total ?? 0).toLocaleString()} RECORDS`}
          </span>
          <button className="btn-ghost" disabled={page === 0 || loading} onClick={() => load(page - 1)}>
            ◀ PREV
          </button>
          <span className="text-sm font-bold">
            PAGE {page + 1} / {pages}
          </span>
          <button className="btn-ghost" disabled={!data || (page + 1) * data.pageSize >= data.total || loading} onClick={() => load(page + 1)}>
            NEXT ▶
          </button>
        </div>
      </Card>
    </PageBody>
  );
}
