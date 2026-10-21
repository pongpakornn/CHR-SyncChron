using System.Globalization;
using CHR.Synchron.Api.Web;
using CIMS.Core;
using CIMS.Services;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;

namespace CHR.Synchron.Api.Controllers;

// 🕘 ACTIVITY LOG (SystemID ACTIVITYLOG: VIEW) - ActivityLogView: 1 หน้า = 50 รายการ / ตัวกรองผู้ใช้ / ประเภท / วันที่ / Export
[Route("api/activity")]
public sealed class ActivityLogController : AppController
{
    private readonly ActivityLogService _svc = new();

    private static ActivityLogFilter Filter(string key, DateTime? from, DateTime? to, string user, string action)
    {
        DateTime f = (from ?? DateTime.Today).Date, t = (to ?? DateTime.Today).Date;
        if (t < f) (f, t) = (t, f);
        return new ActivityLogFilter { Keyword = key ?? "", From = f, To = t, UserId = string.IsNullOrWhiteSpace(user) ? null : user, Action = string.IsNullOrWhiteSpace(action) ? null : action };
    }

    [HttpGet("lookups")]
    public IActionResult Lookups()
    {
        if (Me?.CanViewActivityLog != true) return Deny();
        var (users, actions) = _svc.GetLookups();
        return Ok(new { users = users.Select(u => new { id = u.Id, name = u.Name }), actions });
    }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string key, [FromQuery] DateTime? from, [FromQuery] DateTime? to, [FromQuery] string user, [FromQuery] string action,
                                          [FromQuery] int page, CancellationToken ct)
    {
        if (Me?.CanViewActivityLog != true) return Deny();
        var (rows, total) = await _svc.QueryAsync(Filter(key, from, to, user, action), Math.Max(0, page), ct);
        return Ok(new
        {
            total, page, pageSize = ActivityLogService.PageSize,
            rows = rows.Select(r => new { date = r.DateText, user = r.UserText, r.Action, r.Detail, r.RefCode, r.Computer })
        });
    }

    // ⚡ เรียลไทม์: Log ใหม่ (MAX LogID + จำนวน) - เปลี่ยน = หน้าแรกโหลดใหม่
    [HttpGet("token")]
    public IActionResult Token()
    {
        if (Me?.CanViewActivityLog != true) return Deny();
        using var conn = new SqlConnection(GlobalConfig.ConnStr);
        var t = conn.QueryFirst<(long? Max, long Count)>("SELECT CAST(MAX(LogID) AS bigint), COUNT_BIG(*) FROM CIMS.SystemLogs");
        return Ok(new { token = $"{t.Max}|{t.Count}" });
    }

    [HttpGet("export")]
    public IActionResult Export([FromQuery] string key, [FromQuery] DateTime? from, [FromQuery] DateTime? to, [FromQuery] string user, [FromQuery] string action)
    {
        if (Me?.CanViewActivityLog != true) return Deny();
        var f = Filter(key, from, to, user, action);
        try
        {
            string path = ImportTemplateService.NewPath(ImportTemplateService.Systems.ActivityLog, "ActivityLog");
            int n = _svc.Export(f, path);
            LogService.WriteLog(Uid, "ACTIVITY_LOG_EXPORT", $"Rows: {n} | {f.From.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)} - {f.To.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)} | Key: {f.Keyword} | File: {Path.GetFileName(path)}", "");
            return Download(path);
        }
        catch (Exception ex) { return Fail(ex, "Export ไม่สำเร็จ"); }
    }
}
