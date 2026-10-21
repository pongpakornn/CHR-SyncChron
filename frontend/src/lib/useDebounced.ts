import { useEffect, useState } from "react";

// พิมพ์ค้นหาแล้วรอให้หยุดพิมพ์ก่อนค่อยค้น (แบบ DispatcherTimer ในหน้าเดิม)
export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
