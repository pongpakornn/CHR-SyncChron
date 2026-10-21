using System.Globalization;
using CHR.Synchron.Api.Web;
using CIMS.Core;
using CIMS.Models;
using CIMS.Services;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;

namespace CHR.Synchron.Api.Controllers;

// 📐 MAX-MIN CALCULATOR (MaxMinCalculatorView + MaxMinFormulaWindow + WorkdayWindow)
//   VIEW = ดูตาราง / Template / ปฏิทินวันทำงาน (ดูอย่างเดียว) - EDIT = สูตร / ตั้งค่าคลัง / แก้วัน / RESET / Import / CALCULATE
[Route("api/maxmin")]
public sealed class MaxMinController : AppController
{
    private readonly MaxMinCalcService _svc = new();
    private readonly StockService _stocks = new();
    private readonly UploadCache _uploads;
    public MaxMinController(UploadCache uploads) => _uploads = uploads;

    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
    private bool CanView => Me?.CanViewMaxMinCalc == true;
    private bool CanEdit => Me?.CanEditMaxMinCalc == true;

    private StockModel FindStock(int stkId)
    {
        var s = _stocks.GetStocks().FirstOrDefault(x => x.StkId == stkId);
        return s != null && Me.CanViewStock(s) ? s : null;
    }

    private static string Unit(StockModel s) => s.MaxMinInBox ? "BOX" : s.MaxMinInCoil ? "COIL" : s.MaxMinUnit;

    private (List<MaxMinFormula> list, StockCalcSetting setting, MaxMinFormula formula) Formula(int stkId)
    {
        var fl = _svc.GetFormulas();
        var st = _svc.GetStockSetting(stkId);
        var f = fl.FirstOrDefault(x => x.FormulaId == st.FormulaId) ?? fl.FirstOrDefault(x => x.IsDefault) ?? fl.FirstOrDefault() ?? new MaxMinFormula();
        return (fl, st, f);
    }

    private static object FormulaDto(MaxMinFormula f, bool inBox) => new
    {
        f.FormulaId, f.Name, f.IsDefault, f.QtySource, f.RoundMode, f.DefDayMax, f.DefDayMin, f.DefWorkdays, f.DisplayName, describe = f.Describe(inBox)
    };

    [HttpGet("stocks")]
    public IActionResult Stocks()
    {
        if (!CanView) return Deny();
        var list = _stocks.GetStocks().Where(Me.CanViewStock).ToList();
        return Ok(new
        {
            canEdit = CanEdit,
            stocks = list.Select(s => new { s.StkId, s.Code, s.Name, unit = Unit(s), inBox = s.MaxMinInBox || s.MaxMinInCoil, coil = s.MaxMinInCoil })
        });
    }

    // ตาราง + สูตรที่คลังใช้ + AUTO CALC + เดือน Order ล่าสุด
    [HttpGet("rows")]
    public IActionResult Rows([FromQuery] int stk, [FromQuery] string key)
    {
        if (!CanView) return Deny();
        var stock = FindStock(stk);
        if (stock == null) return Fail("ไม่พบคลังที่เลือก หรือคุณไม่มีสิทธิ์ดูคลังนี้");
        try
        {
            var (list, setting, f) = Formula(stk);
            var rows = _svc.GetRows(stock, f, key ?? "");
            foreach (var g in rows.GroupBy(r => r.GroupKey)) { int n = 0; foreach (var r in g) r.No = ++n; }
            var month = _svc.GetLatestImportMonth();
            bool inBox = stock.MaxMinInBox || stock.MaxMinInCoil;
            return Ok(new
            {
                unit = Unit(stock),
                formulas = list.Select(x => FormulaDto(x, inBox)),
                formula = FormulaDto(f, inBox),
                setting = new { setting.FormulaId, setting.AutoCalc, lastCalc = setting.LastCalc?.ToString("dd MMM yyyy HH:mm", Inv).ToUpperInvariant() },
                order = month.HasValue ? month.Value.ToString("MMM yyyy", Inv).ToUpperInvariant() : null,
                rows = rows.Select(r => new { r.PtId, group = r.GroupKey, r.No, r.PartCode, r.PartNo, r.PartName, r.PackSize, r.DayMax, r.DayMin, r.HasOwnDays, qtyMax = r.QtyMaxText, qtyMin = r.QtyMinText })
            });
        }
        catch (Exception ex) { return Fail(ex, "โหลดข้อมูล Max-Min Calculator ไม่สำเร็จ"); }
    }

    // ⚡ เรียลไทม์ (LiveRefresh เดิม): เครื่องอื่นคำนวณ / ตั้งวัน / ตั้งสูตร / Import -> หน้าโหลดใหม่เอง
    [HttpGet("token")]
    public IActionResult Token([FromQuery] int stk)
    {
        if (!CanView) return Deny();
        var st = FindStock(stk);
        if (st == null) return Ok(new { token = "" });
        using var conn = new SqlConnection(GlobalConfig.ConnStr);
        string q(string sql) => conn.QueryFirst<string>(sql);
        string t = string.Join("#",
            q("SELECT CONCAT(COUNT(*), '|', CHECKSUM_AGG(BINARY_CHECKSUM(*))) FROM CIMS.MaxMinPartConfigs"),
            q("SELECT CONCAT(COUNT(*), '|', CHECKSUM_AGG(BINARY_CHECKSUM(*))) FROM CIMS.MaxMinFormulas"),
            q("SELECT CONCAT(COUNT(*), '|', CHECKSUM_AGG(BINARY_CHECKSUM(*))) FROM CIMS.MaxMinStockSettings"),
            q("SELECT CONCAT(MAX(ImportID), '|', COUNT_BIG(*)) FROM CIMS.ForecastOrderImports"),
            q("SELECT CONCAT(COUNT(*), '|', CHECKSUM_AGG(BINARY_CHECKSUM(*))) FROM CIMS.CustomerWorkdays"),
            st.IsMain ? q("SELECT CONCAT(COUNT(*), '|', CHECKSUM_AGG(CHECKSUM(PartID, MaxQuantity, MinQuantity, PackSize, IsShowInMaster, Customer, Description))) FROM CIMS.Parts")
                      : q($"SELECT CONCAT(COUNT(*), '|', CHECKSUM_AGG(CHECKSUM(PartID, MaxQuantity, MinQuantity, IsShow))) FROM CIMS.PartStocks WHERE StockID = {st.StkId}"));
        return Ok(new { token = t + st.StkId });
    }

    public sealed record SettingRequest(int Stk, int FormulaId, bool AutoCalc);

    [HttpPost("setting")]
    public IActionResult SaveSetting([FromBody] SettingRequest req)
    {
        if (!CanEdit) return Deny();
        var stock = FindStock(req.Stk);
        var f = _svc.GetFormulas().FirstOrDefault(x => x.FormulaId == req.FormulaId);
        if (stock == null || f == null) return Fail("ไม่พบคลังหรือสูตรที่เลือก");
        try
        {
            _svc.SaveStockSetting(stock.StkId, f.FormulaId, req.AutoCalc, Uid);
            LogService.WriteLog(Uid, "MAXMIN_STOCK_SETTING", $"Stock: {stock.Code} | Formula: {f.Name} | Auto calc: {(req.AutoCalc ? "ON" : "OFF")}", stock.Code);
            return Ok(new { message = $"คลัง {stock.Code} ใช้สูตร {f.Name}  •  AUTO CALC {(req.AutoCalc ? "ON" : "OFF")}" });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกการตั้งค่าคลังไม่สำเร็จ"); }
    }

    public sealed record DaysRequest(int Stk, int PtId, int DayMax, int DayMin);

    // 💾 SAVE: MAX / MIN (DAYS) ของสินค้า แล้วคำนวณสินค้านี้ใหม่ทันที (ถ้ามี Order)
    [HttpPost("days")]
    public IActionResult SaveDays([FromBody] DaysRequest req)
    {
        if (!CanEdit) return Deny();
        var stock = FindStock(req.Stk);
        if (stock == null) return Fail("ไม่พบคลังที่เลือก");
        if (req.DayMax <= 0 || req.DayMin < 0) return Fail("MAX (DAYS) ต้องมากกว่า 0 และ MIN (DAYS) ต้องไม่ติดลบ");
        if (req.DayMin > req.DayMax) return Fail("MIN (DAYS) ต้องไม่มากกว่า MAX (DAYS)");
        try
        {
            var (_, _, f) = Formula(stock.StkId);
            var row = _svc.GetRows(stock, f, "").FirstOrDefault(r => r.PtId == req.PtId);
            if (row == null) return Fail("ไม่พบสินค้านี้ในคลัง (อาจถูกลบหรือซ่อนแล้ว)");
            _svc.SaveDays(stock, row, req.DayMax, req.DayMin, Uid);
            LogService.WriteLog(Uid, "MAXMIN_DAYS", $"Stock: {stock.Code} | {row.PartNo} | MAX DAYS {row.DayMax}->{req.DayMax} | MIN DAYS {row.DayMin}->{req.DayMin}", row.PartCode);
            var r = _svc.Calculate(stock.StkId, row.PtId, Uid);
            return Ok(new
            {
                message = $"บันทึก MAX {req.DayMax} วัน / MIN {req.DayMin} วัน ของ {row.PartNo} แล้ว" +
                          (r.Updated > 0 ? "\nคำนวณ MAX / MIN ใหม่แล้ว" : "\nยังไม่มี Order - ค่า MAX / MIN ยังไม่เปลี่ยน")
            });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกไม่สำเร็จ"); }
    }

    public sealed record ResetRequest(int Stk, int PtId);

    [HttpPost("reset")]
    public IActionResult Reset([FromBody] ResetRequest req)
    {
        if (!CanEdit) return Deny();
        var stock = FindStock(req.Stk);
        if (stock == null) return Fail("ไม่พบคลังที่เลือก");
        try
        {
            var (_, _, f) = Formula(stock.StkId);
            var row = _svc.GetRows(stock, f, "").FirstOrDefault(r => r.PtId == req.PtId);
            if (row == null) return Fail("ไม่พบสินค้านี้ในคลัง");
            _svc.ResetMaxMin(stock, row.PtId);
            LogService.WriteLog(Uid, "MAXMIN_RESET", $"Stock: {stock.Code} | {row.PartNo} | MAX {row.QtyMax}->0 | MIN {row.QtyMin}->0", row.PartCode);
            return Ok(new { message = $"ล้างค่า MAX / MIN ของ {row.PartNo} แล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "ล้างค่าไม่สำเร็จ"); }
    }

    private string CalcResult((int Updated, int Skipped, int Stocks) r, string what, string code)
    {
        LogService.WriteLog(Uid, "MAXMIN_CALCULATE", $"{what} | Stocks: {r.Stocks} | Updated: {r.Updated} | Skipped (no order): {r.Skipped}", code);
        return r.Stocks == 0 ? "ไม่มีคลังที่เปิด AUTO CALC"
            : $"อัปเดต MAX / MIN แล้ว {r.Updated:N0} รายการ" + (r.Skipped > 0 ? $"\nยังไม่มี Order {r.Skipped:N0} รายการ (ไม่เปลี่ยน)" : "");
    }

    // ⚡ CALCULATE NOW: คลังที่เลือกทั้งหมด
    [HttpPost("calculate")]
    public IActionResult Calculate([FromBody] int stk)
    {
        if (!CanEdit) return Deny();
        var stock = FindStock(stk);
        if (stock == null) return Fail("ไม่พบคลังที่เลือก");
        try { return Ok(new { message = CalcResult(_svc.Calculate(stock.StkId, null, Uid), $"คำนวณคลัง {stock.Code}", stock.Code) }); }
        catch (Exception ex) { return Fail("คำนวณไม่สำเร็จ: " + ex.Message); }
    }

    #region === [ Formulas ] ===

    [HttpGet("formulas")]
    public IActionResult Formulas()
    {
        if (!CanView) return Deny();
        return Ok(_svc.GetFormulas().Select(f => FormulaDto(f, true)));
    }

    public sealed record FormulaRequest(int FormulaId, string Name, string QtySource, string RoundMode, int DefDayMax, int DefDayMin, int DefWorkdays);

    [HttpPost("formulas")]
    public IActionResult SaveFormula([FromBody] FormulaRequest req)
    {
        if (!CanEdit) return Deny();
        var cur = req.FormulaId > 0 ? _svc.GetFormulas().FirstOrDefault(x => x.FormulaId == req.FormulaId) : null;
        if (req.FormulaId > 0 && cur == null) return Fail("ไม่พบสูตรนี้ (อาจถูกลบไปแล้ว)");
        var f = new MaxMinFormula
        {
            FormulaId = req.FormulaId,
            IsDefault = cur?.IsDefault ?? false,
            // ชื่อสูตร DEFAULT คงไว้
            Name = cur?.IsDefault == true ? cur.Name : (req.Name ?? "").Trim(),
            QtySource = req.QtySource == "FORECAST" ? "FORECAST" : "ORDER",
            RoundMode = req.RoundMode is "NEAREST" or "DOWN" ? req.RoundMode : "UP",
            DefDayMax = req.DefDayMax, DefDayMin = req.DefDayMin, DefWorkdays = req.DefWorkdays
        };
        if (string.IsNullOrEmpty(f.Name)) return Fail("กรุณากรอกชื่อสูตร (FORMULA NAME)");
        if (f.DefDayMax <= 0 || f.DefDayMin < 0) return Fail("DEFAULT MAX (DAYS) ต้องมากกว่า 0 และ MIN (DAYS) ต้องไม่ติดลบ");
        if (f.DefDayMin > f.DefDayMax) return Fail("DEFAULT MIN (DAYS) ต้องไม่มากกว่า MAX (DAYS)");
        if (f.DefWorkdays <= 0 || f.DefWorkdays > 31) return Fail("DEFAULT WORKDAYS ต้องอยู่ระหว่าง 1 - 31 วัน");
        try
        {
            if (_svc.IsFormulaNameTaken(f.Name, f.FormulaId)) return Fail($"ชื่อสูตร \"{f.Name}\" มีอยู่แล้ว กรุณาใช้ชื่ออื่น");
            int id = _svc.SaveFormula(f, Uid);
            LogService.WriteLog(Uid, "MAXMIN_FORMULA",
                $"{(f.FormulaId == 0 ? "Created" : "Updated")} formula {f.Name} | Source: {f.QtySource} | Round: {f.RoundMode} | Default MAX {f.DefDayMax} MIN {f.DefDayMin} WD {f.DefWorkdays}", f.Name);
            return Ok(new { id, message = $"บันทึกสูตร {f.Name} แล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกสูตรไม่สำเร็จ"); }
    }

    [HttpDelete("formulas/{id:int}")]
    public IActionResult DeleteFormula(int id)
    {
        if (!CanEdit) return Deny();
        var f = _svc.GetFormulas().FirstOrDefault(x => x.FormulaId == id);
        if (f == null || f.IsDefault) return Fail("สูตร DEFAULT ลบไม่ได้");
        try
        {
            var used = _svc.DeleteFormula(id);
            if (used.Count > 0)
                return Fail($"ลบสูตร \"{f.Name}\" ไม่ได้ เพราะคลังต่อไปนี้ใช้อยู่\n\n• {string.Join("\n• ", used)}\n\nกรุณาเปลี่ยนสูตรของคลังเหล่านี้ก่อน");
            LogService.WriteLog(Uid, "MAXMIN_FORMULA", $"Deleted formula {f.Name}", f.Name);
            return Ok(new { message = $"ลบสูตร {f.Name} แล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "ลบสูตรไม่สำเร็จ"); }
    }

    #endregion

    #region === [ Workdays ] ===

    [HttpGet("workdays/customers")]
    public IActionResult WorkdayCustomers([FromQuery] int year)
    {
        if (!CanView) return Deny();
        try { return Ok(_svc.GetWorkdayCustomers(year).Select(c => new { c.Customer, c.YearDays, c.MonthsSet })); }
        catch (Exception ex) { return Fail(ex, "โหลดรายชื่อลูกค้าไม่สำเร็จ"); }
    }

    [HttpGet("workdays")]
    public IActionResult Workdays([FromQuery] string customer, [FromQuery] int year)
    {
        if (!CanView) return Deny();
        try { return Ok(_svc.GetWorkdays(customer ?? "", year).OrderBy(d => d).Select(d => d.ToString("yyyy-MM-dd", Inv))); }
        catch (Exception ex) { return Fail(ex, "โหลดวันทำงานไม่สำเร็จ"); }
    }

    public sealed record WorkdaySetRequest(string Customer, List<string> Dates, bool Working);

    // กดวันในปฏิทิน: ครั้งแรก = วันทำงาน / กดซ้ำ = ยกเลิก (บันทึกทันที)
    [HttpPost("workdays")]
    public IActionResult SetWorkdays([FromBody] WorkdaySetRequest req)
    {
        if (!CanEdit) return Deny();
        if (string.IsNullOrWhiteSpace(req.Customer)) return Fail("กรุณาเลือกลูกค้า");
        var list = (req.Dates ?? new()).Select(s => DateTime.TryParseExact(s, "yyyy-MM-dd", Inv, DateTimeStyles.None, out var d) ? d : (DateTime?)null)
                                      .Where(d => d.HasValue).Select(d => d.Value).ToList();
        if (list.Count == 0) return Ok(new { saved = DateTime.Now.ToString("HH:mm:ss", Inv) });
        try
        {
            _svc.SetWorkdays(req.Customer, list, req.Working, Uid);
            LogService.WriteLog(Uid, "WORKDAY_SET", $"Customer: {req.Customer} | {(req.Working ? "Working" : "Not working")}: " +
                (list.Count <= 3 ? string.Join(", ", list.Select(d => d.ToString("dd/MM/yyyy", Inv))) : $"{list.Count} days {list.Min().ToString("dd/MM/yyyy", Inv)} - {list.Max().ToString("dd/MM/yyyy", Inv)}"), req.Customer);
            return Ok(new { saved = DateTime.Now.ToString("HH:mm:ss", Inv) });
        }
        catch (Exception ex) { return Fail("บันทึกวันทำงานไม่สำเร็จ: " + ex.Message); }
    }

    [HttpGet("workdays/template")]
    public IActionResult WorkdayTemplate([FromQuery] int year, [FromQuery] string customer)
    {
        if (!CanEdit) return Deny();
        try
        {
            string c = string.IsNullOrWhiteSpace(customer) ? null : customer;
            string path = _svc.WriteWorkdayTemplate(year, c);
            LogService.WriteLog(Uid, "WORKDAY_TEMPLATE", $"Customer: {c ?? "ALL"} | Year: {year} | File: {Path.GetFileName(path)}", "");
            return Download(path);
        }
        catch (Exception ex) { return Fail(ex, "สร้างไฟล์ Template ไม่สำเร็จ (ปิดไฟล์ Excel เดิมก่อน)"); }
    }

    // วันทำงาน: นำเข้าเลย (แบบเดิมไม่มีหน้าต่างยืนยัน) - แทนที่ของเดิมรายเดือน-ลูกค้า
    [HttpPost("workdays/import")]
    [RequestSizeLimit(30_000_000)]
    public async Task<IActionResult> WorkdayImport(IFormFile file)
    {
        if (!CanEdit) return Deny();
        string path;
        try { path = await SaveUpload(file); } catch (Exception ex) { return Fail(ex.Message); }
        try
        {
            List<CalcImportRow> rows;
            try { rows = _svc.ReadWorkdayExcel(path); }
            catch (Exception ex) { return Fail("อ่านไฟล์ไม่สำเร็จ: " + ex.Message); }
            var valid = rows.Where(r => r.IsValid).ToList();
            int bad = rows.Count - valid.Count;
            if (valid.Count == 0) return Fail("ไม่พบวันทำงานที่นำเข้าได้ในไฟล์นี้" + (bad > 0 ? $" (ข้าม {bad} แถว)" : ""));
            var result = _svc.ApplyWorkdays(rows, Uid);
            LogService.WriteLog(Uid, "WORKDAY_IMPORT", $"Import workdays: {file.FileName} | Days: {result.Days} | Months: {result.Months} | Skipped rows: {bad}", "");
            return Ok(new { message = $"นำเข้าวันทำงาน {result.Days:N0} วัน ({result.Months:N0} เดือน-ลูกค้า) แทนที่ของเดิมแล้ว" + (bad > 0 ? $"\nข้ามแถวที่มีปัญหา {bad} แถว" : "") });
        }
        catch (Exception ex) { return Fail("นำเข้าวันทำงานไม่สำเร็จ: " + ex.Message); }
        finally { TryDelete(path); }
    }

    #endregion

    #region === [ Template / Import ] ===

    // 📄 TEMPLATE EXCEL: DAYS = สินค้าในตาราง (ตามคำค้นหา) + MAX / MIN (DAY) ปัจจุบัน / FORECAST = ข้อมูลเดือนนี้รายลูกค้า
    [HttpGet("template")]
    public IActionResult Template([FromQuery] int stk, [FromQuery] string kind, [FromQuery] string key)
    {
        if (!CanView) return Deny();
        var stock = FindStock(stk);
        if (stock == null) return Fail("ไม่พบคลังที่เลือก");
        bool days = kind != "FORECAST";
        try
        {
            string path = ImportTemplateService.NewPath(ImportTemplateService.Systems.MaxMinCalc,
                days ? $"{stock.Code}_Max-MinCal_Template" : "ForecastOrder_" + DateTime.Today.ToString("yyyy-MM", Inv) + "_Template");
            int count;
            if (days)
            {
                var (_, _, f) = Formula(stock.StkId);
                var rows = _svc.GetRows(stock, f, key ?? "");
                if (rows.Count == 0) return Fail($"ยังไม่มีสินค้าในตารางของคลัง {stock.Code} ให้สร้าง Template");
                count = rows.Count;
                _svc.ExportDays(rows, path);
            }
            else
            {
                var month = new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1);
                var rows = new ForecastOrderService().GetRows(month, "", 0, 1000000);
                count = rows.Count;
                new ImportTemplateService().CreateForecastTemplate(path, month, rows);
            }
            LogService.WriteLog(Uid, days ? "MAXMIN_TEMPLATE" : "FORECAST_TEMPLATE", $"Stock: {stock.Code} | Rows: {count} | File: {Path.GetFileName(path)}", stock.Code);
            return Download(path);
        }
        catch (IOException) { return Fail("บันทึกไฟล์ไม่สำเร็จ กรุณาปิดไฟล์ Excel ที่เปิดอยู่ก่อนแล้วลองใหม่"); }
        catch (Exception ex) { return Fail(ex, "สร้างไฟล์ Template ไม่สำเร็จ"); }
    }

    private static string ErrorList(List<CalcImportRow> bad) =>
        string.Join("\n", bad.Take(8).Select(r => $"• แถว {r.RowNumber}: {r.Error}")) + (bad.Count > 8 ? $"\n• ... และอีก {bad.Count - 8:N0} แถว" : "");

    private sealed record Pending(string Kind, int StkId, List<CalcImportRow> Rows, bool WithCalc, string Months, int Bad, int Auto);

    // 📥 Import 2 ขั้น: อ่านไฟล์ + สรุป (ยืนยัน) -> apply
    //   mode DAYS = IMPORT SET MAX MIN / CALC = IMPORT FORECAST + คำนวณ AUTO / ONLY = IMPORT FORECAST อย่างเดียว
    //   ไฟล์รูปแบบ Max-MinCal (DAYS / CALC) -> นำเข้าช่องที่มีข้อมูล (DAY / BOX / FORECAST)
    [HttpPost("import")]
    [RequestSizeLimit(30_000_000)]
    public async Task<IActionResult> ImportPreview(IFormFile file, [FromForm] int stk, [FromForm] string mode)
    {
        if (!CanEdit) return Deny();
        var stock = FindStock(stk);
        if (stock == null) return Fail("ไม่พบคลังที่เลือก");
        mode = mode is "CALC" or "ONLY" ? mode : "DAYS";
        string path;
        try { path = await SaveUpload(file); } catch (Exception ex) { return Fail(ex.Message); }
        try
        {
            var (_, _, f) = Formula(stock.StkId);
            if (mode != "ONLY")
            {
                List<CalcImportRow> trows;
                try { trows = _svc.ReadTemplateExcel(path, stock, _svc.GetRows(stock, f, "")); }
                catch (Exception ex) { TryDelete(path); return Fail("อ่านไฟล์ Excel ไม่สำเร็จ\n" + ex.Message); }
                if (trows != null)
                {
                    var tv = trows.Where(r => r.IsValid).ToList();
                    var tb = trows.Where(r => !r.IsValid).ToList();
                    if (tv.Count == 0)
                    {
                        TryDelete(path);
                        return Fail(tb.Count == 0 ? "ไม่มีข้อมูลให้นำเข้า\nกรอก MAX(DAY) / MIN(DAY) / MAX(BOX) / MIN(BOX) / FORECAST / ORDER / DELIVERY อย่างน้อย 1 ช่อง"
                                                  : "ไม่พบรายการที่นำเข้าได้ในไฟล์นี้\n\n" + ErrorList(tb));
                    }
                    int d = tv.Count(v => v.HasDays), b = tv.Count(v => v.HasBox), fc = tv.Count(v => v.HasForecast);
                    string what = string.Join("\n", new[]
                    {
                        d > 0 ? $"• MAX / MIN (DAY)  {d:N0} รายการ" : null,
                        b > 0 ? $"• MAX / MIN (BOX)  {b:N0} รายการ" : null,
                        fc > 0 ? $"• FORECAST / ORDER / DELIVERY (เดือน {DateTime.Today.ToString("MMM yyyy", Inv)})  {fc:N0} รายการ" : null
                    }.Where(s => s != null));
                    string sum = $"ไฟล์: {file.FileName}\nคลัง: {stock.Code}\n\n{what}" +
                                 (tb.Count > 0 ? $"\n\n⚠ ข้ามแถวที่มีปัญหา {tb.Count:N0} แถว:\n{ErrorList(tb)}" : "") + "\n\nยืนยันการนำเข้าหรือไม่?";
                    return Ok(new { id = _uploads.Put(path, file.FileName, Uid, "maxmin", new Pending("TEMPLATE", stock.StkId, trows, true, "", tb.Count, 0)), summary = sum, title = "IMPORT MAX-MINCAL" });
                }
            }

            List<CalcImportRow> rows;
            try { rows = mode == "DAYS" ? _svc.ReadDaysExcel(path, stock, _svc.GetRows(stock, f, "")) : _svc.ReadForecastExcel(path); }
            catch (Exception ex) { TryDelete(path); return Fail("อ่านไฟล์ Excel ไม่สำเร็จ\n" + ex.Message); }
            var valid = rows.Where(r => r.IsValid).ToList();
            var bad = rows.Where(r => !r.IsValid).ToList();
            if (valid.Count == 0) { TryDelete(path); return Fail("ไม่พบรายการที่นำเข้าได้ในไฟล์นี้\n\n" + ErrorList(bad)); }

            if (mode == "DAYS")
            {
                string sum = $"ไฟล์: {file.FileName}\nคลัง: {stock.Code}\n\nตั้ง MAX / MIN (DAYS) {valid.Count:N0} รายการ" +
                             (bad.Count > 0 ? $"\n\n⚠ ข้ามแถวที่มีปัญหา {bad.Count:N0} แถว:\n{ErrorList(bad)}" : "") + "\n\nยืนยันการนำเข้าหรือไม่?";
                return Ok(new { id = _uploads.Put(path, file.FileName, Uid, "maxmin", new Pending("DAYS", stock.StkId, rows, false, "", bad.Count, 0)), summary = sum, title = "IMPORT SET MAX MIN" });
            }

            bool withCalc = mode == "CALC";
            var months = string.Join(", ", valid.Select(v => v.Month).Distinct().OrderBy(m => m).Select(m => m.ToString("MMM yyyy", Inv)));
            int auto = valid.Count(v => !string.IsNullOrEmpty(v.Note));
            string summary = $"ไฟล์: {file.FileName}\n\nนำเข้า {valid.Count:N0} แถว  (เดือน: {months})\n" +
                             $"Forecast {valid.Sum(v => v.Forecast):N0}  •  Order {valid.Sum(v => v.Order):N0}  •  Delivery {valid.Sum(v => v.Delivery):N0}\n" +
                             "ลูกค้า/สินค้า/เดือนเดียวกันที่เคยนำเข้าจะถูกแทนที่" +
                             (withCalc ? "\n\nแล้วคำนวณ MAX / MIN ของคลังที่เปิด AUTO CALC" : "\n\nนำเข้าอย่างเดียว ไม่คำนวณ MAX / MIN") +
                             "\n\nℹ ตรวจสอบด้วย PART A · CUSTOMER / PART NO / ชื่อสินค้า ใช้ข้อมูลในระบบ" +
                             (auto > 0 ? $"\n⚠ CUSTOMER ในไฟล์ไม่ตรงกับระบบ {auto:N0} แถว (ใช้ของระบบ)" : "") +
                             (bad.Count > 0 ? $"\n\n⚠ ข้ามแถวที่มีปัญหา {bad.Count:N0} แถว:\n{ErrorList(bad)}" : "") + "\n\nยืนยันการนำเข้าหรือไม่?";
            return Ok(new
            {
                id = _uploads.Put(path, file.FileName, Uid, "maxmin", new Pending("FORECAST", stock.StkId, rows, withCalc, months, bad.Count, auto)),
                summary, title = withCalc ? "IMPORT + คำนวณ MAX / MIN AUTO" : "IMPORT อย่างเดียว"
            });
        }
        catch (Exception ex) { TryDelete(path); return Fail(ex, "อ่านไฟล์ Excel ไม่สำเร็จ"); }
    }

    [HttpPost("import/apply")]
    public IActionResult ImportApply([FromBody] string id)
    {
        if (!CanEdit) return Deny();
        var it = _uploads.Get(id, Uid, "maxmin");
        if (it == null) return Fail("ไฟล์หมดเวลาแล้ว กรุณาเลือกไฟล์ใหม่");
        var p = (Pending)it.State;
        var stock = FindStock(p.StkId);
        if (stock == null) return Fail("ไม่พบคลังที่เลือก");
        try
        {
            string message;
            if (p.Kind == "DAYS")
            {
                int n = _svc.ApplyDays(stock, p.Rows, Uid);
                LogService.WriteLog(Uid, "MAXMIN_DAYS_IMPORT", $"Stock: {stock.Code} | File: {it.FileName} | Items: {n} | Skipped rows: {p.Bad}", stock.Code);
                message = $"ตั้ง MAX / MIN (DAYS) แล้ว {n:N0} รายการ";
            }
            else if (p.Kind == "TEMPLATE")
            {
                var r = _svc.ApplyTemplate(stock, p.Rows, Uid);
                LogService.WriteLog(Uid, "MAXMIN_TEMPLATE_IMPORT", $"Stock: {stock.Code} | File: {it.FileName} | Days: {r.Days} | Box: {r.Box} | Forecast: {r.Forecast} | Skipped rows: {p.Bad}", stock.Code);
                message = $"นำเข้าแล้ว  •  DAY {r.Days:N0}  •  BOX {r.Box:N0}  •  FORECAST {r.Forecast:N0}";
                if (r.Forecast > 0) message += "\n" + CalcResult(_svc.Calculate(null, null, Uid), "Auto calculate after Max-MinCal import", stock.Code);
            }
            else
            {
                int n = _svc.ApplyForecast(p.Rows, Uid);
                LogService.WriteLog(Uid, "FORECAST_IMPORT", $"File: {it.FileName} | Rows: {n} | Months: {p.Months} | Skipped rows: {p.Bad}" +
                                                       (p.WithCalc ? "" : $" | Import only (no MAX / MIN calculate) | Customer differs from system: {p.Auto}"), "");
                message = p.WithCalc
                    ? $"นำเข้า Forecast / Order / Delivery แล้ว {n:N0} แถว\n" + CalcResult(_svc.Calculate(null, null, Uid), "Auto calculate after forecast import", stock.Code)
                    : $"นำเข้า Forecast / Order / Delivery แล้ว {n:N0} แถว (ไม่คำนวณ MAX / MIN)";
            }
            _uploads.Remove(id);
            return Ok(new { message });
        }
        catch (Exception ex) { return Fail(ex, "นำเข้าไม่สำเร็จ (ยกเลิกทั้งไฟล์)"); }
    }

    #endregion
}
