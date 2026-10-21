// 📋 เมนู Sidebar (ลำดับ + ไอคอน + สิทธิ์เดียวกับ MainView.xaml ของ WPF)
//    ready = ย้ายมาเว็บแล้ว / ยังไม่ ready = หน้ากำลังย้าย (ยังใช้ในโปรแกรมเดิมได้)
export type MenuItem = {
  href: string;
  label: string;
  title: string; // ชื่อหน้าบนแถบด้านบน (txtPageTitle)
  icon: string;
  can: string; // key ใน Me.can
  ready: boolean;
};

export const MENU: MenuItem[] = [
  { href: "/dashboard", label: "Dashboard", title: "DASHBOARD", icon: "/icons/Dashboard.png", can: "dashboard", ready: true },
  { href: "/store", label: "Store ( Max - Min )", title: "STORE ( MAX - MIN )", icon: "/icons/StoreMaxMin.png", can: "store", ready: true },
  { href: "/scanner", label: "Multi-Scanner", title: "MULTI-SCANNER", icon: "/icons/MultiScanner.png", can: "scanner", ready: true },
  { href: "/inventory", label: "Inventory Registration", title: "INVENTORY REGISTRATION", icon: "/icons/InventoryRegistration.png", can: "productControl", ready: true },
  { href: "/pick-list", label: "Pick List", title: "PICK LIST", icon: "/icons/PickList.png", can: "pickList", ready: true },
  { href: "/max-min", label: "Max-Min Calculator", title: "MAX-MIN CALCULATOR", icon: "/icons/CalculatorMxMn.png", can: "maxMinCalc", ready: true },
  { href: "/forecast", label: "Forecast / Order", title: "FORECAST / ORDER / DELIVERY", icon: "/icons/ForecastOrder.png", can: "forecast", ready: true },
  { href: "/pr", label: "PR Management", title: "PURCHASE REQUEST", icon: "/icons/PR.png", can: "pr", ready: true },
  { href: "/activity-log", label: "Activity Log", title: "ACTIVITY LOG", icon: "/icons/ActivityLog.png", can: "activityLog", ready: true },
  { href: "/users", label: "User Management", title: "USER MANAGEMENT", icon: "/icons/management.png", can: "userMgmt", ready: true },
];

// หน้าแรกหลัง Login: ลำดับเดียวกับ MainView (Dashboard > Scanner > Inventory > Store > Pick List > PR > Max-Min > Forecast > Log > Users)
const START_ORDER = ["dashboard", "scanner", "productControl", "store", "pickList", "pr", "maxMinCalc", "forecast", "activityLog", "userMgmt"];

export function startPage(can: Record<string, boolean>): string | null {
  for (const key of START_ORDER) if (can[key]) return MENU.find((m) => m.can === key)!.href;
  return null;
}
