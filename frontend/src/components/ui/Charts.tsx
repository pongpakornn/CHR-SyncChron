"use client";

import { useMemo, useState } from "react";

// 📈 กราฟของระบบ (SVG ล้วน ไม่มี library): สีตามลำดับคงที่ (ผ่าน validate_palette: CVD / contrast)
//   ORDER = slot 1 (blue) · DELIVERY = slot 2 (orange) · FORECAST = slot 3 (aqua, เส้น + จุด)
//   aqua contrast < 3:1 -> มีป้ายกำกับ + ปุ่ม TABLE เสมอ
export const SERIES = { order: "#2a78d6", delivery: "#eb6834", forecast: "#1baf7a" };

export type MonthPoint = { label: string; order: number; delivery: number; forecast: number };

const fmt = (v: number) => Math.round(v).toLocaleString("en-US");
const compact = (v: number) =>
  v >= 1_000_000 ? `${Number((v / 1_000_000).toFixed(1))}M` : v >= 1_000 ? `${Number((v / 1_000).toFixed(1))}K` : `${Math.round(v)}`;

// แกนสูงสุดเป็นเลขกลม ๆ (เผื่อ ~10% แบบเดิม)
function niceMax(v: number) {
  if (v <= 0) return 10;
  const t = v * 1.1;
  const step = Math.pow(10, Math.floor(Math.log10(t)) - 1);
  return Math.ceil(t / step) * step;
}

function Legend({ items }: { items: { color: string; label: string; line?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs font-bold text-ink-soft">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          {i.line ? (
            <svg width="18" height="10" aria-hidden>
              <line x1="0" y1="5" x2="18" y2="5" stroke={i.color} strokeWidth="2" />
              <circle cx="9" cy="5" r="4" fill={i.color} stroke="#fff" strokeWidth="2" />
            </svg>
          ) : (
            <span className="inline-block h-3 w-3 rounded-[3px]" style={{ background: i.color }} />
          )}
          {i.label}
        </span>
      ))}
    </div>
  );
}

// ORDER / DELIVERY (แท่งคู่) + FORECAST (เส้น) รายเดือน - แกนเดียว (หน่วยเดียวกัน)
export function MonthChart({ data, height = 280 }: { data: MonthPoint[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const W = 760,
    H = height,
    padL = 52,
    padR = 12,
    padT = 14,
    padB = 26;
  const max = useMemo(() => niceMax(Math.max(0, ...data.flatMap((d) => [d.order, d.delivery, d.forecast]))), [data]);
  const n = Math.max(1, data.length);
  const band = (W - padL - padR) / n;
  const barW = Math.min(18, (band - 10) / 2);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);
  const linePts = data.map((d, i) => `${padL + band * i + band / 2},${y(d.forecast)}`).join(" ");
  const hasForecast = data.some((d) => d.forecast > 0);
  const lastF = [...data].reverse().find((d) => d.forecast > 0);
  const lastFi = lastF ? data.lastIndexOf(lastF) : -1;

  const items = [
    { color: SERIES.order, label: "ORDER" },
    { color: SERIES.delivery, label: "DELIVERY" },
    { color: SERIES.forecast, label: "FORECAST", line: true },
  ];

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Legend items={items} />
        <button type="button" className="rounded-lg px-2 py-1 text-xs font-extrabold text-accent hover:bg-surface-2" onClick={() => setTable((t) => !t)}>
          {table ? "📈 CHART" : "▦ TABLE"}
        </button>
      </div>
      {table ? (
        <div className="overflow-auto rounded-xl border border-line">
          <table className="data-table w-full">
            <thead>
              <tr>
                <th>MONTH</th>
                <th className="text-right">FORECAST</th>
                <th className="text-right">ORDER</th>
                <th className="text-right">DELIVERY</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.label}>
                  <td>{d.label}</td>
                  <td className="text-right">{fmt(d.forecast)}</td>
                  <td className="text-right">{fmt(d.order)}</td>
                  <td className="text-right">{fmt(d.delivery)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Forecast / Order / Delivery by month" onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#e8e6ec" strokeWidth="1" />
                <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#7a7484">
                  {compact(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const x0 = padL + band * i + band / 2 - barW - 1;
              return (
                <g key={d.label}>
                  {hover === i && <rect x={padL + band * i} y={padT} width={band} height={H - padT - padB} fill="#6750a4" opacity="0.06" />}
                  {[
                    { v: d.order, c: SERIES.order, x: x0 },
                    { v: d.delivery, c: SERIES.delivery, x: x0 + barW + 2 },
                  ].map((b, j) =>
                    b.v > 0 ? (
                      <path
                        key={j}
                        fill={b.c}
                        d={(() => {
                          const top = y(b.v),
                            base = y(0),
                            r = Math.min(4, (base - top) / 2, barW / 2);
                          return `M${b.x},${base} V${top + r} Q${b.x},${top} ${b.x + r},${top} H${b.x + barW - r} Q${b.x + barW},${top} ${b.x + barW},${top + r} V${base} Z`;
                        })()}
                      />
                    ) : null,
                  )}
                  <text x={padL + band * i + band / 2} y={H - 8} textAnchor="middle" fontSize="11" fontWeight={hover === i ? 800 : 600} fill="#5f5b66">
                    {d.label}
                  </text>
                  <rect x={padL + band * i} y={padT} width={band} height={H - padT - padB} fill="transparent" onMouseEnter={() => setHover(i)} />
                </g>
              );
            })}
            <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} stroke="#cfccd6" strokeWidth="1" />
            {hasForecast && (
              <g pointerEvents="none">
                <polyline points={linePts} fill="none" stroke={SERIES.forecast} strokeWidth="2" strokeLinejoin="round" />
                {data.map((d, i) => (d.forecast > 0 ? <circle key={i} cx={padL + band * i + band / 2} cy={y(d.forecast)} r={hover === i ? 5.5 : 4} fill={SERIES.forecast} stroke="#fff" strokeWidth="2" /> : null))}
                {lastFi >= 0 && (
                  <text x={Math.min(W - padR - 2, padL + band * lastFi + band / 2 + 8)} y={y(data[lastFi].forecast) - 8} fontSize="11" fontWeight="700" fill="#1e1c24" textAnchor={lastFi >= n - 2 ? "end" : "start"}>
                    FORECAST
                  </text>
                )}
              </g>
            )}
          </svg>
          {hover !== null && data[hover] && (
            <div
              className="pointer-events-none absolute top-2 z-10 min-w-[160px] rounded-xl border border-line bg-surface p-3 text-xs shadow-xl"
              style={{ left: `calc(${((padL + band * hover + band / 2) / W) * 100}% ${hover > n / 2 ? "- 175px" : "+ 12px"})` }}
            >
              <div className="mb-1 font-extrabold text-ink">{data[hover].label}</div>
              {(
                [
                  ["FORECAST", data[hover].forecast, SERIES.forecast],
                  ["ORDER", data[hover].order, SERIES.order],
                  ["DELIVERY", data[hover].delivery, SERIES.delivery],
                ] as [string, number, string][]
              ).map(([l, v, c]) => (
                <div key={l} className="flex items-center justify-between gap-4 font-semibold text-ink-soft">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />
                    {l}
                  </span>
                  <span className="font-extrabold text-ink">{fmt(v)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// สัดส่วน (part-to-whole) เป็นแท่งแนวนอนเรียงมากไปน้อย - 1 สี (ไม่ต้องมี legend) + ตัวเลข / % ข้างแท่ง
export function ShareBars({ rows, empty = "ไม่มีข้อมูล" }: { rows: { name: string; amount: number; percentage?: number }[]; empty?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = rows.reduce((a, r) => a + r.amount, 0);
  const max = Math.max(1, ...rows.map((r) => r.amount));
  if (rows.length === 0) return <div className="py-10 text-center text-sm font-semibold text-ink-soft">{empty}</div>;
  return (
    <div className="grid gap-2">
      {rows.map((r, i) => {
        const pct = r.percentage ?? (total > 0 ? (r.amount / total) * 100 : 0);
        return (
          <div key={r.name} className={`grid grid-cols-[minmax(80px,140px)_1fr_auto] items-center gap-3 rounded-lg px-1 ${hover === i ? "bg-surface-2" : ""}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} title={`${r.name}: ${fmt(r.amount)} (${pct.toFixed(1)}%)`}>
            <span className="truncate text-xs font-bold text-ink">{r.name}</span>
            <span className="h-3.5 rounded-r-[4px] bg-[#2a78d6]" style={{ width: `${Math.max(1.5, (r.amount / max) * 100)}%` }} />
            <span className="whitespace-nowrap text-right text-xs font-extrabold text-ink">
              {fmt(r.amount)} <span className="font-semibold text-ink-soft">{pct.toFixed(0)}%</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
