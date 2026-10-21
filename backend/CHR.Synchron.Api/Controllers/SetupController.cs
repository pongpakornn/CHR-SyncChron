using CHR.Synchron.Api.Web;
using CIMS.Core;
using CIMS.Helpers;
using CIMS.Services;
using Microsoft.AspNetCore.Mvc;

namespace CHR.Synchron.Api.Controllers;

// ⚙ SETUP (SystemSetupWindow - Admin Level 1): PR SETTINGS / EXCEL SETUP (PR หรือ MULTI-SCANNER RPA) / DEPARTMENTS
//   ไฟล์ Excel อยู่ใน storage/excel ของ CHR-Synchron (อัปโหลดจากหน้าเว็บ) - Path เดิมในฐานข้อมูล = ใช้ชื่อไฟล์
[Route("api/setup")]
public sealed class SetupController : AppController
{
    private IActionResult AdminOnly() => Deny("เฉพาะ Admin (Level 1) เท่านั้น");
    private bool IsAdmin => Me?.UserLevel == 1;

    // ---------------------------------------------------------------- PR SETTINGS (คลังที่เก็บ PR)
    [HttpGet("pr")]
    public IActionResult Pr()
    {
        if (!IsAdmin) return AdminOnly();
        var svc = new StockService();
        var auto = svc.GetPrAutoMap();
        var layouts = svc.GetPrExcelLayouts();
        return Ok(svc.GetStocks().Select(s => new
        {
            s.StkId, s.Code, s.Name, keep = auto.TryGetValue(s.StkId, out bool k) && k,
            file = layouts.TryGetValue(s.StkId, out var l) && l.HasPath ? Path.GetFileName(Storage.MapExternal(l.Path)) : null
        }));
    }

    [HttpPost("pr")]
    public IActionResult SavePr([FromBody] Dictionary<int, bool> keep)
    {
        if (!IsAdmin) return AdminOnly();
        if (keep == null || keep.Count == 0) return Ok(new { message = "ไม่มีการเปลี่ยนแปลง" });
        try
        {
            var svc = new StockService();
            svc.SetPrAuto(keep, Uid);
            var auto = svc.GetPrAutoMap();
            string on = string.Join(", ", svc.GetStocks().Where(s => auto.TryGetValue(s.StkId, out bool k) && k).Select(s => s.Code));
            LogService.WritePRLog(Uid, "PR_SETTINGS", $"KEEP PR stocks: {(on.Length == 0 ? "-" : on)}", "PR_SETTINGS");
            return Ok(new { message = "บันทึก PR SETTINGS เรียบร้อยแล้ว\n\nคลังที่เก็บ PR: " + (on.Length == 0 ? "ไม่มี" : on) });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกไม่สำเร็จ"); }
    }

    // ---------------------------------------------------------------- EXCEL SETUP
    [HttpGet("excel")]
    public IActionResult Excel()
    {
        if (!IsAdmin) return AdminOnly();
        var svc = new StockService();
        var stocks = svc.GetStocks();
        var auto = svc.GetPrAutoMap();
        var pr = svc.GetPrExcelLayouts();
        var rpa = new ScanRpaService().GetLayouts();
        object Entries(IEnumerable<PRExcelEntry> e) => e.Select(x => new { x.Field, x.IsTable, x.Target });
        return Ok(new
        {
            hasPrStock = DbSchema.HasPrStock, hasScanRpa = DbSchema.HasScanRpa,
            prFields = PRExcelFields.All.Select(f => new { key = f.Key, label = f.Label }),
            rpaFields = ScanRpaFields.All.Select(f => new { key = f.Key, label = f.Label }),
            prDefault = Entries(PRExcelLayout.DefaultEntries()),
            rpaDefault = Entries(ScanRpaLayout.DefaultEntries()),
            pr = stocks.OrderByDescending(s => auto.TryGetValue(s.StkId, out bool k) && k).Select(s =>
            {
                var l = pr.TryGetValue(s.StkId, out var x) ? x : new PRExcelLayout { StockId = s.StkId, Entries = PRExcelLayout.DefaultEntries() };
                return new
                {
                    s.StkId, s.Code, keepPr = auto.TryGetValue(s.StkId, out bool on) && on, path = l.Path ?? "", l.StartRow, entries = Entries(l.Entries),
                    fileFound = l.HasPath && System.IO.File.Exists(Storage.MapExternal(l.Path))
                };
            }),
            rpa = stocks.Where(s => s.CanScanIn || s.CanScanOut || rpa.ContainsKey(s.StkId))
                        .OrderByDescending(s => rpa.TryGetValue(s.StkId, out var l) && l.HasPath).ThenByDescending(s => s.CanScanOut).Select(s =>
            {
                var l = rpa.TryGetValue(s.StkId, out var x) ? x : new ScanRpaLayout { StockId = s.StkId, Entries = ScanRpaLayout.DefaultEntries() };
                return new
                {
                    s.StkId, s.Code, path = l.Path ?? "", l.StartRow, entries = Entries(l.Entries), addSheet = l.IsSheetMode, baseSheet = l.TemplateSheet ?? "",
                    sheetName = l.SheetName ?? "", dateMode = (l.DateMode ?? "PICK").ToUpperInvariant(), txTypes = l.TxTypes ?? "",
                    fileFound = l.HasPath && System.IO.File.Exists(Storage.MapExternal(l.Path))
                };
            })
        });
    }

    public sealed class EntryDto
    {
        public string Field { get; set; }
        public bool IsTable { get; set; }
        public string Target { get; set; }
    }

    public sealed class ExcelSave
    {
        public bool IsRpa { get; set; }
        public int StkId { get; set; }
        public string Path { get; set; }
        public int StartRow { get; set; }
        public List<EntryDto> Entries { get; set; } = new();
        public bool AddSheet { get; set; }
        public string BaseSheet { get; set; }
        public string SheetName { get; set; }
        public string DateMode { get; set; }
        public string TxTypes { get; set; }
    }

    // ตรวจเหมือน ExcelSetupPanel.Save - ผิด = คืนข้อความ / ต้องถามยืนยัน = คืน confirm
    [HttpPost("excel")]
    public IActionResult SaveExcel([FromBody] List<ExcelSave> list, [FromQuery] bool confirmed = false)
    {
        if (!IsAdmin) return AdminOnly();
        list ??= new();
        var stocks = new StockService().GetStocks();
        var confirms = new List<string>();
        foreach (var r in list)
        {
            string code = stocks.FirstOrDefault(s => s.StkId == r.StkId)?.Code ?? r.StkId.ToString();
            string sys = r.IsRpa ? "MULTI-SCANNER" : "PR";
            if (r.IsRpa ? !DbSchema.HasScanRpa : !DbSchema.HasPrStock) return Fail(r.IsRpa ? "⚠ Run Database/Update_20261020b.sql first - cannot save MULTI-SCANNER yet" : "⚠ Run Database/Update_20261017.sql first - cannot save PR yet");
            var entries = (r.Entries ?? new()).Select(x => new PRExcelEntry { Field = x.Field, IsTable = x.IsTable, Target = (x.Target ?? "").Trim().ToUpperInvariant() }).ToList();
            var bad = entries.FirstOrDefault(x => x.IsTable ? !(r.IsRpa ? ScanRpaLayout.ValidTableTarget(x.Target) : PRExcelLayout.ValidColumn(x.Target)) : !PRExcelLayout.ValidCell(x.Target));
            if (bad != null)
                return Fail($"{sys} {code}: {(r.IsRpa ? ScanRpaFields.Label(bad.Field) : PRExcelFields.Label(bad.Field))} ช่อง \"{bad.Target}\" ไม่ถูกต้อง\n" +
                            (bad.IsTable ? (r.IsRpa ? "TABLE COLUMN ใส่คอลัมน์ เช่น B หรือเซลล์เริ่มต้น เช่น B3" : "TABLE COLUMN ใส่ตัวอักษรคอลัมน์ เช่น B") : "ONE CELL ใส่เซลล์ เช่น C1"));
            var dup = entries.GroupBy(x => x.Target).FirstOrDefault(g => g.Count() > 1);
            if (dup != null) return Fail($"{sys} {code}: ช่อง {dup.Key} ถูกใช้ซ้ำ");
            string path = (r.Path ?? "").Trim();
            if (r.IsRpa && path.Length > 0)
            {
                if (r.AddSheet && string.IsNullOrWhiteSpace(r.SheetName)) return Fail($"{sys} {code}: กรุณาใส่ NEW SHEET NAME (เช่น RPA {{DATE}})");
                if (r.AddSheet && !(r.SheetName ?? "").Contains("{DATE}") && !(r.SheetName ?? "").Contains("{N}") && !(r.SheetName ?? "").Contains("+1"))
                    confirms.Add($"{sys} {code}: NEW SHEET NAME ไม่มี {{DATE}} หรือเลขรัน (+1 / {{N}})\nทุกครั้งที่ Export จะได้ชื่อชีทเดิม (ระบบจะถามก่อนเขียนทับ)");
                if (string.IsNullOrWhiteSpace(r.TxTypes)) return Fail($"{sys} {code}: เลือก TYPE อย่างน้อย 1 อย่าง (OUT / IN / RETURN)");
            }
            if (path.Length > 0 && !System.IO.File.Exists(Storage.MapExternal(path)))
                confirms.Add($"{sys} {code}: ยังไม่มีไฟล์ \"{Path.GetFileName(Storage.MapExternal(path))}\" ใน CHR-Synchron (กด UPLOAD ภายหลังได้)");
        }
        if (confirms.Count > 0 && !confirmed) return Ok(new { confirm = string.Join("\n\n", confirms) + "\n\nบันทึกต่อหรือไม่?" });
        try
        {
            var svc = new StockService();
            var rpaSvc = new ScanRpaService();
            var done = new List<string>();
            foreach (var r in list)
            {
                string code = stocks.FirstOrDefault(s => s.StkId == r.StkId)?.Code ?? r.StkId.ToString();
                var entries = (r.Entries ?? new()).Select(x => new PRExcelEntry { Field = x.Field, IsTable = x.IsTable, Target = (x.Target ?? "").Trim().ToUpperInvariant() }).ToList();
                if (r.IsRpa)
                {
                    var l = new ScanRpaLayout
                    {
                        StockId = r.StkId, Path = (r.Path ?? "").Trim(), StartRow = Math.Max(1, r.StartRow), Entries = entries, WriteMode = r.AddSheet ? "SHEET" : "APPEND",
                        TemplateSheet = (r.BaseSheet ?? "").Trim(), SheetName = (r.SheetName ?? "").Trim(),
                        DateMode = r.DateMode is "TODAY" or "FILTER" ? r.DateMode : "PICK", TxTypes = r.TxTypes ?? ""
                    };
                    rpaSvc.SaveLayout(l, Uid);
                    LogService.WriteLog(Uid, "SCAN_RPA_SETUP",
                        $"{code} | File: {(l.HasPath ? l.Path : "-")} | {(l.IsSheetMode ? $"ADD SHEET {l.SheetName} from {(string.IsNullOrWhiteSpace(l.TemplateSheet) ? "1st sheet" : l.TemplateSheet)}" : $"CONTINUE {(string.IsNullOrWhiteSpace(l.TemplateSheet) ? "1st sheet" : l.TemplateSheet)}")}" +
                        $" | Day: {l.DateMode} | Types: {l.TxTypes} | Start row: {l.StartRow} | {l.MapText}", code);
                    done.Add("📡 MULTI-SCANNER  " + code);
                }
                else
                {
                    var l = new PRExcelLayout { StockId = r.StkId, Path = (r.Path ?? "").Trim(), StartRow = Math.Max(1, r.StartRow), Entries = entries };
                    svc.SavePrExcelLayout(l, Uid);
                    LogService.WritePRLog(Uid, "PR_EXCEL_SETUP", $"{code} | File: {(l.HasPath ? l.Path : "-")} | Start row: {l.StartRow} | {l.MapText}", code);
                    done.Add("🧾 PR  " + code);
                }
            }
            return Ok(new { message = "บันทึก EXCEL SETUP แล้ว\n" + string.Join("\n", done) });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกไม่สำเร็จ"); }
    }

    // ตัวอย่างข้อความที่จะลง (ExcelSetupPanel.Refresh)
    [HttpPost("excel/preview")]
    public IActionResult Preview([FromBody] ExcelSave r)
    {
        if (!IsAdmin) return AdminOnly();
        var entries = (r.Entries ?? new()).Select(x => new PRExcelEntry { Field = x.Field, IsTable = x.IsTable, Target = (x.Target ?? "").Trim().ToUpperInvariant() }).ToList();
        string Label(string k) => r.IsRpa ? ScanRpaFields.Label(k) : PRExcelFields.Label(k);
        var heads = entries.Where(x => !x.IsTable).Select(x => $"{x.Target} = {Label(x.Field)}");
        var cols = entries.Where(x => x.IsTable).OrderBy(x => x.Target.Length).ThenBy(x => x.Target).Select(x => $"{x.Target} = {Label(x.Field)}");
        string code = new StockService().GetStock(r.StkId)?.Code ?? "";
        var rl = new ScanRpaLayout
        {
            StockId = r.StkId, Path = r.Path, StartRow = Math.Max(1, r.StartRow), Entries = entries, WriteMode = r.AddSheet ? "SHEET" : "APPEND",
            TemplateSheet = (r.BaseSheet ?? "").Trim(), SheetName = (r.SheetName ?? "").Trim(), DateMode = r.DateMode, TxTypes = r.TxTypes
        };
        int from = r.IsRpa ? rl.TableStart : r.StartRow;
        string text = "ONE CELL  :  " + (heads.Any() ? string.Join("   ", heads) : "-") +
                      $"\nTABLE (from row {from}, next export finds the next empty row - rows past the template get the same borders)  :  " + (cols.Any() ? string.Join("   ", cols) : "-");
        if (r.IsRpa)
        {
            string baseName = string.IsNullOrWhiteSpace(rl.TemplateSheet) ? "the 1st sheet" : $"\"{rl.TemplateSheet}\"";
            text += "\nSHEET :  " + (rl.IsSheetMode ? $"new sheet \"{rl.SheetNameFor(DateTime.Today, DateTime.Today, code)}\" (today){(rl.HasRunning ? $", next one \"{rl.SheetNameFor(DateTime.Today, DateTime.Today, code, 2)}\" ..." : "")} copied from {baseName}" : $"continue in {baseName}") +
                    "\nSCANS :  " + (rl.DateMode == "TODAY" ? "today" : rl.DateMode == "FILTER" ? "HISTORY FROM - TO" : "the day chosen at EXPORT RPA") +
                    "  •  " + (rl.Types.Count == 0 ? "ALL TYPES" : string.Join(" + ", rl.Types));
        }
        return Ok(new { text });
    }

    // ไฟล์ Excel ของ Setup: อัปโหลดเข้า storage/excel (ชื่อไฟล์เดียวกับที่ตั้งไว้) / อ่านชื่อชีท
    [HttpPost("excel/file")]
    [RequestSizeLimit(30_000_000)]
    public async Task<IActionResult> UploadFile(IFormFile file)
    {
        if (!IsAdmin) return AdminOnly();
        if (file == null || !file.FileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase)) return Fail("กรุณาเลือกไฟล์ Excel (.xlsx)");
        string path = Storage.MapExternal(Path.GetFileName(file.FileName));
        await using (var fs = System.IO.File.Create(path)) await file.CopyToAsync(fs);
        LogService.WriteLog(Uid, "EXCEL_FILE_UPLOAD", $"File: {Path.GetFileName(path)}", "");
        List<string> sheets;
        try { sheets = ScanRpaService.SheetNames(path); } catch { sheets = new(); }
        return Ok(new { path = Path.GetFileName(path), sheets });
    }

    [HttpGet("excel/sheets")]
    public IActionResult Sheets([FromQuery] string path)
    {
        if (!IsAdmin) return AdminOnly();
        string full = Storage.MapExternal(path ?? "");
        if (string.IsNullOrWhiteSpace(path) || !System.IO.File.Exists(full)) return Fail("ไม่พบไฟล์ Excel ใน CHR-Synchron\n" + Path.GetFileName(full));
        try { return Ok(ScanRpaService.SheetNames(full)); }
        catch (Exception ex) { return Fail(ex, "อ่านชื่อชีทไม่สำเร็จ"); }
    }

    // ---------------------------------------------------------------- DEPARTMENTS
    [HttpGet("departments")]
    public IActionResult Departments()
    {
        if (!IsAdmin) return AdminOnly();
        return Ok(new { canSave = DbSchema.HasScanDepartments, names = new ScannerSetupService().GetDepartments() });
    }

    [HttpPost("departments")]
    public IActionResult SaveDepartments([FromBody] List<string> names)
    {
        if (!IsAdmin) return AdminOnly();
        if (!DbSchema.HasScanDepartments) return Fail("⚠ Run Database/Update_20261020b.sql first - cannot save yet");
        names = (names ?? new()).Select(n => (n ?? "").Trim()).ToList();
        if (names.Any(n => n.Length == 0)) return Fail("มีแผนกที่ชื่อว่าง กรุณาใส่ชื่อ หรือกด ✕ เพื่อลบ");
        var dup = names.GroupBy(n => n, StringComparer.OrdinalIgnoreCase).FirstOrDefault(g => g.Count() > 1);
        if (dup != null) return Fail($"ชื่อแผนก \"{dup.Key}\" ซ้ำกัน");
        var svc = new ScannerSetupService();
        try
        {
            var before = svc.GetDepartments();
            svc.SaveDepartments(names, Uid);
            var added = names.Except(before, StringComparer.OrdinalIgnoreCase).ToList();
            var removed = before.Except(names, StringComparer.OrdinalIgnoreCase).ToList();
            LogService.WriteLog(Uid, "SCAN_DEPARTMENTS", $"Departments: {string.Join(", ", names)}" +
                (added.Count > 0 ? $" | Added: {string.Join(", ", added)}" : "") + (removed.Count > 0 ? $" | Removed: {string.Join(", ", removed)}" : ""), "");
            return Ok(new { message = $"บันทึกรายการแผนก {names.Count} รายการแล้ว\nหน้า Multi-Scanner ที่เปิดอยู่ใช้รายการใหม่ภายในไม่กี่วินาที" });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกไม่สำเร็จ"); }
    }
}
