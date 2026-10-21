// โครงหน้าระบบ: หัวหน้า (ไอคอนสี + ชื่อ + ปุ่ม) การ์ด ตัวเลขสรุป ป้ายสถานะ
export function PageHeader({
  icon,
  title,
  subtitle,
  actions,
}: {
  icon?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {icon && (
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-accent to-primary shadow-md">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={icon} alt="" className="h-7 w-7 object-contain brightness-0 invert" />
        </div>
      )}
      <div className="min-w-0">
        <h2 className="text-xl font-extrabold tracking-tight text-primary md:text-2xl">{title}</h2>
        {subtitle && <div className="text-sm font-semibold text-ink-soft">{subtitle}</div>}
      </div>
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageBody({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4 p-3 md:p-5">{children}</div>;
}

export function Card({
  title,
  actions,
  children,
  className = "",
  bodyClass = "",
}: {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-2xl border border-line/60 bg-surface shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line/60 px-4 py-3">
          {title && <h3 className="text-sm font-extrabold uppercase tracking-wide text-primary">{title}</h3>}
          {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

const TONE = {
  primary: "var(--primary)",
  success: "var(--success)",
  danger: "var(--danger)",
  warning: "var(--warning)",
  info: "var(--info)",
  accent: "var(--accent)",
};

export function Stat({
  label,
  value,
  tone = "primary",
  hint,
  onClick,
  active,
}: {
  label: string;
  value: React.ReactNode;
  tone?: keyof typeof TONE;
  hint?: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  const color = TONE[tone];
  const El = onClick ? "button" : "div";
  return (
    <El
      onClick={onClick}
      className={`flex min-w-0 flex-col rounded-2xl border bg-surface p-4 text-left shadow-sm transition ${onClick ? "hover:-translate-y-0.5 hover:shadow-md" : ""} ${active ? "" : "border-line/60"}`}
      style={active ? { borderColor: color, boxShadow: `0 0 0 2px ${color}` } : undefined}
    >
      <span className="text-[11px] font-extrabold uppercase tracking-wide text-ink-soft">{label}</span>
      <span className="mt-1 text-2xl font-extrabold md:text-3xl" style={{ color }}>
        {value}
      </span>
      {hint && <span className="mt-0.5 text-xs font-semibold text-ink-soft">{hint}</span>}
    </El>
  );
}

export function Empty({ children = "ไม่พบรายการ" }: { children?: React.ReactNode }) {
  return <div className="py-12 text-center text-sm font-semibold text-ink-soft">{children}</div>;
}

export function Loading() {
  return <div className="py-12 text-center text-sm font-semibold text-ink-soft">⏳ LOADING...</div>;
}

export function Badge({ children, color = "var(--primary)" }: { children: React.ReactNode; color?: string }) {
  return (
    <span className="inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-extrabold text-white" style={{ background: color }}>
      {children}
    </span>
  );
}

// ช่องค้นหาแบบมีไอคอน
export function SearchBox({ value, onChange, placeholder = "ค้นหา...", className = "" }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft">🔍</span>
      <input className="field pl-9" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {value && (
        <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 text-ink-soft hover:bg-surface-2" onClick={() => onChange("")} aria-label="Clear">
          ×
        </button>
      )}
    </div>
  );
}
