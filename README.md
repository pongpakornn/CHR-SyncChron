# CHR-SyncChron

Web App ของระบบ **CIMS - Inventory Management** (เดิมเป็นโปรแกรม WPF: [CIMS-InventoryManagement](https://github.com/pongpakornn/CIMS-InventoryManagement))
ย้ายมาเป็น Web ที่ยืดหยุ่นกว่าเดิม ใช้งานได้ทุกขนาดจอ — **เงื่อนไขการทำงานเดิมทุกข้อ** (ไฟล์ Service เดิมย้ายมาทั้งชุด)

| ส่วน | เทคโนโลยี | โฟลเดอร์ |
|---|---|---|
| Frontend | Next.js 16 + React 19 + TypeScript + Tailwind CSS 4 | `frontend/` |
| Backend API | ASP.NET Core (.NET 10) + Dapper / SqlClient | `backend/CHR.Synchron.Api/` |
| Database | SQL Server `192.168.10.56` → ฐาน **`CHR-Synchron`** (Clone จาก `CIMS`) | `database/` |

## โครงสร้าง Backend

- `Legacy/` = โค้ดจากโปรแกรม CIMS (Services / Models / Helpers) **namespace เดิม `CIMS.*`** — แก้เฉพาะส่วนที่เป็น WPF
  (รูปภาพ, เปิดไฟล์, ชื่อเครื่อง) เพื่อให้กฎ / ข้อความ / SQL เหมือนเดิมทุกอย่าง
- `Web/` = ส่วนของเว็บ: Login (JWT ใน Cookie HttpOnly), ผู้ใช้ต่อ Request, ตัวประมวลผลสแกน (`Web/Scanner/ScanProcessor.cs` = `ScanInViewModel.ProcessScan` เดิม)
- `Controllers/` = API

## เริ่มใช้งาน (เครื่อง Dev)

```bash
npm run dev      # รันจากโฟลเดอร์ไหนก็ได้ในโปรเจค (root / frontend / backend)
```

เปิด API (ASP.NET :5080) + Web (Next.js :3000) พร้อมกันในคำสั่งเดียว — Ctrl+C ปิดทั้งคู่
- ครั้งแรกติดตั้ง `frontend/node_modules` ให้เอง / API เปิดอยู่แล้ว (เช่นใน Visual Studio) = ใช้ตัวนั้น
- เครื่องอื่นในวง LAN เปิดได้ที่ `http://<IP เครื่องนี้>:3000` (หน้าจอแสดง IP ให้ตอนเริ่ม)
  ถ้าเครื่องอื่นเปิดไม่ได้ = Windows Firewall บล็อกพอร์ต 3000 ให้อนุญาต (PowerShell แบบ Admin):
  `New-NetFirewallRule -DisplayName "CHR-Synchron Dev 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Domain,Private`
- รันแยกได้: `npm run dev:web` / `npm run dev:api`

**เครื่องใหม่** (ต้องมี Node.js 20.9+ และ .NET 10 SDK) ตั้งค่าครั้งเดียว — ค่าจริงเก็บใน user-secrets ไม่ขึ้น GitHub:

```bash
cd backend/CHR.Synchron.Api
dotnet user-secrets set "ConnectionStrings:Main" "Server=192.168.10.56; Database=CHR-Synchron; User ID=...; Password=...; TrustServerCertificate=True;"
dotnet user-secrets set "Jwt:Key" "<สุ่มอย่างน้อย 32 ตัวอักษร>"
```

Server จริง: ใช้ `appsettings.Local.json` หรือ Environment Variables (`ConnectionStrings__Main`, `Jwt__Key`) และตั้ง `API_URL` ให้ Frontend

## 🔒 แยกจากระบบที่ใช้งานจริง

- API **ไม่ยอมเริ่มทำงาน** ถ้า `ConnectionStrings:Main` ไม่ใช่ฐาน `CHR-Synchron` หรือมี `ConnectionStrings:Erp` ชี้ไป ERP จริง (`192.168.10.10` / ฐาน `CHR`)
- ไม่ตั้ง `ConnectionStrings:Erp` (ค่าเริ่มต้น) = หน้า Pick List อ่านประวัติจากตาราง `CIMS.PickListPrintLogs` ใน CHR-Synchron
- รูปสินค้า / ไฟล์ Excel (PR / RPA / Forecast) อยู่ที่ `storage/` ของโปรเจค (ไม่ขึ้น GitHub) — ไม่เขียนไฟล์ลง Share ของระบบเดิม
  ไฟล์ Excel ของ EXCEL SETUP อัปโหลดจากหน้า User Management → ⚙ SETUP → EXCEL SETUP → UPLOAD
- ไฟล์ Export / Template สร้างในโฟลเดอร์ชั่วคราวของ Server แล้วดาวน์โหลดผ่าน Browser

## Database

- `CHR-Synchron` = Clone จาก `CIMS` (21/10/2026, COPY_ONLY backup → restore) ข้อมูลครบทุกตาราง / View / Procedure / Trigger, schema `CIMS` เดิม
- `database/cims-scripts/` = Script อัพเดทฐานข้อมูลทั้งหมดของ CIMS (ใช้กับ CHR-Synchron ได้เลย)
- ฐาน `CHR_SYNCHORN` (ต้นแบบเก่าบน .56) ไม่ได้ใช้ / ไม่ได้แตะ

## สถานะการย้ายหน้าจอ

| หน้า | สถานะ |
|---|---|
| Login / สิทธิ์ (Level + Permissions เดิม) / Sidebar / Activity Log การเปิดหน้า | ✅ |
| **Dashboard** — การ์ด 4 ใบแยกคลัง (อัพเดททุก 3 วินาที) + Order ลูกค้าเดือนนี้ + Forecast / Order / Delivery ทั้งปี | ✅ |
| **Store (Max-Min)** — การ์ดคลัง / ตาราง / ตั้งค่าคลัง / Barcode Formats / Import-Export | ✅ |
| **Multi-Scanner** — IN / OUT / RETURN / REMAINDER / TEST, หลายคลัง + AUTO + ★, EMPLOYEE ID / DEPARTMENT, ทะเบียน Coil, DEDUCTED / NOT DEDUCTED (APPROVE), ADJUST SCAN, DISPLAY, HISTORY + EXPORT + **EXPORT RPA** | ✅ |
| **Inventory Registration** — ลงทะเบียน / แก้ไข / Import / QR / Admin | ✅ |
| **Pick List** | ✅ |
| **Max-Min Calculator** — สูตร (FORMULAS) / AUTO CALC ต่อคลัง / MAX-MIN (DAYS) ต่อสินค้า / RESET / วันทำงานลูกค้า (ปฏิทิน 12 เดือน) / Template / IMPORT SET MAX MIN / IMPORT FORECAST & ORDER / CALCULATE NOW | ✅ |
| **Forecast / Order / Delivery** — กราฟทั้งปี + TOP 5 / ตารางตามเดือน / Import (คำนวณ AUTO หรือ IMPORT อย่างเดียว) / Template / Export | ✅ |
| **PR Management** | ✅ |
| **Activity Log** — ค้นหา / กรอง / Export | ✅ |
| **User Management** — การ์ดผู้ใช้ / เพิ่ม-แก้-ลบ / 🔑 PERMISSION + คลังสแกน / ALERT CONTACT / Import-Template / ⚙ SETUP (PR SETTINGS, EXCEL SETUP PR + RPA, DEPARTMENTS) | ✅ |

ทุกหน้าอัพเดทแบบเรียลไทม์ (ตรวจการเปลี่ยนแปลงในฐานข้อมูลเป็นรอบ ๆ แบบโปรแกรมเดิม) และโหลดตารางทีละช่วงตอนเลื่อน เพื่อไม่ให้หน้าค้าง

## License

Copyright © 2026 Non-Pongpakorn Urang. All Rights Reserved.
