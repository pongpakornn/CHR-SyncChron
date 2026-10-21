using CIMS.Core;
using CIMS.Helpers;
using Microsoft.Data.SqlClient;
using System;
using System.Collections.Generic;
using System.Linq;

namespace CIMS.Services
{
    // 🏬 Multi-Scanner ที่ Admin กำหนดให้แต่ละ UserID (Update_20261015.sql)
    //    CIMS.UserScanStocks = คลังที่สแกนได้ + ★ คลังที่ตัดก่อนตอนสแกนออก / CIMS.AdminContacts = ผู้ติดต่อ Admin (ชื่อ / เบอร์ / ชื่อเล่น)
    //    DISPLAY ของแต่ละคลังใช้ CIMS.UserScanDisplays เดิม (ScanService.GetScanDisplayMap / SaveScanDisplayMap)
    public class ScannerSetupService
    {
        private readonly string _cs = GlobalConfig.ConnStr;

        public class Assignment
        {
            public List<int> StockIds { get; set; } = new List<int>();
            public int? PriorityId { get; set; }
            public List<int> DeductIds { get; set; } = new List<int>();   // คลังที่เห็นปุ่ม DEDUCTED / NOT DEDUCTED (Update_20261016.sql)
            public List<int> EmployeeIds { get; set; } = new List<int>(); // คลังที่ต้องกรอก EMPLOYEE ID ก่อนสแกน (Update_20261020b.sql)
            public List<int> DepartmentIds { get; set; } = new List<int>(); // คลังที่ต้องเลือก DEPARTMENT ก่อนสแกน
            public bool IsSet => StockIds.Count > 0;
        }

        public Assignment GetAssignment(string userId)
        {
            var a = new Assignment();
            if (!DbSchema.HasUserScanStocks || string.IsNullOrEmpty(userId)) return a;
            using (var conn = new SqlConnection(_cs))
            using (var cmd = new SqlCommand("SELECT StockID, IsPriority, " + (DbSchema.HasScanDeduct ? "ShowDeduct" : "CAST(0 AS bit) AS ShowDeduct") +
                                            (DbSchema.HasScanWho ? ", AskEmployee, AskDepartment" : ", CAST(0 AS bit) AS AskEmployee, CAST(0 AS bit) AS AskDepartment") +
                                            " FROM CIMS.UserScanStocks WHERE UserID = @u ORDER BY StockID", conn))
            {
                cmd.Parameters.AddWithValue("@u", userId);
                conn.Open();
                using (var r = cmd.ExecuteReader())
                    while (r.Read())
                    {
                        int id = Convert.ToInt32(r["StockID"]);
                        a.StockIds.Add(id);
                        if (Convert.ToBoolean(r["IsPriority"])) a.PriorityId = id;
                        if (Convert.ToBoolean(r["ShowDeduct"])) a.DeductIds.Add(id);
                        if (Convert.ToBoolean(r["AskEmployee"])) a.EmployeeIds.Add(id);
                        if (Convert.ToBoolean(r["AskDepartment"])) a.DepartmentIds.Add(id);
                    }
            }
            return a;
        }

        // ทุกผู้ใช้: UserID -> คลังที่กำหนด (ไว้แสดงบนการ์ดผู้ใช้ หน้า User Management)
        public Dictionary<string, Assignment> GetAllAssignments()
        {
            var map = new Dictionary<string, Assignment>(StringComparer.OrdinalIgnoreCase);
            if (!DbSchema.HasUserScanStocks) return map;
            using (var conn = new SqlConnection(_cs))
            using (var cmd = new SqlCommand("SELECT UserID, StockID, IsPriority FROM CIMS.UserScanStocks ORDER BY UserID, StockID", conn))
            {
                conn.Open();
                using (var r = cmd.ExecuteReader())
                    while (r.Read())
                    {
                        string u = r["UserID"].ToString();
                        if (!map.TryGetValue(u, out var a)) map[u] = a = new Assignment();
                        int id = Convert.ToInt32(r["StockID"]);
                        a.StockIds.Add(id);
                        if (Convert.ToBoolean(r["IsPriority"])) a.PriorityId = id;
                    }
            }
            return map;
        }

        // แทนที่คลังของผู้ใช้ทั้งชุด (ว่าง = ยังไม่ได้กำหนด -> สแกนไม่ได้)
        //   employeeIds / departmentIds = null -> คง EMPLOYEE ID / DEPARTMENT เดิมของแต่ละคลังไว้ (เช่น Level 1 เปลี่ยนคลังที่หน้าสแกน)
        public void SaveAssignment(string userId, IEnumerable<int> stockIds, int? priorityId, string by, IEnumerable<int> deductIds = null,
                                   IEnumerable<int> employeeIds = null, IEnumerable<int> departmentIds = null)
        {
            var ids = (stockIds ?? Enumerable.Empty<int>()).Distinct().ToList();
            var deduct = new HashSet<int>(deductIds ?? Enumerable.Empty<int>());
            bool hasDeduct = DbSchema.HasScanDeduct, hasWho = DbSchema.HasScanWho;
            var emp = employeeIds != null ? new HashSet<int>(employeeIds) : null;
            var dept = departmentIds != null ? new HashSet<int>(departmentIds) : null;
            using (var conn = new SqlConnection(_cs))
            {
                conn.Open();
                using (var tr = conn.BeginTransaction())
                {
                    if (hasWho && (emp == null || dept == null))
                        using (var old = new SqlCommand("SELECT StockID, AskEmployee, AskDepartment FROM CIMS.UserScanStocks WHERE UserID = @u", conn, tr))
                        {
                            old.Parameters.AddWithValue("@u", userId);
                            var oe = new HashSet<int>(); var od = new HashSet<int>();
                            using (var r = old.ExecuteReader())
                                while (r.Read())
                                {
                                    int id = Convert.ToInt32(r["StockID"]);
                                    if (Convert.ToBoolean(r["AskEmployee"])) oe.Add(id);
                                    if (Convert.ToBoolean(r["AskDepartment"])) od.Add(id);
                                }
                            emp ??= oe; dept ??= od;
                        }
                    using (var del = new SqlCommand("DELETE FROM CIMS.UserScanStocks WHERE UserID = @u", conn, tr))
                    {
                        del.Parameters.AddWithValue("@u", userId);
                        del.ExecuteNonQuery();
                    }
                    foreach (int id in ids)
                        using (var ins = new SqlCommand(hasWho
                                   ? "INSERT INTO CIMS.UserScanStocks (UserID, StockID, IsPriority, ShowDeduct, AskEmployee, AskDepartment, UpdatedBy) VALUES (@u, @s, @p, @d, @e, @t, @by)"
                                   : hasDeduct
                                   ? "INSERT INTO CIMS.UserScanStocks (UserID, StockID, IsPriority, ShowDeduct, UpdatedBy) VALUES (@u, @s, @p, @d, @by)"
                                   : "INSERT INTO CIMS.UserScanStocks (UserID, StockID, IsPriority, UpdatedBy) VALUES (@u, @s, @p, @by)", conn, tr))
                        {
                            ins.Parameters.AddWithValue("@e", emp?.Contains(id) == true);
                            ins.Parameters.AddWithValue("@t", dept?.Contains(id) == true);
                            ins.Parameters.AddWithValue("@d", deduct.Contains(id));
                            ins.Parameters.AddWithValue("@u", userId);
                            ins.Parameters.AddWithValue("@s", id);
                            ins.Parameters.AddWithValue("@p", priorityId.HasValue && priorityId.Value == id);
                            ins.Parameters.AddWithValue("@by", (object)by ?? DBNull.Value);
                            ins.ExecuteNonQuery();
                        }
                    tr.Commit();
                }
            }
        }

        // 🔁 คลังที่ตัดสต็อกข้ามคลัง: คลังต้นทางของรูปแบบป้ายที่ตั้ง "ตัดยอดจากคลัง" + คลังที่รับป้ายรูปแบบนั้น (เปิดรับ Supplier)
        //    ใช้แสดงปุ่ม DEDUCTED / NOT DEDUCTED เฉพาะคลังกลุ่มนี้ (วันนี้ = STOCK-MAT รับ Panta แล้วตัด STOCK-PANTA)
        public static HashSet<int> DeductStockIds(IEnumerable<CIMS.Models.StockModel> stocks, IEnumerable<CIMS.Models.BarcodeFormatModel> formats)
        {
            var set = new HashSet<int>();
            var deductFormats = (formats ?? Enumerable.Empty<CIMS.Models.BarcodeFormatModel>()).Where(f => f.IsActive && f.SourceStkId.HasValue).ToList();
            foreach (var f in deductFormats)
            {
                set.Add(f.SourceStkId.Value);
                foreach (var s in stocks ?? Enumerable.Empty<CIMS.Models.StockModel>())
                    if (s.StkId != f.SourceStkId.Value && s.InSupplier && (s.FormatIds == null || s.FormatIds.Count == 0 || s.FormatIds.Contains(f.FmtId)))
                        set.Add(s.StkId);
            }
            return set;
        }
        // หน้า Multi-Scanner เช็คทุกไม่กี่วินาทีว่า Admin เปลี่ยนคลังให้หรือยัง
        public string AssignmentToken(string userId)
        {
            if (!DbSchema.HasUserScanStocks || string.IsNullOrEmpty(userId)) return "";
            using (var conn = new SqlConnection(_cs))
            using (var cmd = new SqlCommand(@"SELECT CAST(COUNT(*) AS varchar) + '|' + ISNULL(CAST(CHECKSUM_AGG(BINARY_CHECKSUM(*)) AS varchar), '') + ':' + ISNULL(CAST(SUM(CAST(BINARY_CHECKSUM(*) AS bigint)) AS varchar), '')
                                                     + '|' + ISNULL((SELECT CAST(CHECKSUM_AGG(BINARY_CHECKSUM(StockID, DisplayField)) AS varchar) FROM CIMS.UserScanDisplays WHERE UserID = @u), '')" +
                                              // Dropdown DEPARTMENT เปลี่ยน -> หน้าสแกนโหลดรายการใหม่เอง
                                              (DbSchema.HasScanDepartments ? " + '|' + ISNULL((SELECT CAST(COUNT(*) AS varchar) + ':' + CAST(CHECKSUM_AGG(BINARY_CHECKSUM(DepartmentName, SortNo)) AS varchar) FROM CIMS.ScanDepartments), '')" : "") + @"
                                              FROM CIMS.UserScanStocks WHERE UserID = @u", conn))
            {
                cmd.Parameters.AddWithValue("@u", userId);
                conn.Open();
                return cmd.ExecuteScalar()?.ToString() ?? "";
            }
        }

        // 🏢 Dropdown DEPARTMENT ของหน้า Multi-Scanner (CIMS.ScanDepartments) - Admin เพิ่ม / แก้ / ลบ ที่ User Management > SETUP > DEPARTMENTS
        public List<string> GetDepartments()
        {
            var list = new List<string>();
            if (!DbSchema.HasScanDepartments) return list;
            using (var conn = new SqlConnection(_cs))
            using (var cmd = new SqlCommand("SELECT DepartmentName FROM CIMS.ScanDepartments ORDER BY SortNo, DepartmentName", conn))
            {
                conn.Open();
                using (var r = cmd.ExecuteReader())
                    while (r.Read()) list.Add(r["DepartmentName"].ToString());
            }
            return list;
        }

        // แทนที่รายการทั้งชุด (ตามลำดับที่ส่งมา) - ประวัติสแกนเก็บชื่อแผนกไว้เอง ลบ / แก้ชื่อที่นี่ไม่กระทบรายการที่สแกนไปแล้ว
        public void SaveDepartments(IList<string> names, string by)
        {
            using (var conn = new SqlConnection(_cs))
            {
                conn.Open();
                using (var tr = conn.BeginTransaction())
                {
                    using (var del = new SqlCommand("DELETE FROM CIMS.ScanDepartments", conn, tr)) del.ExecuteNonQuery();
                    int n = 0;
                    foreach (var name in names)
                        using (var ins = new SqlCommand("INSERT INTO CIMS.ScanDepartments (DepartmentName, SortNo, UpdatedBy) VALUES (@n, @s, @by)", conn, tr))
                        {
                            ins.Parameters.AddWithValue("@n", name.Trim());
                            ins.Parameters.AddWithValue("@s", ++n);
                            ins.Parameters.AddWithValue("@by", (object)by ?? DBNull.Value);
                            ins.ExecuteNonQuery();
                        }
                    tr.Commit();
                }
            }
        }

        // ☎ ผู้ติดต่อ Admin (CIMS.AdminContacts) - หลายคนได้ เรียงตาม SortNo
        public class AdminContact
        {
            public string FullName { get; set; }
            public string Phone { get; set; }
            public string Nickname { get; set; }
            public string Text => ContactLine(FullName, Phone, Nickname);
        }

        public static string ContactLine(string name, string phone, string nick) =>
            $"{(name ?? "").Trim()} - {(phone ?? "").Trim()}" + (string.IsNullOrWhiteSpace(nick) ? "" : $" ({nick.Trim()})");

        public List<AdminContact> GetAdminContacts()
        {
            var list = new List<AdminContact>();
            if (!DbSchema.HasAdminContacts) return list;
            using (var conn = new SqlConnection(_cs))
            using (var cmd = new SqlCommand("SELECT FullName, Phone, Nickname FROM CIMS.AdminContacts ORDER BY SortNo, ContactID", conn))
            {
                conn.Open();
                using (var r = cmd.ExecuteReader())
                    while (r.Read())
                        list.Add(new AdminContact { FullName = r["FullName"].ToString(), Phone = r["Phone"].ToString(), Nickname = r["Nickname"]?.ToString() });
            }
            return list;
        }

        // แทนที่รายชื่อผู้ติดต่อทั้งชุด (ตามลำดับที่ส่งมา)
        public void SaveAdminContacts(IList<AdminContact> contacts, string by)
        {
            using (var conn = new SqlConnection(_cs))
            {
                conn.Open();
                using (var tr = conn.BeginTransaction())
                {
                    using (var del = new SqlCommand("DELETE FROM CIMS.AdminContacts", conn, tr)) del.ExecuteNonQuery();
                    int n = 0;
                    foreach (var c in contacts)
                        using (var ins = new SqlCommand("INSERT INTO CIMS.AdminContacts (FullName, Phone, Nickname, SortNo, UpdatedBy) VALUES (@n, @p, @k, @s, @by)", conn, tr))
                        {
                            ins.Parameters.AddWithValue("@n", c.FullName.Trim());
                            ins.Parameters.AddWithValue("@p", c.Phone.Trim());
                            ins.Parameters.AddWithValue("@k", string.IsNullOrWhiteSpace(c.Nickname) ? (object)DBNull.Value : c.Nickname.Trim());
                            ins.Parameters.AddWithValue("@s", ++n);
                            ins.Parameters.AddWithValue("@by", (object)by ?? DBNull.Value);
                            ins.ExecuteNonQuery();
                        }
                    tr.Commit();
                }
            }
            _contactCache = null;   // แก้รายชื่อแล้ว ข้อความทุกที่ใช้ชุดใหม่ทันที
        }

        // 🔔 ทุกข้อความ "กรุณาติดต่อ Admin" ทั้งระบบใช้รายชื่อจาก ALERT CONTACT (User Management) ชุดนี้
        //   เก็บไว้ 60 วินาที · load = false ใช้ค่าที่เก็บไว้อย่างเดียว (เช่น ตอน Error ที่ต่อฐานไม่ได้)
        private static string _contactCache;
        private static DateTime _contactAt;
        public static string AdminContacts(bool load = true)
        {
            if (load && (_contactCache == null || (DateTime.Now - _contactAt).TotalSeconds > 60))
            {
                try
                {
                    if (DbSchema.HasAdminContacts) { _contactCache = ContactText(new ScannerSetupService().GetAdminContacts()); _contactAt = DateTime.Now; }
                }
                catch { /* ต่อฐานไม่ได้ = ใช้ค่าเดิม */ }
            }
            return _contactCache ?? "☎ Admin";
        }

        // ข้อความแจ้ง + รายชื่อผู้ติดต่อ Admin ต่อท้าย
        public static string WithContacts(string message, bool load = true) => (message ?? "").TrimEnd() + "\n\n" + AdminContacts(load);

        // ข้อความติดต่อ Admin (หน้าสแกน / หน้าต่างแจ้งเตือน) - ไม่มีรายชื่อ = "กรุณาติดต่อ Admin"
        public static string ContactText(IEnumerable<AdminContact> list)
        {
            var lines = (list ?? Enumerable.Empty<AdminContact>()).Select(c => "☎ " + c.Text).ToList();
            return lines.Count == 0 ? "☎ Admin" : string.Join("\n", lines);
        }
    }
}