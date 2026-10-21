// เรียก API (ASP.NET) ผ่าน /api - Cookie Login ส่งไปเอง + ชื่อเครื่อง (X-Client-Device) แทน Environment.MachineName ของ WPF

const DEVICE_KEY = "chr-device";

export function deviceName(): string {
  if (typeof window === "undefined") return "";
  try {
    let d = localStorage.getItem(DEVICE_KEY);
    if (!d) {
      d = "WEB-" + Math.random().toString(36).slice(2, 8).toUpperCase();
      localStorage.setItem(DEVICE_KEY, d);
    }
    return d;
  } catch {
    return "";
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Options = Omit<RequestInit, "body"> & { body?: unknown; query?: Record<string, string | number | boolean | null | undefined> };

function url(path: string, query?: Options["query"]) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return `/api${path}${s ? `?${s}` : ""}`;
}

export async function api<T = unknown>(path: string, opt: Options = {}): Promise<T> {
  const { body, query, headers, ...rest } = opt;
  const res = await fetch(url(path, query), {
    ...rest,
    credentials: "same-origin",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      "X-Client-Device": deviceName(),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/")) {
    // นอก React: โหลดหน้า Login ใหม่ทั้งหน้า (ล้างข้อมูลของผู้ใช้เดิมที่ค้างอยู่ใน State)
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login";
    throw new ApiError(401, "Session หมดอายุ กรุณาเข้าสู่ระบบใหม่");
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const msg = (data && typeof data === "object" && "message" in data && String((data as { message: unknown }).message)) || `เกิดข้อผิดพลาด (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

function safeJson(t: string) {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

// ดาวน์โหลดไฟล์ (Export Excel) - แทนการเปิดไฟล์ในเครื่องแบบ WPF
//   body = ส่งแบบ POST (เช่น Export เฉพาะรายการที่ติ๊ก)
export async function download(path: string, query?: Options["query"], body?: unknown) {
  const res = await fetch(url(path, query), {
    method: body !== undefined ? "POST" : "GET",
    credentials: "same-origin",
    headers: { "X-Client-Device": deviceName(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new ApiError(res.status, (safeJson(t) as { message?: string })?.message ?? `ดาวน์โหลดไม่สำเร็จ (${res.status})`);
  }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") ?? "";
  const m = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd);
  const name = decodeURIComponent(m?.[1] ?? m?.[2] ?? "export.xlsx");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return name;
}

// อัปโหลดไฟล์ (multipart) - field = ชื่อช่องที่ API รับ (ค่าเริ่มต้น "file")
export async function upload<T = unknown>(path: string, file: File, extra?: Record<string, string>, field = "file"): Promise<T> {
  const fd = new FormData();
  fd.append(field, file);
  for (const [k, v] of Object.entries(extra ?? {})) fd.append(k, v);
  const res = await fetch(`/api${path}`, { method: "POST", credentials: "same-origin", headers: { "X-Client-Device": deviceName() }, body: fd });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) throw new ApiError(res.status, (data as { message?: string })?.message ?? `อัปโหลดไม่สำเร็จ (${res.status})`);
  return data as T;
}
