namespace CIMS.Core
{
    // ⚙️ ค่าการเชื่อมต่อฐานข้อมูล (Web) - อ่านจาก appsettings / User Secrets / Environment ตอน Start (Program.cs)
    //    ConnectionStrings:Main = ฐาน CHR-Synchron (เดิม CIMS) / ConnectionStrings:Erp = ERP (CHR) อ่านอย่างเดียว (Pick List)
    //    🔒 ค่าจริงห้ามขึ้น GitHub: ใช้ `dotnet user-secrets` หรือ appsettings.Local.json (อยู่ใน .gitignore)
    //    เวอร์ชัน WPF เก็บผู้ใช้ที่ Login ไว้ที่ GlobalConfig.CurrentUser - เว็บใช้ผู้ใช้จาก JWT ต่อ Request แทน (ห้ามเก็บแบบ static)
    public static class GlobalConfig
    {
        public static string ConnStr { get; private set; } = "";
        public static string ErpConnStr { get; private set; } = "";

        public static void Init(string connStr, string erpConnStr)
        {
            ConnStr = connStr ?? "";
            ErpConnStr = erpConnStr ?? "";
        }
    }
}
