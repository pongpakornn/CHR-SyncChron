"use client";

import { usePathname } from "next/navigation";
import { MENU } from "@/lib/menu";

// หน้าที่ยังย้ายจากโปรแกรม CIMS (WPF) มาเว็บไม่เสร็จ - ระหว่างนี้ใช้ในโปรแกรมเดิมได้ตามปกติ
export function ComingSoon() {
  const path = usePathname();
  const m = MENU.find((x) => path.startsWith(x.href));
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="max-w-md rounded-2xl bg-surface p-8 text-center shadow">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {m && <img src={m.icon} alt="" className="mx-auto mb-4 h-16 w-16 object-contain" />}
        <div className="text-lg font-extrabold uppercase text-primary">{m?.title}</div>
        <p className="mt-2 text-sm font-semibold text-ink-soft">
          หน้านี้กำลังย้ายจากโปรแกรม CIMS มาเป็น Web App
          <br />
          ระหว่างนี้ใช้งานในโปรแกรมเดิมได้ตามปกติ
        </p>
      </div>
    </div>
  );
}
