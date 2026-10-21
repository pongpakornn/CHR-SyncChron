using System.Globalization;
using CHR.Synchron.Api.Web.Auth;
using CHR.Synchron.Api.Web.Scanner;
using CIMS.Helpers;
using CIMS.Models;
using CIMS.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CHR.Synchron.Api.Controllers;

// 📷 Multi-Scanner (SystemID MultiScanner) - VIEW = ใช้หน้าสแกน / EDIT = เลือกคลัง + DISPLAY / DEL = ADJUST SCAN / APPROVE = NOT DEDUCTED
[ApiController]
[Authorize]
[Route("api/scanner")]
public sealed class ScannerController : ControllerBase
{
    private readonly ICurrentUser _me;
    public ScannerController(ICurrentUser me) => _me = me;

    private UserSession User_ => _me.Session;
    private IActionResult NoAccess() => StatusCode(403, new { message = "คุณไม่มีสิทธิ์ใช้งาน Multi-Scanner" });
    private ScannerScope Scope(string clientScope) => new(User_, clientScope);

    // ---------------------------------------------------------------- หน้าจอ
    [HttpGet("context")]
    public IActionResult Context([FromQuery] string scope, [FromQuery] bool @out, [FromQuery] bool @return, [FromQuery] bool remainder, [FromQuery] bool test)
    {
        var u = User_;
        if (u == null || !u.CanViewScannerMenu) return NoAccess();
        var sc = Scope(scope);
        var modes = ScanProcessor.EffectiveModes(sc, @out, @return, remainder, test);
        var list = sc.ScopeStocks;
        var svc = new ScanService();
        var displayMap = svc.GetScanDisplayMap(u.UserId);
        var displayFormats = displayMap.Values.Any(v => v.StartsWith("FIELD:")) ? new StockService().GetFormats() : new List<BarcodeFormatModel>();
        string HeaderOf(IEnumerable<StockModel> st)
        {
            var names = st.Select(s => ScanDisplay.HeaderFor(displayMap.TryGetValue(s.StkId, out string k) ? k : ScanDisplay.Default, displayFormats)).Distinct().ToList();
            return names.Count == 0 ? "PRODUCT CODE" : string.Join(" / ", names);
        }
        string HintFor(HashSet<int> ask)
        {
            var on = list.Where(s => ask.Contains(s.StkId)).Select(s => s.Code).ToList();
            return list.Count < 2 || on.Count == list.Count ? "" : "for " + string.Join(", ", on);
        }
        bool asksDept = list.Any(s => sc.AskDepartment.Contains(s.StkId));
        var deductIds = sc.DeductStockIds;
        var miss = new DeductMissService();
        var setup = new ScannerSetupService();

        return Ok(new
        {
            stocks = sc.Stocks.Select(s => new
            {
                s.StkId, s.Code, s.Name, s.IsMain, s.CanScanIn, s.CanScanOut, supportsReturn = ScannerScope.SupportsReturn(s),
                s.AllowDecimal, s.CountCoil, s.IsLiveView, unit = s.UnitDisplay, codeHeader = HeaderOf(new[] { s })
            }),
            scope = new
            {
                auto = sc.Auto, ids = sc.ScopeIds, priorityId = sc.PriorityId, isMulti = sc.IsMultiScope, notAssigned = sc.NotAssigned,
                assignMode = sc.AssignMode, canChange = sc.CanChangeScope, token = sc.AssignToken,
                text = sc.Auto ? "⚡ AUTO ( ALL STOCKS )"
                    : list.Count == 0 ? (sc.AssignMode ? $"⛔ ยังไม่ได้เลือกคลังของ {u.UserId}" : "SELECT STOCK")
                    : list.Count == 1 ? list[0].DisplayName
                    : (string.Join(" + ", list.Select(s => s.Code)) is var n && n.Length <= 34 ? n : $"{list.Count} STOCKS"),
                subText = sc.IsMultiScope ? "SCAN TOGETHER" + (sc.Stocks.FirstOrDefault(s => s.StkId == sc.PriorityId) is { } p ? $"  •  ★ OUT FIRST : {p.Code}" : "") : "",
                serialized = ScannerScope.FormatScope(sc.Auto, sc.ScopeIds, sc.PriorityId)
            },
            modes = new { @out = modes.Out, @return = modes.Return, remainder = modes.Remainder, test = modes.Test, outOnly = sc.IsScanOutOnlyUser },
            buttons = new
            {
                scanOut = u.CanViewScanOut && u.CanViewScanIn && list.Any(s => s.CanScanIn) && list.Any(s => s.CanScanOut),
                @return = u.CanScanReturn && list.Any(ScannerScope.SupportsReturn),
                remainder = u.CanViewScanIn || u.CanViewScanOut,
                adjust = u.CanDeleteScan,
                display = sc.AssignMode ? sc.IsAdmin : u.CanEditScanner,
                deducted = DbSchema.HasTransferScanTx && sc.HasDeductStocks,
                notDeducted = DbSchema.HasDeductMisses && sc.HasDeductStocks,
                approve = u.CanApproveScan
            },
            counts = new
            {
                deductedToday = DbSchema.HasTransferScanTx && sc.HasDeductStocks ? miss.CountDeductedToday(deductIds) : 0,
                notDeducted = DbSchema.HasDeductMisses && sc.HasDeductStocks ? miss.Count(deductIds) : 0
            },
            who = new
            {
                askEmployee = list.Any(s => sc.AskEmployee.Contains(s.StkId)),
                askDepartment = asksDept,
                employeeHint = HintFor(sc.AskEmployee),
                departmentHint = HintFor(sc.AskDepartment),
                departments = asksDept ? setup.GetDepartments() : new List<string>()
            },
            codeHeader = HeaderOf(list),
            // ⌛ ใช้ตรวจป้ายที่ยังมาไม่ครบ (ScanInViewModel.LooksIncomplete) - Browser รอตัวอักษรต่อแทนที่จะตัดรอบ
            formats = sc.Formats.Where(f => f.IsActive).Select(f => new
            {
                delimiter = f.Delimiter, spaces = f.SplitBySpaces, trimChars = f.TrimChars, minFields = f.MinFields,
                required = Math.Max(f.MinFields, Math.Max(f.CodePos, Math.Max(f.AltCodePos ?? 0, Math.Max(f.QtyPos ?? 0, f.MatchByName ? f.NamePositions().DefaultIfEmpty(0).Max() : 0))))
            }),
            contacts = sc.NotAssigned ? ScannerSetupService.ContactText(setup.GetAdminContacts()) : ""
        });
    }

    [HttpGet("today")]
    public IActionResult Today([FromQuery] string scope)
    {
        if (User_?.CanViewScannerMenu != true) return NoAccess();
        var sc = Scope(scope);
        if (sc.NotAssigned) return Ok(new TodayDto { Signature = "locked" });
        return Ok(ScannerToday.Load(sc));
    }

    [HttpPost("scan")]
    public IActionResult Scan([FromBody] ScanRequest req)
    {
        if (User_?.CanViewScannerMenu != true) return NoAccess();
        try { return Ok(new ScanProcessor(Scope(req.ClientScope), req).Process()); }
        catch (Exception ex) { return Ok(ScanResult.Err("เกิดข้อผิดพลาด: " + ex.Message)); }
    }

    // 🏬 SCAN STOCKS: Level 1 เปลี่ยนของตัวเองได้ (บันทึกเป็นค่าของ UserID) / ฐานเดิม = EDIT ของ Multi-Scanner เลือกเอง (จำไว้ที่ Browser)
    public sealed record ScopeRequest(bool Auto, List<int> Ids, int? PriorityId);

    [HttpPost("scope")]
    public IActionResult SaveScope([FromBody] ScopeRequest req)
    {
        var u = User_;
        if (u?.CanViewScannerMenu != true) return NoAccess();
        var sc = Scope(null);
        if (!sc.CanChangeScope) return StatusCode(403, new { message = sc.AssignMode ? "Stocks are set by the Admin (User Management)" : "คุณไม่มีสิทธิ์เลือกคลัง" });
        var ids = (req.Ids ?? new()).Where(id => sc.Stocks.Any(s => s.StkId == id)).Distinct().ToList();
        if (sc.AssignMode)
        {
            try { new ScannerSetupService().SaveAssignment(u.UserId, req.Auto ? sc.Stocks.Select(s => s.StkId) : ids, req.PriorityId, u.UserId, sc.AssignedDeduct); }
            catch (Exception ex) { return BadRequest(new { message = "บันทึกคลังที่สแกนไม่สำเร็จ\n" + ex.Message }); }
        }
        return Ok(new { serialized = ScannerScope.FormatScope(req.Auto, ids, req.PriorityId) });
    }

    // 🏷️ DISPLAY: ค่าที่แสดงแทนรหัสต่อคลัง (ของผู้ใช้คนนั้น)
    [HttpGet("display")]
    public IActionResult GetDisplay()
    {
        var u = User_;
        if (u?.CanViewScannerMenu != true) return NoAccess();
        var sc = Scope(null);
        var map = new ScanService().GetScanDisplayMap(u.UserId);
        var formats = new StockService().GetFormats();
        return Ok(new
        {
            stocks = sc.ScopeStocks.Select(s => new
            {
                s.StkId, s.Code,
                value = map.TryGetValue(s.StkId, out var v) ? v : ScanDisplay.Default,
                options = DisplayOptions.For(s, formats, map.TryGetValue(s.StkId, out var cur) ? cur : ScanDisplay.Default).Select(o => new { key = o.Key, label = o.Label })
            })
        });
    }

    [HttpPost("display")]
    public IActionResult SaveDisplay([FromBody] Dictionary<int, string> map)
    {
        var u = User_;
        if (u?.CanViewScannerMenu != true) return NoAccess();
        var sc = Scope(null);
        if (!(sc.AssignMode ? sc.IsAdmin : u.CanEditScanner)) return StatusCode(403, new { message = "คุณไม่มีสิทธิ์ตั้งค่า DISPLAY" });
        var mine = (map ?? new()).Where(kv => sc.Stocks.Any(s => s.StkId == kv.Key)).ToDictionary(kv => kv.Key, kv => kv.Value);
        new ScanService().SaveScanDisplayMap(mine, u.UserId);
        return Ok();
    }

    // ---------------------------------------------------------------- 🕘 HISTORY
    private ScanHistoryFilter Filter(ScannerScope sc, string key, DateTime? from, DateTime? to, int? stkId, string type)
    {
        DateTime f = (from ?? new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1)).Date, t = (to ?? DateTime.Today).Date;
        if (t < f) (f, t) = (t, f);
        var stock = stkId.HasValue ? sc.Stocks.FirstOrDefault(s => s.StkId == stkId.Value) : null;
        return new ScanHistoryFilter
        {
            Keyword = key ?? "", From = f, To = t, StkId = stock?.StkId, StockIsMain = stock?.IsMain ?? false,
            TxType = string.IsNullOrWhiteSpace(type) ? null : type, UserId = User_.UserId
        };
    }

    [HttpGet("history")]
    public async Task<IActionResult> History([FromQuery] string key, [FromQuery] DateTime? from, [FromQuery] DateTime? to, [FromQuery] int? stkId,
                                             [FromQuery] string type, [FromQuery] int page, CancellationToken ct)
    {
        if (User_?.CanViewScannerMenu != true) return NoAccess();
        var sc = Scope(null);
        var (rows, total) = await new ScanHistoryService().QueryAsync(Filter(sc, key, from, to, stkId, type), Math.Max(0, page), ct);
        return Ok(new
        {
            total, page, pageSize = ScanHistoryService.PageSize,
            stocks = sc.Stocks.Select(s => new { s.StkId, s.Code, s.Name }),
            rows = rows.Select(r => new
            {
                date = r.DateText, r.StockCode, type = r.TxType, code = r.CodeText, r.PartCode, r.PartName, r.Qty, user = r.UserText,
                r.EmployeeId, r.Department, r.RefNo, r.IsCancelled
            })
        });
    }

    [HttpGet("history/export")]
    public IActionResult HistoryExport([FromQuery] string key, [FromQuery] DateTime? from, [FromQuery] DateTime? to, [FromQuery] int? stkId, [FromQuery] string type)
    {
        if (User_?.CanViewScannerMenu != true) return NoAccess();
        var filter = Filter(Scope(null), key, from, to, stkId, type);
        string path = ImportTemplateService.NewPath(ImportTemplateService.Systems.Scanner, "ScanHistory");
        string file = Path.GetFileName(path);
        int n = new ScanHistoryService().Export(filter, path);
        LogService.WriteLog(User_.UserId, "SCAN_HISTORY_EXPORT", $"Rows: {n} | {filter.From.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)} - {filter.To.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)} | Key: {filter.Keyword} | File: {file}", "");
        return Download(path);
    }

    // ---------------------------------------------------------------- 🤖 EXPORT RPA (RpaExportWindow)
    private static string D(DateTime d) => d.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);

    private sealed class RpaRow
    {
        public StockModel Stock; public ScanRpaLayout Layout; public DateTime From, To; public List<ScanHistoryRow> Rows = new(); public bool FileFound;
        public bool CanExport => FileFound && Layout.Entries.Count > 0;
    }

    private List<RpaRow> RpaRows(ScannerScope sc, int? stkId, DateTime day, DateTime filterFrom, DateTime filterTo, out bool pickDay)
    {
        var layouts = new ScanRpaService().GetLayouts();
        var stocks = stkId.HasValue ? sc.Stocks.Where(s => s.StkId == stkId.Value).ToList() : sc.Stocks;
        var rows = stocks.Where(s => layouts.TryGetValue(s.StkId, out var l) && l.HasPath)
                         .Select(s => new RpaRow { Stock = s, Layout = layouts[s.StkId], FileFound = System.IO.File.Exists(CIMS.Core.Storage.MapExternal(layouts[s.StkId].Path)) }).ToList();
        pickDay = rows.Any(r => !string.Equals(r.Layout.DateMode, "TODAY", StringComparison.OrdinalIgnoreCase) && !string.Equals(r.Layout.DateMode, "FILTER", StringComparison.OrdinalIgnoreCase));
        foreach (var r in rows)
        {
            string mode = (r.Layout.DateMode ?? "PICK").ToUpperInvariant();
            (r.From, r.To) = mode == "TODAY" ? (DateTime.Today, DateTime.Today) : mode == "FILTER" ? (filterFrom.Date, filterTo.Date) : (day.Date, day.Date);
            var f = new ScanHistoryFilter { Keyword = "", From = r.From, To = r.To, StkId = r.Stock.StkId, StockIsMain = r.Stock.IsMain, UserId = User_.UserId };
            r.Rows = ScanRpaService.RowsFor(r.Layout, new ScanHistoryService().QueryAll(f, oldestFirst: true));
        }
        return rows;
    }

    [HttpGet("rpa")]
    public IActionResult RpaPreview([FromQuery] int? stkId, [FromQuery] DateTime? day, [FromQuery] DateTime? from, [FromQuery] DateTime? to)
    {
        if (User_?.CanViewScannerMenu != true) return NoAccess();
        if (!DbSchema.HasScanRpa) return BadRequest(new { message = ScannerSetupService.WithContacts("ยังไม่ได้รัน Database/Update_20261020b.sql\nกรุณาติดต่อ Admin") });
        var sc = Scope(null);
        var rows = RpaRows(sc, stkId, day ?? DateTime.Today, from ?? DateTime.Today, to ?? DateTime.Today, out bool pickDay);
        if (rows.Count == 0)
        {
            var stk = stkId.HasValue ? sc.Stocks.FirstOrDefault(s => s.StkId == stkId.Value) : null;
            return BadRequest(new { message = (stk != null ? $"คลัง {stk.Code} " : "คลังที่สแกนได้ ") + "ยังไม่ได้ตั้งค่าไฟล์ RPA\n\nAdmin ตั้งได้ที่ User Management → ⚙ SETUP → EXCEL SETUP → MULTI-SCANNER (RPA)" });
        }
        return Ok(new
        {
            pickDay,
            stocks = rows.Select(r =>
            {
                string mode = (r.Layout.DateMode ?? "PICK").ToUpperInvariant();
                string when = r.From == r.To ? D(r.From) : $"{D(r.From)} - {D(r.To)}";
                string dayText = mode == "TODAY" ? $"TODAY {when}" : mode == "FILTER" ? $"HISTORY FILTER {when}" : when;
                string types = r.Layout.Types.Count == 0 ? "ALL TYPES" : string.Join(" + ", r.Layout.Types);
                string sheetBase = string.IsNullOrWhiteSpace(r.Layout.TemplateSheet) ? "the 1st sheet" : $"\"{r.Layout.TemplateSheet.Trim()}\"";
                string sheet = r.Layout.IsSheetMode
                    ? $"ADD SHEET \"{r.Layout.SheetNameFor(r.From, r.To, r.Stock.Code)}\"{(r.Layout.HasRunning ? " (next running no.)" : "")} (copy of {sheetBase})"
                    : $"CONTINUE below the last row of {sheetBase}";
                return new
                {
                    r.Stock.StkId, code = r.Stock.Code, file = Path.GetFileName(CIMS.Core.Storage.MapExternal(r.Layout.Path)), r.FileFound, canExport = r.CanExport,
                    count = r.Rows.Count, how = $"📅 {dayText}   •   {types}   •   {sheet}",
                    problem = !r.FileFound ? "⚠ ยังไม่มีไฟล์ใน CHR-Synchron - กด UPLOAD FILE (ไฟล์ Excel RPA ของคลังนี้)" : r.Layout.Entries.Count == 0 ? "⚠ No fields set yet (SETUP → EXCEL SETUP)" : "",
                    defaultChecked = r.CanExport && (!stkId.HasValue || r.Stock.StkId == stkId.Value)
                };
            })
        });
    }

    public sealed record RpaExportRequest(List<int> StockIds, DateTime? Day, DateTime? From, DateTime? To, List<int> Replace);

    [HttpPost("rpa")]
    public IActionResult RpaExport([FromBody] RpaExportRequest req)
    {
        if (User_?.CanViewScannerMenu != true) return NoAccess();
        var sc = Scope(null);
        var all = RpaRows(sc, null, req.Day ?? DateTime.Today, req.From ?? DateTime.Today, req.To ?? DateTime.Today, out _);
        var todo = all.Where(r => (req.StockIds ?? new()).Contains(r.Stock.StkId) && r.CanExport && r.Rows.Count > 0).ToList();
        if (todo.Count == 0) return BadRequest(new { message = "No scans on the chosen day" });
        var replace = new HashSet<int>(req.Replace ?? new());
        var done = new List<string>();
        var exists = new List<object>();
        var files = new List<object>();
        foreach (var r in todo)
        {
            bool rep = replace.Contains(r.Stock.StkId);
            try
            {
                var res = new ScanRpaService().Export(r.Rows, r.Layout, r.From, r.To, r.Stock.Code, rep);
                string where = res.First > 0 ? $"sheet \"{res.Sheet}\" rows {res.First}-{res.Last}" : $"sheet \"{res.Sheet}\"";
                done.Add($"✔ {r.Stock.Code}: {r.Rows.Count:N0} รายการ → {Path.GetFileName(r.Layout.Path)} ({where})");
                files.Add(new { r.Stock.StkId, code = r.Stock.Code, name = Path.GetFileName(r.Layout.Path) });
                LogService.WriteLog(User_.UserId, "SCAN_RPA_EXPORT",
                    $"{r.Stock.Code} | {D(r.From)}{(r.From != r.To ? " - " + D(r.To) : "")} | Rows: {r.Rows.Count} | {Path.GetFileName(r.Layout.Path)} | {where}{(rep ? " (replaced)" : "")}", r.Stock.Code);
            }
            catch (RpaSheetExistsException ex)
            {
                // ถามผู้ใช้ก่อนเขียนทับชีทชื่อเดียวกัน (ไม่ = ข้ามคลังนี้)
                exists.Add(new { r.Stock.StkId, code = r.Stock.Code, sheet = ex.SheetName, file = Path.GetFileName(CIMS.Core.Storage.MapExternal(r.Layout.Path)),
                                 question = $"{r.Stock.Code}: ชีท \"{ex.SheetName}\" มีอยู่แล้วในไฟล์\n{Path.GetFileName(CIMS.Core.Storage.MapExternal(r.Layout.Path))}\n\nเขียนทับชีทนี้ด้วยข้อมูลใหม่หรือไม่?\n(ไม่ = ข้ามคลังนี้)" });
            }
            catch (Exception ex)
            {
                string msg = ex.Message.Contains("being used") ? "ไฟล์ Excel ถูกเปิดค้างอยู่ กรุณาปิดไฟล์ก่อน Export" : ex.Message;
                return BadRequest(new { message = "Export RPA ไม่สำเร็จ\n" + msg + (done.Count > 0 ? "\n\nทำไปแล้ว:\n" + string.Join("\n", done) : ""), done, files });
            }
        }
        return Ok(new { done, files, exists });
    }

    // 📥 ดาวน์โหลดไฟล์ RPA ของคลัง (แทนการเปิดไฟล์ให้ตรวจข้อมูลในเครื่องแบบ WPF)
    [HttpGet("rpa/file/{stkId:int}")]
    public IActionResult RpaFile(int stkId)
    {
        if (User_?.CanViewScannerMenu != true) return NoAccess();
        var sc = Scope(null);
        if (!sc.Stocks.Any(s => s.StkId == stkId)) return NotFound();
        if (!new ScanRpaService().GetLayouts().TryGetValue(stkId, out var l) || !l.HasPath) return NotFound();
        string path = CIMS.Core.Storage.MapExternal(l.Path);
        if (!System.IO.File.Exists(path)) return NotFound(new { message = "ยังไม่มีไฟล์ RPA ของคลังนี้ใน CHR-Synchron - กด UPLOAD FILE ก่อน" });
        return Download(path);
    }

    // 📤 ไฟล์ Excel RPA ของคลัง (Template ของ CHR-Synchron) -> storage/excel ชื่อเดียวกับที่ตั้งไว้ - ไม่เขียนไฟล์ของระบบจริง
    [HttpPost("rpa/file/{stkId:int}")]
    [RequestSizeLimit(30_000_000)]
    public async Task<IActionResult> RpaUpload(int stkId, IFormFile file)
    {
        if (User_?.CanViewScannerMenu != true) return NoAccess();
        var sc = Scope(null);
        if (!sc.Stocks.Any(s => s.StkId == stkId)) return NotFound();
        if (!new ScanRpaService().GetLayouts().TryGetValue(stkId, out var l) || !l.HasPath) return BadRequest(new { message = "คลังนี้ยังไม่ได้ตั้งค่าไฟล์ RPA" });
        if (file == null || file.Length == 0 || !file.FileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase)) return BadRequest(new { message = "กรุณาเลือกไฟล์ Excel (.xlsx)" });
        string path = CIMS.Core.Storage.MapExternal(l.Path);
        await using (var fs = System.IO.File.Create(path)) await file.CopyToAsync(fs);
        LogService.WriteLog(User_.UserId, "SCAN_RPA_UPLOAD", $"{sc.Stocks.First(s => s.StkId == stkId).Code} | {Path.GetFileName(path)}", "");
        return Ok(new { name = Path.GetFileName(path) });
    }

    private IActionResult Download(string path)
    {
        var bytes = System.IO.File.ReadAllBytes(path);
        return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", Path.GetFileName(path));
    }
}

