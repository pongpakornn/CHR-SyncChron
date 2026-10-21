using System;
using System.IO;

namespace CIMS.Core
{
    // 🔒 CHR-Synchron แยกจากระบบที่ใช้งานจริงเด็ดขาด: ไฟล์ทั้งหมดของเว็บอยู่ในโฟลเดอร์ storage ของตัวเอง
    //    WPF เดิมอ่าน / เขียนที่ Share ของ Server จริง (\\192.168.10.56\ProgramCHR, \\192.168.10.3 ...) - เว็บไม่แตะ Path เหล่านั้น
    //    storage\images\stock   = รูปสินค้าแบบใหม่ (<STOCK CODE>\<STOCK CODE>-01.png)
    //    storage\images\legacy  = รูปเก่า (ชื่อไฟล์อย่างเดียว)
    //    storage\images\storepc = รูปของ StorePC
    //    storage\excel          = ไฟล์ Excel ที่ตั้งไว้ (RPA / PR / Template) - Path เดิมในฐานข้อมูลถูกแปลงเป็นไฟล์ชื่อเดียวกันในโฟลเดอร์นี้
    public static class Storage
    {
        public static string Root { get; private set; } = Path.Combine(AppContext.BaseDirectory, "storage");

        public static void Init(string root)
        {
            if (!string.IsNullOrWhiteSpace(root)) Root = Path.GetFullPath(root);
            foreach (var d in new[] { StockImages, LegacyImages, StorePcImages, Excel }) Directory.CreateDirectory(d);
        }

        public static string StockImages => Path.Combine(Root, "images", "stock");
        public static string LegacyImages => Path.Combine(Root, "images", "legacy");
        public static string StorePcImages => Path.Combine(Root, "images", "storepc");
        public static string Excel => Path.Combine(Root, "excel");

        // Path ที่ตั้งไว้ในฐานข้อมูล (เช่น \\192.168.10.56\...\RPA - PR-StoreSP.xlsx) -> storage\excel\RPA - PR-StoreSP.xlsx
        //   Path ที่อยู่ใน storage อยู่แล้ว = ใช้ตามเดิม / ไม่ออกนอก storage ไม่ว่ากรณีใด
        public static string MapExternal(string path)
        {
            if (string.IsNullOrWhiteSpace(path)) return path;
            string p = path.Trim();
            try
            {
                string full = Path.GetFullPath(p);
                if (full.StartsWith(Root.TrimEnd('\\', '/') + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return full;
            }
            catch { /* Path แปลก ๆ -> ใช้ชื่อไฟล์ */ }
            string name = Path.GetFileName(p.Replace('/', '\\').TrimEnd('\\'));
            foreach (char c in Path.GetInvalidFileNameChars()) name = name.Replace(c, '-');
            return Path.Combine(Excel, string.IsNullOrWhiteSpace(name) ? "unnamed.xlsx" : name);
        }
    }
}
