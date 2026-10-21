using System.Globalization;
using CHR.Synchron.Api.Web;
using CIMS.Core;
using CIMS.Models;
using CIMS.Services;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;

namespace CHR.Synchron.Api.Controllers;

// 📈 FORECAST / ORDER / DELIVERY (SystemID ForecastOrder) - ForecastOrderView
//   VIEW = เมนู + ดู + Export / ADD = Import (+ Template) - Import ตรวจด้วย PART A / เลือก IMPORT + คำนวณ MAX / MIN AUTO หรือ IMPORT อย่างเดียว
[Route("api/forecast")]
public sealed class ForecastController : AppController
{
    private readonly ForecastOrderService _svc = new();
    private readonly UploadCache _uploads;
    public ForecastController(UploadCache uploads) => _uploads = uploads;

    private static string Mon(DateTime m) => m.ToString("yyyy-MM", CultureInfo.InvariantCulture);

    [HttpGet("months")]
    public IActionResult Months()
    {
        if (Me?.CanViewForecastOrder != true) return Deny();
        var months = _svc.GetMonths();
        return Ok(new
        {
            canImport = Me.CanImportForecastOrder,
            months = months.Select(m => new { key = Mon(m), label = m.ToString("MMM yyyy", CultureInfo.InvariantCulture).ToUpperInvariant() }),
            latest = Mon(months.Count > 0 ? months.Max() : new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1))
        });
    }

    private static DateTime? ParseMonth(string m) =>
        DateTime.TryParseExact(m ?? "", "yyyy-MM", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;

    // กราฟทั้งปี (ปีของเดือนที่เลือก / ALL = ปีล่าสุด) + TOP 5 ORDER
    [HttpGet("top")]
    public IActionResult Top([FromQuery] string month)
    {
        if (Me?.CanViewForecastOrder != true) return Deny();
        var m = ParseMonth(month);
        var months = _svc.GetMonths();
        int year = (m ?? (months.Count > 0 ? months.Max() : DateTime.Today)).Year;
        var data = _svc.GetYear(year);
        var top = _svc.GetTop5(m);
        return Ok(new
        {
            year,
            months = Enumerable.Range(1, 12).Select(i =>
            {
                var r = data.FirstOrDefault(x => x.Month == i);
                return new { label = new DateTime(2000, i, 1).ToString("MMM", CultureInfo.InvariantCulture), forecast = r?.Forecast ?? 0, order = r?.Order ?? 0, delivery = r?.Delivery ?? 0 };
            }),
            top = top.Select(t => new { t.Rank, t.Title, t.Sub, t.Order, t.Forecast, t.Percent, t.ShareOfMonth })
        });
    }

    [HttpGet("rows")]
    public IActionResult Rows([FromQuery] string month, [FromQuery] string key, [FromQuery] int skip = 0, [FromQuery] int take = 50)
    {
        if (Me?.CanViewForecastOrder != true) return Deny();
        var rows = _svc.GetRows(ParseMonth(month), key ?? "", Math.Max(0, skip), Math.Clamp(take, 1, 500));
        return Ok(rows.Select(r => new { r.Customer, r.PartA, r.PartNo, r.ProductName, r.Forecast, r.Order, r.Delivery, month = r.MonthText }));
    }

    // ⚡ เรียลไทม์: เครื่องอื่น Import -> หน้าโหลดใหม่เอง
    [HttpGet("token")]
    public IActionResult Token()
    {
        if (Me?.CanViewForecastOrder != true) return Deny();
        using var conn = new SqlConnection(GlobalConfig.ConnStr);
        var a = conn.QueryFirst<string>("SELECT CONCAT(MAX(ImportID), '|', COUNT_BIG(*), '|', CHECKSUM_AGG(BINARY_CHECKSUM(*))) FROM CIMS.ForecastOrderImports");
        var b = conn.QueryFirst<string>("SELECT CONCAT(COUNT(*), '|', CHECKSUM_AGG(BINARY_CHECKSUM(*))) FROM CIMS.CustomerWorkdays");
        return Ok(new { token = a + "#" + b });
    }

    public sealed record ExportRequest(List<string> Months, string Key);

    // 📤 Export: 1 เดือน = 1 ชีท (ตามคำค้นหา)
    [HttpPost("export")]
    public IActionResult Export([FromBody] ExportRequest req)
    {
        if (Me?.CanViewForecastOrder != true) return Deny();
        var months = (req.Months ?? new()).Select(ParseMonth).Where(m => m.HasValue).Select(m => m.Value).Distinct().OrderBy(m => m).ToList();
        if (months.Count == 0) return Fail("ยังไม่มีข้อมูล Forecast / Order / Delivery ให้ Export");
        try
        {
            string path = _svc.Export(months, req.Key ?? "", out int count);
            LogService.WriteLog(Uid, "FORECAST_EXPORT", $"Months: {string.Join(", ", months.Select(Mon))} | Sheets: {months.Count} | Rows: {count} | File: {Path.GetFileName(path)}", "");
            return Download(path);
        }
        catch (Exception ex) { return Fail(ex, "Export ไม่สำเร็จ"); }
    }

    [HttpGet("template")]
    public IActionResult Template([FromQuery] string month)
    {
        if (Me?.CanImportForecastOrder != true) return Deny();
        var m = ParseMonth(month) ?? new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1);
        try
        {
            string path = ImportTemplateService.NewPath(ImportTemplateService.Systems.Forecast, "ForecastOrder_" + Mon(m) + "_Template");
            var rows = _svc.GetRows(m, "", 0, 1000000);
            new ImportTemplateService().CreateForecastTemplate(path, m, rows);
            LogService.WriteLog(Uid, "FORECAST_TEMPLATE", $"Month: {Mon(m)} | Rows: {rows.Count} | File: {Path.GetFileName(path)}", "");
            return Download(path);
        }
        catch (Exception ex) { return Fail(ex, "สร้างไฟล์ Template ไม่สำเร็จ"); }
    }

    [HttpGet("import/choice")]
    public IActionResult Choice() => Ok(new
    {
        title = MaxMinCalcService.ImportChoiceTitle, text = MaxMinCalcService.ImportChoiceText,
        calc = MaxMinCalcService.ImportChoiceCalc, only = MaxMinCalcService.ImportChoiceOnly
    });

    [HttpPost("import")]
    [RequestSizeLimit(30_000_000)]
    public async Task<IActionResult> ImportPreview(IFormFile file, [FromForm] bool withCalc)
    {
        if (Me?.CanImportForecastOrder != true) return Deny();
        string path;
        try { path = await SaveUpload(file); } catch (Exception ex) { return Fail(ex.Message); }
        try
        {
            var rows = new MaxMinCalcService().ReadForecastExcel(path);
            var valid = rows.Where(r => r.IsValid).ToList();
            var bad = rows.Where(r => !r.IsValid).ToList();
            string errs = string.Join("\n", bad.Take(8).Select(r => $"• แถว {r.RowNumber}: {r.Error}")) + (bad.Count > 8 ? $"\n• ... และอีก {bad.Count - 8:N0} แถว" : "");
            if (valid.Count == 0) { TryDelete(path); return Fail("ไม่พบรายการที่นำเข้าได้ในไฟล์นี้\n\n" + errs); }
            var months = valid.Select(v => v.Month).Distinct().OrderBy(m => m).ToList();
            int auto = valid.Count(v => !string.IsNullOrEmpty(v.Note));
            string monthText = string.Join(", ", months.Select(m => m.ToString("MMM yyyy", CultureInfo.InvariantCulture)));
            string summary = $"ไฟล์: {file.FileName}\n\nนำเข้า {valid.Count:N0} แถว  (เดือน: {monthText})\n" +
                             $"Forecast {valid.Sum(v => v.Forecast):N0}  •  Order {valid.Sum(v => v.Order):N0}  •  Delivery {valid.Sum(v => v.Delivery):N0}\n" +
                             "ลูกค้า / สินค้า / เดือนเดียวกันที่เคยนำเข้าจะถูกแทนที่" +
                             (withCalc ? "\n\nแล้วคำนวณ MAX / MIN ของคลังที่เปิด AUTO CALC" : "\n\nนำเข้าอย่างเดียว ไม่คำนวณ MAX / MIN") +
                             "\n\nℹ ตรวจสอบด้วย PART A · CUSTOMER / PART NO / ชื่อสินค้า ใช้ข้อมูลในระบบ" +
                             (auto > 0 ? $"\n⚠ CUSTOMER ในไฟล์ไม่ตรงกับระบบ {auto:N0} แถว (ใช้ของระบบ)" : "") +
                             (bad.Count > 0 ? $"\n\n⚠ ข้ามแถวที่มีปัญหา {bad.Count:N0} แถว:\n{errs}" : "") + "\n\nยืนยันการนำเข้าหรือไม่?";
            return Ok(new { id = _uploads.Put(path, file.FileName, Uid, "forecast", (rows, withCalc, monthText, bad.Count, auto, Mon(months.Last()))), summary });
        }
        catch (Exception ex) { TryDelete(path); return Fail(ex, "อ่านไฟล์ Excel ไม่สำเร็จ"); }
    }

    [HttpPost("import/apply")]
    public IActionResult ImportApply([FromBody] string id)
    {
        if (Me?.CanImportForecastOrder != true) return Deny();
        var it = _uploads.Get(id, Uid, "forecast");
        if (it == null) return Fail("ไฟล์หมดเวลาแล้ว กรุณาเลือกไฟล์ใหม่");
        var (rows, withCalc, monthText, bad, auto, last) = ((List<CalcImportRow>, bool, string, int, int, string))it.State;
        try
        {
            var calc = new MaxMinCalcService();
            int n = calc.ApplyForecast(rows, Uid);
            LogService.WriteLog(Uid, "FORECAST_IMPORT", $"File: {it.FileName} | Rows: {n} | Months: {monthText} | Skipped rows: {bad}" +
                                                   (withCalc ? "" : $" | Import only (no MAX / MIN calculate) | Customer differs from system: {auto}"), "");
            _uploads.Remove(id);
            if (!withCalc) return Ok(new { message = $"นำเข้าแล้ว {n:N0} แถว (ไม่คำนวณ MAX / MIN)", month = last });
            var r = calc.Calculate(null, null, Uid);
            if (r.Stocks > 0)
                LogService.WriteLog(Uid, "MAXMIN_CALCULATE", $"Auto calculate after forecast import | Stocks: {r.Stocks} | Updated: {r.Updated} | Skipped (no order): {r.Skipped}", "");
            return Ok(new { message = $"นำเข้าแล้ว {n:N0} แถว" + (r.Stocks > 0 ? $"\nคำนวณ MAX / MIN อัตโนมัติ {r.Updated:N0} รายการ" : ""), month = last });
        }
        catch (Exception ex) { return Fail(ex, "นำเข้าไม่สำเร็จ (ยกเลิกทั้งไฟล์)"); }
    }
}
