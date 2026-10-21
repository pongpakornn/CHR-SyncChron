using System.Security.Claims;
using CIMS.Core;
using CIMS.Models;
using CIMS.Services;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Caching.Memory;

namespace CHR.Synchron.Api.Web.Auth;

// 👤 ผู้ใช้ของ Request นี้ - เวอร์ชัน WPF เก็บไว้ที่ GlobalConfig.CurrentUser ตอน Login
//    เว็บอ่าน UserID จาก Token แล้วโหลด UserSession (Level / Master Admin / Permissions) จาก CIMS.Users + CIMS.Permissions
//    เก็บไว้ 15 วินาที -> Admin เปลี่ยนสิทธิ์แล้วมีผลเกือบทันที ไม่ต้อง Login ใหม่
public interface ICurrentUser
{
    UserSession Session { get; }
    string UserId { get; }
}

public sealed class CurrentUser : ICurrentUser
{
    private readonly IHttpContextAccessor _http;
    private readonly IMemoryCache _cache;
    private UserSession _session;

    public CurrentUser(IHttpContextAccessor http, IMemoryCache cache)
    {
        _http = http;
        _cache = cache;
    }

    public string UserId => _http.HttpContext?.User.FindFirstValue(ClaimTypes.NameIdentifier);

    public UserSession Session => _session ??= Load();

    private UserSession Load()
    {
        string uid = UserId;
        if (string.IsNullOrEmpty(uid)) return null;
        return _cache.GetOrCreate("session:" + uid.ToUpperInvariant(), e =>
        {
            e.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(15);
            return LoadSession(uid);
        });
    }

    public static void Forget(IMemoryCache cache, string userId) => cache.Remove("session:" + (userId ?? "").ToUpperInvariant());

    // เหมือน AuthService.Authenticate (ไม่เช็กรหัสผ่าน) - บัญชีที่ถูกล็อก = ไม่มี Session
    public static UserSession LoadSession(string userId)
    {
        using var conn = new SqlConnection(GlobalConfig.ConnStr);
        conn.Open();
        UserSession s = null;
        using (var cmd = new SqlCommand(@"SELECT UserID, FullName, UserLevel, IsMasterAdmin, Department
                                          FROM CIMS.Users WHERE UserID = @u AND ISNULL(IsLocked, 0) = 0", conn))
        {
            cmd.Parameters.AddWithValue("@u", userId);
            using var r = cmd.ExecuteReader();
            if (r.Read())
                s = new UserSession
                {
                    UserId = r["UserID"].ToString(),
                    UserName = r["FullName"].ToString(),
                    UserLevel = r["UserLevel"] == DBNull.Value ? 3 : Convert.ToInt32(r["UserLevel"]),
                    IsMasterAdmin = r["IsMasterAdmin"] != DBNull.Value && Convert.ToBoolean(r["IsMasterAdmin"]),
                    Department = r["Department"]?.ToString() ?? ""
                };
        }
        if (s != null) s.Permissions = new AuthService().GetUserPermissions(s.UserId, conn);
        return s;
    }
}
