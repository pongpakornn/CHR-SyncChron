"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback } from "react";
import { Loading } from "@/components/ui/Page";
import { StockCards } from "./StockCards";
import { StockTable } from "./StockTable";

// 🏬 Store (Max-Min): /store = การ์ดคลัง / /store?stk=<id> = ตารางของคลังนั้น
function StorePage() {
  const params = useSearchParams();
  const router = useRouter();
  const stk = Number(params.get("stk")) || null;
  const back = useCallback(() => router.push("/store"), [router]);
  return stk ? <StockTable key={stk} stkId={stk} onBack={back} initialFilter={params.get("f") ?? ""} /> : <StockCards onOpen={(id) => router.push(`/store?stk=${id}`)} />;
}

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <StorePage />
    </Suspense>
  );
}
