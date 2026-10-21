// ตัวเลข / วันที่ แบบเดียวกับ Qty.Plain ของ WPF (ทศนิยมสูงสุด 3 ตำแหน่ง ไม่มีศูนย์ท้าย)
export const qty = (v: number | null | undefined, empty = "-") =>
  v === null || v === undefined || !Number.isFinite(v) ? empty : Number(v.toFixed(3)).toLocaleString("en-US", { maximumFractionDigits: 3 });

export const num = (v: number | null | undefined) => (v === null || v === undefined ? "-" : v.toLocaleString("en-US"));

export const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const today = () => isoDate(new Date());

export function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
}

export const monthStart = () => {
  const d = new Date();
  return isoDate(new Date(d.getFullYear(), d.getMonth(), 1));
};

// ค่าว่าง = null / ไม่ใช่ตัวเลข = NaN
export function parseNum(s: string): number | null {
  const t = (s ?? "").replace(/,/g, "").trim();
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
}
