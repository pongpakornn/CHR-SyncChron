using CHR.Synchron.Api.Web;
using CHR.Synchron.Api.Web.Auth;
using CHR.Synchron.Api.Web.Scanner;
using CIMS.Helpers;
using CIMS.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;

namespace CHR.Synchron.Api.Controllers;

// 👥 USER MANAGEMENT (SystemID UserManagement) - UserManagementView + UserEditWindow + UserPermissionWindow + AdminContactWindow
//   Level 1 / Master admin = ทุกอย่าง / VIEW = เปิดหน้า, ADD = เพิ่ม, EDIT = แก้ไข, DEL = ลบ, APPROVE = กำหนดสิทธิ์
[Route("api/users")]
public sealed class UsersController : AppController
{
    private readonly UserAdminService _svc = new();
    private readonly UploadCache _uploads;
    private readonly IMemoryCache _cache;
    public UsersController(UploadCache uploads, IMemoryCache cache) { _uploads = uploads; _cache = cache; }

    private static object Dto(UserAccount u) => new
    {
        u.UserId, u.Name, u.Position, u.Department, u.Section, u.Division, u.Level, u.IsOnline, u.IsLocked, u.IsMasterAdmin,
        u.LastLogin, u.PermCount, u.Initials, u.LevelText, u.LastLoginText, u.StatusText, u.SubText, u.SubText2,
        u.ShowScanChip, u.ScanNotSet, u.ScanChipText
    };

    [HttpGet]
    public IActionResult List()
    {
        if (Me?.CanViewUserMgmt != true) return Deny();
        var users = _svc.GetUsers();
        return Ok(new
        {
            can = new
            {
                add = Me.CanAddUser, edit = Me.CanEditUser, delete = Me.CanDeleteUser, perms = Me.CanSetPermissions,
                import = Me.CanAddUser && Me.CanEditUser, contact = Me.CanSetPermissions && DbSchema.HasAdminContacts, setup = Me.CanManagePrSettings
            },
            me = Me.UserId,
            users = users.Select(Dto)
        });
    }

    // ⚡ เรียลไทม์ (3 วินาที): เครื่องอื่นเพิ่ม / แก้ / ล็อกผู้ใช้ / สิทธิ์ / ออนไลน์ -> หน้าโหลดใหม่เอง
    [HttpGet("token")]
    public IActionResult Token()
    {
        if (Me?.CanViewUserMgmt != true) return Deny();
        using var conn = new Microsoft.Data.SqlClient.SqlConnection(CIMS.Core.GlobalConfig.ConnStr);
        var parts = new List<string>
        {
            "SELECT CONCAT(COUNT(*), '|', CHECKSUM_AGG(BINARY_CHECKSUM(*))) FROM CIMS.Users",
            "SELECT CONCAT(COUNT(*), '|', CHECKSUM_AGG(BINARY_CHECKSUM(*))) FROM CIMS.Permissions"
        };
        if (DbSchema.HasUserScanStocks) parts.Add("SELECT CONCAT(COUNT(*), '|', CHECKSUM_AGG(BINARY_CHECKSUM(*))) FROM CIMS.UserScanStocks");
        return Ok(new { token = string.Join("#", parts.Select(q => Dapper.SqlMapper.QueryFirst<string>(conn, q))) });
    }

    public sealed class UserForm
    {
        public string UserId { get; set; }
        public string Name { get; set; }
        public string Position { get; set; }
        public string Department { get; set; }
        public string Section { get; set; }
        public string Division { get; set; }
        public int Level { get; set; } = 2;
        public bool IsLocked { get; set; }
        public string Password { get; set; }
    }

    private UserAccount Account(UserForm f) => new()
    {
        UserId = (f.UserId ?? "").Trim(), Name = (f.Name ?? "").Trim(), Position = (f.Position ?? "").Trim(), Department = (f.Department ?? "").Trim(),
        Section = (f.Section ?? "").Trim(), Division = (f.Division ?? "").Trim(), Level = Math.Clamp(f.Level, 1, 3), IsLocked = f.IsLocked
    };

    [HttpPost]
    public IActionResult Add([FromBody] UserForm f)
    {
        if (Me?.CanAddUser != true) return Deny();
        var u = Account(f);
        if (u.UserId.Length == 0) return Fail("กรุณากรอก USER ID");
        if (u.UserId.Contains(' ')) return Fail("USER ID ห้ามมีช่องว่าง");
        if (u.Name.Length == 0) return Fail("กรุณากรอก NAME");
        if (string.IsNullOrEmpty(f.Password)) return Fail("กรุณากรอก PASSWORD");
        if (_svc.Exists(u.UserId)) return Fail($"USER ID {u.UserId} มีในระบบแล้ว");
        try
        {
            _svc.AddUser(u, f.Password);
            LogService.WriteLog(Uid, "USER_ADD", $"Added user {u.UserId} | {u.Name} | Level {u.Level} | {u.Position} | {u.Department} | {u.Section} | {u.Division}", u.UserId);
            return Ok(new { message = $"เพิ่มผู้ใช้ {u.UserId} แล้ว\nกด 🔑 PERMISSION เพื่อกำหนดสิทธิ์" });
        }
        catch (Exception ex) { return Fail(ex, "เพิ่มผู้ใช้ไม่สำเร็จ"); }
    }

    [HttpPut("{userId}")]
    public IActionResult Edit(string userId, [FromBody] UserForm f)
    {
        if (Me?.CanEditUser != true) return Deny();
        var old = _svc.GetUsers().FirstOrDefault(x => string.Equals(x.UserId, userId, StringComparison.OrdinalIgnoreCase));
        if (old == null) return NotFound(new { message = "ไม่พบผู้ใช้" });
        f.UserId = old.UserId;
        var u = Account(f);
        if (u.Name.Length == 0) return Fail("กรุณากรอก NAME");
        // ล็อก / ลดระดับบัญชีของตัวเองไม่ได้ (กันล็อกตัวเองออกจากระบบ)
        if (string.Equals(old.UserId, Uid, StringComparison.OrdinalIgnoreCase)) { u.Level = old.Level; u.IsLocked = old.IsLocked; }
        string pwd = string.IsNullOrEmpty(f.Password) ? null : f.Password;
        try
        {
            _svc.UpdateUser(u, pwd);
            var ch = new List<string>();
            void C(string label, string a, string b) { if ((a ?? "") != (b ?? "")) ch.Add($"{label}: {a}->{b}"); }
            C("NAME", old.Name, u.Name); C("POSITION", old.Position, u.Position); C("UNIT", old.Department, u.Department);
            C("SECTION", old.Section, u.Section); C("DIVISION", old.Division, u.Division);
            if (old.Level != u.Level) ch.Add($"LEVEL: {old.Level}->{u.Level}");
            if (old.IsLocked != u.IsLocked) ch.Add($"LOCKED: {old.IsLocked}->{u.IsLocked}");
            if (pwd != null) ch.Add("PASSWORD changed");
            LogService.WriteLog(Uid, "USER_EDIT", $"Edited user {u.UserId} | {(ch.Count == 0 ? "no change" : string.Join(", ", ch))}", u.UserId);
            CurrentUser.Forget(_cache, u.UserId);
            return Ok(new { message = $"แก้ไขผู้ใช้ {u.UserId} แล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "แก้ไขผู้ใช้ไม่สำเร็จ"); }
    }

    [HttpDelete("{userId}")]
    public IActionResult Delete(string userId)
    {
        if (Me?.CanDeleteUser != true) return Deny();
        var u = _svc.GetUsers().FirstOrDefault(x => string.Equals(x.UserId, userId, StringComparison.OrdinalIgnoreCase));
        if (u == null) return NotFound(new { message = "ไม่พบผู้ใช้" });
        if (string.Equals(u.UserId, Uid, StringComparison.OrdinalIgnoreCase)) return Fail("ไม่สามารถลบบัญชีที่กำลังใช้งานอยู่ได้");
        if (u.IsMasterAdmin) return Fail($"{u.UserId} เป็นผู้ดูแลระบบหลัก (Master Admin) ลบไม่ได้");
        try
        {
            string err = _svc.DeleteUser(u.UserId);
            if (err != null) return Fail(err);
            LogService.WriteLog(Uid, "USER_DELETE", $"Deleted user {u.UserId} | {u.Name}", u.UserId);
            CurrentUser.Forget(_cache, u.UserId);
            return Ok(new { message = $"ลบผู้ใช้ {u.UserId} แล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "ลบผู้ใช้ไม่สำเร็จ"); }
    }

    // ---------------------------------------------------------------- 🔑 PERMISSION + SCAN STOCKS + DISPLAY
    [HttpGet("{userId}/permissions")]
    public IActionResult Permissions(string userId)
    {
        if (Me?.CanViewUserMgmt != true) return Deny();
        var u = _svc.GetUsers().FirstOrDefault(x => string.Equals(x.UserId, userId, StringComparison.OrdinalIgnoreCase));
        if (u == null) return NotFound(new { message = "ไม่พบผู้ใช้" });
        var perms = _svc.GetPermissions(u.UserId);
        object scanner = null;
        if (DbSchema.HasUserScanStocks)
        {
            var all = new StockService().GetStocks();
            var stocks = all.Where(s => s.CanScanIn || s.CanScanOut).ToList();
            var a = new ScannerSetupService().GetAssignment(u.UserId);
            var map = new ScanService().GetScanDisplayMap(u.UserId);
            var formats = new StockService().GetFormats();
            var eligible = DbSchema.HasScanDeduct ? ScannerSetupService.DeductStockIds(all, formats) : new HashSet<int>();
            scanner = new
            {
                hasWho = DbSchema.HasScanWho,
                stocks = stocks.Select(s =>
                {
                    string cur = map.TryGetValue(s.StkId, out string v) ? v : ScanDisplay.Default;
                    bool on = a.StockIds.Contains(s.StkId);
                    return new
                    {
                        s.StkId, s.Code, s.Name, canOut = s.CanScanOut, deductEligible = eligible.Contains(s.StkId),
                        on, priority = on && a.PriorityId == s.StkId, deduct = on && eligible.Contains(s.StkId) && a.DeductIds.Contains(s.StkId),
                        askEmployee = on && a.EmployeeIds.Contains(s.StkId), askDepartment = on && a.DepartmentIds.Contains(s.StkId),
                        display = cur, options = DisplayOptions.For(s, formats, cur).Select(o => new { key = o.Key, label = o.Label })
                    };
                })
            };
        }
        return Ok(new
        {
            user = Dto(u),
            rows = perms.Select(p => new { p.SysId, p.Title, p.Group, p.Hint, p.View, p.Add, p.Edit, p.Delete, p.Approve }),
            scanner,
            contacts = DbSchema.HasAdminContacts ? ScannerSetupService.ContactText(new ScannerSetupService().GetAdminContacts()) : null
        });
    }

    public sealed class PermRow
    {
        public string SysId { get; set; }
        public bool View { get; set; }
        public bool Add { get; set; }
        public bool Edit { get; set; }
        public bool Delete { get; set; }
        public bool Approve { get; set; }
    }

    public sealed class ScanChoice
    {
        public int StkId { get; set; }
        public bool On { get; set; }
        public bool Priority { get; set; }
        public bool Deduct { get; set; }
        public bool AskEmployee { get; set; }
        public bool AskDepartment { get; set; }
        public string Display { get; set; }
    }

    public sealed class SavePermsRequest
    {
        public List<PermRow> Rows { get; set; } = new();
        public List<ScanChoice> Scanner { get; set; }
    }

    [HttpPost("{userId}/permissions")]
    public IActionResult SavePermissions(string userId, [FromBody] SavePermsRequest req)
    {
        if (Me?.CanSetPermissions != true) return Deny();
        var u = _svc.GetUsers().FirstOrDefault(x => string.Equals(x.UserId, userId, StringComparison.OrdinalIgnoreCase));
        if (u == null) return NotFound(new { message = "ไม่พบผู้ใช้" });
        var current = _svc.GetPermissions(u.UserId);
        var before = current.ToDictionary(p => p.SysId, p => $"{p.View}{p.Add}{p.Edit}{p.Delete}{p.Approve}", StringComparer.OrdinalIgnoreCase);
        var wanted = (req.Rows ?? new()).ToDictionary(r => r.SysId ?? "", r => r, StringComparer.OrdinalIgnoreCase);
        foreach (var p in current)
            if (wanted.TryGetValue(p.SysId, out var w)) { p.View = w.View; p.Add = w.Add; p.Edit = w.Edit; p.Delete = w.Delete; p.Approve = w.Approve; }

        var stocks = new StockService().GetStocks();
        var on = (req.Scanner ?? new()).Where(c => c.On && stocks.Any(s => s.StkId == c.StkId)).ToList();
        var ticked = new List<string>();
        // เลือกคลังสแกนไว้ -> ติ๊ก VIEW ของ Multi-Scanner + คลังที่เลือกให้เอง
        if (on.Count > 0)
            foreach (var p in current)
            {
                bool need = string.Equals(p.SysId, "MultiScanner", StringComparison.OrdinalIgnoreCase) ||
                            on.Any(c => string.Equals(stocks.First(s => s.StkId == c.StkId).PermSysId, p.SysId, StringComparison.OrdinalIgnoreCase));
                if (need && !p.View) { p.View = true; ticked.Add(p.Title); }
            }
        try
        {
            _svc.SavePermissions(u.UserId, current);
            string Flags(UserPermRow p) => (p.View ? "V" : "") + (p.Add ? "A" : "") + (p.Edit ? "E" : "") + (p.Delete ? "D" : "") + (p.Approve ? "P" : "");
            var changed = current.Where(p => !before.TryGetValue(p.SysId, out var b) || b != $"{p.View}{p.Add}{p.Edit}{p.Delete}{p.Approve}")
                                 .Select(p => $"{p.SysId}={(Flags(p).Length == 0 ? "-" : Flags(p))}");
            LogService.WriteLog(Uid, "USER_PERMISSION", $"Permissions of {u.UserId} | {string.Join(", ", changed)}", u.UserId);

            string scanNote = "";
            if (req.Scanner != null && DbSchema.HasUserScanStocks)
            {
                var a = new ScannerSetupService().GetAssignment(u.UserId);
                var map = new ScanService().GetScanDisplayMap(u.UserId);
                var ids = on.Select(c => c.StkId).ToList();
                int? prio = on.FirstOrDefault(c => c.Priority)?.StkId;
                var ded = on.Where(c => c.Deduct).Select(c => c.StkId).ToList();
                var emp = DbSchema.HasScanWho ? on.Where(c => c.AskEmployee).Select(c => c.StkId).ToList() : new List<int>();
                var dept = DbSchema.HasScanWho ? on.Where(c => c.AskDepartment).Select(c => c.StkId).ToList() : new List<int>();
                bool stocksChanged = !ids.OrderBy(x => x).SequenceEqual(a.StockIds.OrderBy(x => x)) || prio != a.PriorityId ||
                                     !ded.OrderBy(x => x).SequenceEqual(a.DeductIds.OrderBy(x => x)) ||
                                     !emp.OrderBy(x => x).SequenceEqual(a.EmployeeIds.OrderBy(x => x)) ||
                                     !dept.OrderBy(x => x).SequenceEqual(a.DepartmentIds.OrderBy(x => x));
                var disp = on.Where(c => !string.IsNullOrEmpty(c.Display) && c.Display != (map.TryGetValue(c.StkId, out var v) ? v : ScanDisplay.Default))
                             .ToDictionary(c => c.StkId, c => c.Display);
                if (stocksChanged) new ScannerSetupService().SaveAssignment(u.UserId, ids, prio, Uid, ded, emp, dept);
                if (disp.Count > 0) new ScanService().SaveScanDisplayMap(disp, u.UserId);
                if (stocksChanged || disp.Count > 0)
                {
                    LogService.WriteLog(Uid, "SCANNER_SETUP",
                        $"Multi-Scanner of {u.UserId} | Stocks: {(ids.Count == 0 ? "NONE" : string.Join(",", ids))}{(prio.HasValue ? $" | ★ {prio}" : "")}" +
                        (ded.Count > 0 ? $" | Deducted: {string.Join(",", ded)}" : "") +
                        (emp.Count > 0 ? $" | Employee ID: {string.Join(",", emp)}" : "") +
                        (dept.Count > 0 ? $" | Department: {string.Join(",", dept)}" : "") +
                        (disp.Count > 0 ? " | Display: " + string.Join(",", disp.Select(kv => $"{kv.Key}={kv.Value}")) : ""), u.UserId);
                    scanNote = "\nคลังสแกน / DISPLAY มีผลที่หน้าสแกนทันที";
                }
            }
            CurrentUser.Forget(_cache, u.UserId);
            return Ok(new { message = $"บันทึกสิทธิ์ของ {u.UserId} แล้ว (มีผลทันที)" + scanNote + (ticked.Count > 0 ? "\nติ๊กสิทธิ์ VIEW ให้แล้ว: " + string.Join(", ", ticked) : "") });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกสิทธิ์ไม่สำเร็จ"); }
    }

    // ---------------------------------------------------------------- ☎ ALERT CONTACT
    [HttpGet("contacts")]
    public IActionResult Contacts()
    {
        if (Me?.CanViewUserMgmt != true) return Deny();
        return Ok(new ScannerSetupService().GetAdminContacts().Select(c => new { c.FullName, c.Phone, c.Nickname }));
    }

    [HttpPost("contacts")]
    public IActionResult SaveContacts([FromBody] List<ScannerSetupService.AdminContact> list)
    {
        if (Me?.CanSetPermissions != true) return Deny();
        list = (list ?? new()).Where(c => !(string.IsNullOrWhiteSpace(c.FullName) && string.IsNullOrWhiteSpace(c.Phone) && string.IsNullOrWhiteSpace(c.Nickname)))
            .Select(c => new ScannerSetupService.AdminContact { FullName = c.FullName?.Trim(), Phone = c.Phone?.Trim(), Nickname = c.Nickname?.Trim() }).ToList();
        var bad = list.Select((c, i) => (c, i)).Where(x => string.IsNullOrWhiteSpace(x.c.FullName) || string.IsNullOrWhiteSpace(x.c.Phone)).Select(x => x.i + 1).ToList();
        if (bad.Count > 0) return Fail($"แถวที่ {string.Join(", ", bad)}: กรุณากรอกชื่อและเบอร์ติดต่อ");
        if (list.Count == 0) return Fail("กรุณาใส่ผู้ติดต่ออย่างน้อย 1 คน");
        var svc = new ScannerSetupService();
        var cur = svc.GetAdminContacts();
        try
        {
            svc.SaveAdminContacts(list, Uid);
            LogService.WriteLog(Uid, "ALERT_CONTACT", "Alert contact: " + string.Join(" / ", cur.Select(c => c.Text)) + " -> " + string.Join(" / ", list.Select(c => c.Text)), "");
            return Ok(new { message = "บันทึกผู้ติดต่อแล้ว\n" + ScannerSetupService.ContactText(list) });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกผู้ติดต่อไม่สำเร็จ"); }
    }

    // ---------------------------------------------------------------- 📥 IMPORT USER / PERMISSION
    [HttpGet("template")]
    public IActionResult Template()
    {
        if (Me?.CanAddUser != true || !Me.CanEditUser) return Deny();
        try
        {
            string path = ImportTemplateService.NewPath(ImportTemplateService.Systems.Users, "User_Permission_Template");
            _svc.CreateImportTemplate(path);
            LogService.WriteLog(Uid, "USER_TEMPLATE", $"File: {Path.GetFileName(path)}", "");
            return Download(path);
        }
        catch (Exception ex) { return Fail(ex, "สร้างไฟล์ Template ไม่สำเร็จ (ปิดไฟล์ Excel เดิมก่อน)"); }
    }

    [HttpPost("import")]
    [RequestSizeLimit(20_000_000)]
    public async Task<IActionResult> ImportPreview(IFormFile file)
    {
        if (Me?.CanAddUser != true || !Me.CanEditUser) return Deny();
        string path;
        try { path = await SaveUpload(file); } catch (Exception ex) { return Fail(ex.Message); }
        try
        {
            bool allowMaster = Me.UserLevel == 1 || Me.IsMasterAdmin;
            var f = _svc.ReadImport(path, allowMaster);
            if (f.Perms.Count > 0 && !Me.CanSetPermissions)
                foreach (var p in f.Perms.Where(p => p.IsValid)) p.Error = "ไม่มีสิทธิ์กำหนดสิทธิ์ผู้ใช้ (APPROVE ของ UserManagement)";
            var users = f.Users.Where(r => r.IsValid).ToList();
            var perms = f.Perms.Where(r => r.IsValid).ToList();
            var bad = f.Users.Where(r => !r.IsValid).Select(r => $"• {r.Sheet} แถว {r.RowNumber}: {(string.IsNullOrEmpty(r.User.UserId) ? "-" : r.User.UserId)} - {r.Error}")
                      .Concat(f.Perms.Where(r => !r.IsValid).Select(r => $"• {r.Sheet} แถว {r.RowNumber}: {(string.IsNullOrEmpty(r.UserId) ? "-" : r.UserId)} {r.SysId} - {r.Error}")).ToList();
            string errs = string.Join("\n", bad.Take(10)) + (bad.Count > 10 ? $"\n• ... และอีก {bad.Count - 10:N0} แถว" : "");
            if (users.Count == 0 && perms.Count == 0) { TryDelete(path); return Fail("ไม่พบรายการที่นำเข้าได้ในไฟล์นี้\n\n" + errs); }
            string summary = $"ไฟล์: {file.FileName}\n\n" +
                             $"ผู้ใช้: เพิ่มใหม่ {users.Count(r => r.IsNew):N0} คน  •  อัพเดท {users.Count(r => !r.IsNew):N0} คน\n" +
                             $"สิทธิ์: ตั้งค่า {perms.Count:N0} รายการ ({perms.Select(p => p.UserId).Distinct(StringComparer.OrdinalIgnoreCase).Count():N0} คน)" +
                             (bad.Count > 0 ? $"\n\n⚠ ข้ามแถวที่มีปัญหา {bad.Count:N0} แถว:\n{errs}" : "") + "\n\nยืนยันการนำเข้าหรือไม่?";
            return Ok(new { id = _uploads.Put(path, file.FileName, Uid, "users", (f, bad.Count)), summary });
        }
        catch (Exception ex) { TryDelete(path); return Fail(ex, "อ่านไฟล์ Excel ไม่สำเร็จ"); }
    }

    [HttpPost("import/apply")]
    public IActionResult ImportApply([FromBody] string id)
    {
        if (Me?.CanAddUser != true || !Me.CanEditUser) return Deny();
        var it = _uploads.Get(id, Uid, "users");
        if (it == null) return Fail("ไฟล์หมดเวลาแล้ว กรุณาเลือกไฟล์ใหม่");
        var (file, bad) = ((UserAdminService.ImportFile, int))it.State;
        try
        {
            var r = _svc.ApplyImport(file);
            LogService.WriteLog(Uid, "USER_IMPORT", $"Import Excel: {it.FileName} | Added: {r.Added} | Updated: {r.Updated} | Permissions: {r.Perms} | Skipped rows: {bad}", "");
            _uploads.Remove(id);
            (_cache as MemoryCache)?.Compact(1.0);   // สิทธิ์ที่นำเข้ามีผลทันที
            return Ok(new { message = $"นำเข้าสำเร็จ\nผู้ใช้เพิ่มใหม่ {r.Added:N0} คน  •  อัพเดท {r.Updated:N0} คน\nสิทธิ์ {r.Perms:N0} รายการ" });
        }
        catch (Exception ex) { return Fail(ex, "นำเข้าไม่สำเร็จ (ยกเลิกทั้งไฟล์ ไม่มีรายการใดถูกบันทึก)"); }
    }
}
