using System;
using System.Threading;

namespace CIMS.Core
{
    // 🖥 เครื่องที่ใช้งาน (Web): WPF เดิมใช้ Environment.MachineName ของเครื่องที่รันโปรแกรม
    //    เว็บรันที่ Server ตัวเดียว -> ใช้ชื่อเครื่อง/Browser ของผู้ใช้ที่ส่งมาต่อ Request แทน (ตั้งใน ClientContextMiddleware)
    //    ใช้กับ: เช็ก Login ซ้อนเครื่อง (Users.LastSession) และ ComputerName ใน ACTIVITY LOG
    public static class ClientContext
    {
        private static readonly AsyncLocal<string> _machine = new AsyncLocal<string>();

        public static string Machine
        {
            get => _machine.Value ?? SafeMachineName();
            set => _machine.Value = value;
        }

        private static string SafeMachineName()
        {
            try { return Environment.MachineName; } catch { return null; }
        }
    }
}
