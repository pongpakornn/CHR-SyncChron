"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

// ▣ QR Code จากข้อความ (สร้างที่ Browser)
export function QrImage({ text, size = 160, className = "" }: { text: string; size?: number; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!text) {
      queueMicrotask(() => alive && setSrc(null));
      return;
    }
    QRCode.toDataURL(text, { errorCorrectionLevel: "Q", margin: 1, width: size * 2 })
      .then((u) => alive && setSrc(u))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [text, size]);
  if (!src) return <div className={`grid place-items-center rounded-xl bg-surface-2 text-line ${className}`} style={{ width: size, height: size }}>▣</div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={text} width={size} height={size} className={`rounded-xl bg-white ${className}`} />;
}
