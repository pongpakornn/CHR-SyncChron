using CHR.Synchron.Api.Web.Auth;
using CIMS.Models;
using CIMS.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;

namespace CHR.Synchron.Api.Controllers;

// 🔐 Login / Logout - เงื่อนไขเดิมของ LoginView + AuthService:
//    บัญชีที่ Online อยู่เครื่องอื่น = เข้าไม่ได้ (เครื่องเดิม Bypass ได้) / ล็อกแล้ว = เข้าไม่ได้ / Login = IsOnline 1 + LastLogin + LastSession
[ApiController]
[Route("api/auth")]
public sealed class AuthController : ControllerBase
{
    private readonly JwtTokens _tokens;
    private readonly JwtOptions _opt;
    private readonly ICurrentUser _me;
    private readonly IMemoryCache _cache;

    public AuthController(JwtTokens tokens, JwtOptions opt, ICurrentUser me, IMemoryCache cache)
    {
        _tokens = tokens; _opt = opt; _me = me; _cache = cache;
    }

    public sealed record LoginRequest(string UserId, string Password);

    [AllowAnonymous]
    [HttpPost("login")]
    public IActionResult Login([FromBody] LoginRequest req)
    {
        if (string.IsNullOrWhiteSpace(req?.UserId) || string.IsNullOrEmpty(req.Password))
            return BadRequest(new { message = "กรุณาระบุชื่อผู้ใช้และรหัสผ่าน" });

        var auth = new AuthService();
        UserSession session;
        try { session = auth.Authenticate(req.UserId.Trim(), req.Password); }
        catch (Exception ex) { return Conflict(new { message = ex.Message }); }   // Online อยู่เครื่องอื่น
        if (session == null)
        {
            return Unauthorized(new { message = "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
        }

        auth.UpdateLoginStats(session.UserId);
        LogService.WriteLog(session.UserId, "LOGIN", "เข้าสู่ระบบสำเร็จ", CIMS.Core.ClientContext.Machine);
        CurrentUser.Forget(_cache, session.UserId);

        Response.Cookies.Append(_opt.CookieName, _tokens.Create(session.UserId, CIMS.Core.ClientContext.Machine), new CookieOptions
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Lax,
            Secure = Request.IsHttps,
            Expires = DateTimeOffset.UtcNow.AddHours(_opt.Hours)
        });
        return Ok(MeDto.From(session));
    }

    [Authorize]
    [HttpPost("logout")]
    public IActionResult Logout()
    {
        string uid = _me.UserId;
        if (!string.IsNullOrEmpty(uid))
        {
            new AuthService().UpdateLogoutStatus(uid);
            LogService.WriteLog(uid, "LOGOUT", "ออกจากระบบสำเร็จ", "");
            CurrentUser.Forget(_cache, uid);
        }
        Response.Cookies.Delete(_opt.CookieName);
        return Ok();
    }

    [Authorize]
    [HttpGet("me")]
    public IActionResult Me()
    {
        var s = _me.Session;
        if (s == null) { Response.Cookies.Delete(_opt.CookieName); return Unauthorized(); }
        return Ok(MeDto.From(s));
    }
}
