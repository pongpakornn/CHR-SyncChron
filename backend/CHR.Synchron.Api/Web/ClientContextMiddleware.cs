using System.Text.RegularExpressions;
using CIMS.Core;

namespace CHR.Synchron.Api.Web;

// 🖥 ตั้ง ClientContext.Machine ของ Request นี้ = ชื่อเครื่องที่ Browser ส่งมา (X-Client-Device) หรือ WEB-<IP>
//    CIMS.Users.LastSession / CIMS.SystemLogs.ComputerName ยาวได้ 50 ตัวอักษร
public sealed class ClientContextMiddleware
{
    private static readonly Regex Unsafe = new(@"[^A-Za-z0-9_.\-]", RegexOptions.Compiled);
    private readonly RequestDelegate _next;
    public ClientContextMiddleware(RequestDelegate next) => _next = next;

    public Task Invoke(HttpContext ctx)
    {
        string device = Unsafe.Replace(ctx.Request.Headers["X-Client-Device"].ToString().Trim(), "");
        if (device.Length == 0) device = "WEB-" + (ctx.Connection.RemoteIpAddress?.MapToIPv4().ToString() ?? "UNKNOWN");
        ClientContext.Machine = device.Length > 50 ? device[..50] : device;
        return _next(ctx);
    }
}
