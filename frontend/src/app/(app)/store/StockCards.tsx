"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/Toasts";
import { useDialogs } from "@/components/ui/Dialogs";
import { Badge, Empty, Loading, PageBody, PageHeader } from "@/components/ui/Page";
import { api } from "@/lib/api";
import { qty } from "@/lib/format";
import { FormatsModal } from "./FormatsModal";
import { StockEditor } from "./StockEditor";

type Card = {
  stkId: number;
  code: string;
  name: string;
  isMain: boolean;
  unit: string;
  itemCount: number;
  canDelete: boolean;
  coil: { masterCount: number; masterKg: number; childCount: number; childKg: number; totalCount: number; totalKg: number } | null;
};
type Data = { canCreate: boolean; canFormats: boolean; canEdit: boolean; stocks: Card[] };

// 🏬 การ์ดคลัง (StockCardsView) - คลิกการ์ด = เปิดตารางของคลังนั้น
export function StockCards({ onOpen }: { onOpen: (stkId: number) => void }) {
  const toast = useToast();
  const dlg = useDialogs();
  const [data, setData] = useState<Data | null>(null);
  const [editor, setEditor] = useState<{ stkId: number | null } | null>(null);
  const [formats, setFormats] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<Data>("/store/stocks"));
    } catch (e) {
      toast.show("ERROR", "ไม่สามารถโหลดรายชื่อคลังได้\n" + (e as Error).message, "error");
    }
  }, [toast]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    const live = setInterval(() => !document.hidden && load(), 10_000);
    return () => (clearTimeout(t), clearInterval(live));
  }, [load]);

  async function remove(c: Card) {
    const reason = await dlg.prompt({
      title: "DELETE STOCK",
      danger: true,
      ok: "DELETE",
      multiline: true,
      message: `คลัง ${c.code} (${c.name}) มีสินค้า ${c.itemCount.toLocaleString()} รายการ\nข้อมูลยอดคงเหลือและประวัติแสกนของคลังนี้จะถูกลบทั้งหมด\n\nกรุณาระบุเหตุผลในการลบคลัง`,
      required: "กรุณาระบุเหตุผลในการลบคลัง",
    });
    if (reason === null) return;
    if (!(await dlg.confirm({ title: "CONFIRM DELETE", danger: true, message: `ยืนยันการลบคลัง ${c.code} ใช่หรือไม่?\nไม่สามารถกู้คืนข้อมูลได้\n\nเหตุผล: ${reason}` }))) return;
    try {
      const r = await api<{ message: string }>(`/store/stocks/${c.stkId}/delete`, { method: "POST", body: { reason } });
      toast.show("Stock", r.message, "ok");
      load();
    } catch (e) {
      toast.show("ERROR", "ลบคลังไม่สำเร็จ\n" + (e as Error).message, "error");
    }
  }

  return (
    <PageBody>
      <PageHeader
        icon="/icons/StoreMaxMin.png"
        title="STORE ( MAX - MIN )"
        subtitle={data ? `SELECT A STOCK • ${data.stocks.length} STOCK(S)` : "LOADING..."}
        actions={
          <>
            {data?.canFormats && (
              <button className="btn bg-primary" onClick={() => setFormats(true)}>
                🏷️ BARCODE FORMATS
              </button>
            )}
            {data?.canCreate && (
              <button className="btn bg-accent" onClick={() => setEditor({ stkId: null })}>
                ＋ ADD STOCK
              </button>
            )}
          </>
        }
      />
      {!data ? (
        <Loading />
      ) : data.stocks.length === 0 ? (
        <Empty>ยังไม่มีคลังที่คุณมีสิทธิ์ดู กรุณาติดต่อ Admin</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {data.stocks.map((c) => (
            <div
              key={c.stkId}
              role="button"
              tabIndex={0}
              onClick={() => onOpen(c.stkId)}
              onKeyDown={(e) => e.key === "Enter" && onOpen(c.stkId)}
              className="group relative flex cursor-pointer flex-col overflow-hidden rounded-3xl border border-line/60 bg-surface p-5 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-xl"
            >
              <div className="absolute inset-x-0 top-0 h-1.5" style={{ background: c.isMain ? "var(--primary)" : "var(--accent)" }} />
              <div className="flex items-start gap-3">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-accent to-primary">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/icons/StoreWarehouse.png" alt="" className="h-7 w-7 object-contain brightness-0 invert" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-lg font-extrabold text-primary">{c.code}</span>
                    {c.isMain && <Badge>MAIN</Badge>}
                  </div>
                  <div className="truncate text-sm font-semibold text-ink-soft">{c.name}</div>
                </div>
              </div>
              <div className="mt-5 flex items-end justify-between">
                <div>
                  <div className="text-[11px] font-extrabold uppercase text-ink-soft">ITEMS</div>
                  <div className="text-3xl font-extrabold text-ink">{c.itemCount.toLocaleString()}</div>
                </div>
                <span className="rounded-lg bg-surface-2 px-2 py-1 text-xs font-extrabold text-primary">{c.unit}</span>
              </div>
              {c.coil && (
                <div
                  className="mt-3 rounded-xl bg-[#f4f0fc] px-3 py-2 text-xs font-bold text-accent"
                  title={`MASTER COIL ${c.coil.masterCount} (${qty(c.coil.masterKg)} KG) • COIL NO ${c.coil.childCount} (${qty(c.coil.childKg)} KG)`}
                >
                  🧲 COIL NO {c.coil.totalCount.toLocaleString()} | {qty(c.coil.totalKg)} KG | {qty(Math.round(c.coil.totalKg / 10) / 100)} TON
                </div>
              )}
              {(data.canEdit || c.canDelete) && (
                <div className="mt-4 flex gap-2 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                  {data.canEdit && (
                    <button className="btn-ghost px-3 py-1 text-xs" onClick={(e) => (e.stopPropagation(), setEditor({ stkId: c.stkId }))}>
                      ⚙ SETTINGS
                    </button>
                  )}
                  {c.canDelete && (
                    <button className="btn-ghost px-3 py-1 text-xs text-danger" onClick={(e) => (e.stopPropagation(), remove(c))}>
                      🗑 DELETE
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {editor && (
        <StockEditor
          stkId={editor.stkId}
          canFormats={!!data?.canFormats}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            load();
          }}
        />
      )}
      {formats && <FormatsModal onClose={() => setFormats(false)} />}
    </PageBody>
  );
}
