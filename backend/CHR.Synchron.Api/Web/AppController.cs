using CHR.Synchron.Api.Web.Auth;
using CIMS.Models;
using CIMS.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CHR.Synchron.Api.Web;

// ฐานของทุก Controller: ผู้ใช้ของ Request (UserSession เดียวกับ WPF) + คำตอบมาตรฐาน
[ApiController]
[Authorize]
public abstract class AppController : ControllerBase
{
    private UserSession _session;
    private bool _loaded;

    protected UserSession Me
    {
        get
        {
            if (!_loaded) { _session = HttpContext.RequestServices.GetRequiredService<ICurrentUser>().Session; _loaded = true; }
            return _session;
        }
    }

    protected string Uid => Me?.UserId;

    // ไม่มีสิทธิ์ = 403 + ข้อความไทย (หน้าเว็บซ่อนปุ่มอยู่แล้ว แต่ API ตรวจซ้ำเสมอ)
    protected IActionResult Deny(string message = "คุณไม่มีสิทธิ์ใช้งานส่วนนี้ กรุณาติดต่อ Admin") =>
        StatusCode(403, new { message = ScannerSetupService.WithContacts(message) });

    protected IActionResult Fail(string message) => BadRequest(new { message });

    // ข้อผิดพลาดที่พบบ่อยเป็นข้อความไทยแบบเดิม
    protected IActionResult Fail(Exception ex, string prefix = null)
    {
        string msg = ex.Message.Contains("being used") || ex is IOException && ex.Message.Contains("process")
            ? "ไฟล์ Excel ถูกเปิดค้างอยู่ กรุณาปิดไฟล์ก่อนแล้วลองใหม่"
            : ex.Message;
        return BadRequest(new { message = string.IsNullOrEmpty(prefix) ? msg : prefix + "\n" + msg });
    }

    protected IActionResult Download(string path, string contentType = null)
    {
        var bytes = System.IO.File.ReadAllBytes(path);
        contentType ??= Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".pdf" => "application/pdf",
            ".csv" => "text/csv",
            _ => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        };
        return File(bytes, contentType, Path.GetFileName(path));
    }

    // ไฟล์ Excel ที่อัปโหลด -> เก็บชั่วคราวที่ Server (ตัวอ่าน Excel เดิมรับเป็น path)
    protected static async Task<string> SaveUpload(IFormFile file)
    {
        if (file == null || file.Length == 0) throw new InvalidOperationException("กรุณาเลือกไฟล์ Excel");
        string ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (ext != ".xlsx" && ext != ".xlsm") throw new InvalidOperationException("รองรับเฉพาะไฟล์ Excel (.xlsx)");
        string dir = Path.Combine(Path.GetTempPath(), "CHR-Synchron-Upload");
        Directory.CreateDirectory(dir);
        string path = Path.Combine(dir, $"{Guid.NewGuid():N}_{Path.GetFileName(file.FileName)}");
        await using var fs = System.IO.File.Create(path);
        await file.CopyToAsync(fs);
        return path;
    }

    protected static void TryDelete(string path)
    {
        try { if (!string.IsNullOrEmpty(path)) System.IO.File.Delete(path); } catch { }
    }
}
