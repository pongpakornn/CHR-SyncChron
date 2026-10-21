"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/Toasts";
import { MonthChart, ShareBars, type MonthPoint } from "@/components/ui/Charts";
import { Card, Loading, PageBody, PageHeader } from "@/components/ui/Page";
import { api } from "@/lib/api";

type StockRow = { stkId: number; code: string; name: string; items: number; maxCount: number; minCount: number };
type Cards = { stocks: StockRow[]; totals: { stocks: number; items: number; max: number; min: number }; time: string; canStore: boolean };
type Charts = { month: string; year: number; customers: { name: string; amount: number; percentage: number }[]; months: (MonthPoint & { month: number })[] };
type Kind = "STOCK" | "PRODUCT" | "MAX" | "MIN";

const CARD: Record<Kind, { title: string; tone: string; icon: string; filter?: string }> = {
  STOCK: { title: "STOCK", tone: "var(--accent)", icon: "🏬" },
  PRODUCT: { title: "PRODUCT ALL", tone: "var(--info)", icon: "📦" },
  MAX: { title: "MAX PRODUCT", tone: "var(--success)", icon: "📈", filter: "OVER_MAX" },
  MIN: { title: "MIN PRODUCT", tone: "var(--danger)", icon: "⚠", filter: "UNDER_MIN" },
};

// 📊 DASHBOARD (DashboardView): การ์ด 4 ใบแยกตามคลัง (อัพเดททุก 3 วินาที) + Order ของลูกค้าเดือนนี้ + Forecast / Order / Delivery ทั้งปี
export default function DashboardPage() {
  const toast = useToast();
  const router = useRouter();
  const [cards, setCards] = useState<Cards | null>(null);
  const [charts, setCharts] = useState<Charts | null>(null);
  const [open, setOpen] = useState<Kind | null>(null);

  const loadCards = useCallback(async () => {
    try {
      setCards(await api<Cards>("/dashboard/cards"));
    } catch {
      /* รอบหน้าลองใหม่ */
    }
  }, []);

  useEffect(() => {
    api<Charts>("/dashboard/charts")
      .then(setCharts)
      .catch((e) => toast.show("ERROR", e.message, "error"));
    const t0 = setTimeout(loadCards, 0);
    const t = setInterval(() => !document.hidden && loadCards(), 3000);
    const c = setInterval(() => !document.hidden && api<Charts>("/dashboard/charts").then(setCharts).catch(() => {}), 60_000);
    return () => (clearTimeout(t0), clearInterval(t), clearInterval(c));
  }, [loadCards, toast]);

  const valueOf = (k: Kind) => (!cards ? "-" : k === "STOCK" ? cards.totals.stocks : k === "PRODUCT" ? cards.totals.items : k === "MAX" ? cards.totals.max : cards.totals.min);
  const rowValue = (k: Kind, s: StockRow) => (k === "MAX" ? s.maxCount : k === "MIN" ? s.minCount : s.items);

  return (
    <PageBody>
      <PageHeader icon="/icons/Dashboard.png" title="DASHBOARD" subtitle={cards ? `LAST UPDATE ${cards.time}` : "LOADING..."} />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {(Object.keys(CARD) as Kind[]).map((k) => (
          <button
            key={k}
            onClick={() => setOpen((o) => (o === k ? null : k))}
            className={`group relative overflow-hidden rounded-3xl border bg-surface p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg ${open === k ? "ring-2" : "border-line/60"}`}
            style={open === k ? { borderColor: CARD[k].tone, boxShadow: `0 0 0 2px ${CARD[k].tone}` } : undefined}
          >
            <div className="absolute -right-3 -top-3 grid h-20 w-20 place-items-center rounded-full text-3xl opacity-90" style={{ background: `color-mix(in srgb, ${CARD[k].tone} 14%, transparent)` }}>
              {CARD[k].icon}
            </div>
            <div className="text-[11px] font-extrabold uppercase tracking-wide text-ink-soft">{CARD[k].title}</div>
            <div className="mt-1 text-3xl font-extrabold md:text-4xl" style={{ color: CARD[k].tone }}>
              {typeof valueOf(k) === "number" ? (valueOf(k) as number).toLocaleString() : valueOf(k)}
            </div>
            <div className="mt-1 text-[11px] font-bold text-ink-soft">{open === k ? "▲ HIDE STOCKS" : "▼ VIEW BY STOCK"}</div>
          </button>
        ))}
      </div>

      {open && cards && (
        <Card title={`${CARD[open].title} • BY STOCK`}>
          <div className="grid gap-px bg-line/50 sm:grid-cols-2 xl:grid-cols-3">
            {cards.stocks.map((s) => (
              <button
                key={s.stkId}
                disabled={!cards.canStore}
                onClick={() => router.push(`/store?stk=${s.stkId}${CARD[open].filter ? `&f=${CARD[open].filter}` : ""}`)}
                className="flex items-center justify-between gap-3 bg-surface px-4 py-3 text-left hover:bg-surface-2"
              >
                <div className="min-w-0">
                  <div className="font-extrabold text-primary">{s.code}</div>
                  <div className="truncate text-xs text-ink-soft">{s.name}</div>
                </div>
                <div className="text-xl font-extrabold" style={{ color: CARD[open].tone }}>
                  {open === "STOCK" ? "→" : rowValue(open, s).toLocaleString()}
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_2fr]">
        <Card title={`CUSTOMER ORDER • ${charts?.month ?? ""}`} bodyClass="p-4">
          {!charts ? <Loading /> : <ShareBars rows={charts.customers} empty="ยังไม่มี Order ของเดือนนี้" />}
        </Card>
        <Card title={`FORECAST / ORDER / DELIVERY • ${charts?.year ?? ""}`} bodyClass="p-4">
          {!charts ? <Loading /> : <MonthChart data={charts.months} />}
        </Card>
      </div>
    </PageBody>
  );
}
