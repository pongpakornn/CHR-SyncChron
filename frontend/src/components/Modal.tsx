"use client";

import { useEffect } from "react";

// หน้าต่างกลางจอ (แทน Window.ShowDialog ของ WPF) - Esc = ปิด
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface shadow-2xl sm:rounded-2xl ${wide ? "sm:max-w-6xl" : "sm:max-w-lg"}`}
      >
        <div className="flex items-center justify-between bg-primary px-5 py-3 text-white">
          <div className="text-base font-extrabold uppercase tracking-wide">{title}</div>
          <button onClick={onClose} className="rounded-md px-2 text-xl font-bold hover:bg-white/15" aria-label="Close">
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
