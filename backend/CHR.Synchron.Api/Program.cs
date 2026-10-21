using CHR.Synchron.Api.Web;
using CHR.Synchron.Api.Web.Auth;
using CIMS.Core;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

// 🔒 ค่าจริง (Connection string / JWT key) ไม่ขึ้น GitHub:
//    dotnet user-secrets (เครื่อง Dev) หรือ appsettings.Local.json / Environment Variables (Server)
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: false);

// 🔒 แยกจากระบบที่ใช้งานจริงเด็ดขาด: ใช้ได้เฉพาะฐาน CHR-Synchron / ห้าม ERP 192.168.10.10 / ไฟล์อยู่ใน storage ของตัวเอง
string mainConn = builder.Configuration.GetConnectionString("Main");
string erpConn = builder.Configuration.GetConnectionString("Erp");
if (erpConn != null && erpConn.Contains('<')) erpConn = "";   // ค่าตัวอย่าง (<ERP-SERVER>) = ไม่เปิด ERP
var mainDb = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(mainConn ?? "");
if (!string.Equals(mainDb.InitialCatalog, "CHR-Synchron", StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException($"ConnectionStrings:Main ต้องเป็นฐาน CHR-Synchron เท่านั้น (ตอนนี้: \"{mainDb.InitialCatalog}\") - ห้ามต่อฐาน CIMS / ระบบที่ใช้งานจริง");
if (!string.IsNullOrWhiteSpace(erpConn))
{
    var erpDb = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(erpConn);
    if (erpDb.DataSource.Contains("192.168.10.10") || string.Equals(erpDb.InitialCatalog, "CHR", StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException("ห้ามเชื่อม ERP ของระบบที่ใช้งานจริง (192.168.10.10 / ฐาน CHR) - ลบ ConnectionStrings:Erp ออก");
}
GlobalConfig.Init(mainConn, erpConn);
Storage.Init(builder.Configuration["Storage:Root"] ?? Path.Combine(builder.Environment.ContentRootPath, "..", "..", "storage"));

var jwt = builder.Configuration.GetSection("Jwt").Get<JwtOptions>() ?? new JwtOptions();
if (string.IsNullOrWhiteSpace(jwt.Key) || jwt.Key.Length < 32)
    throw new InvalidOperationException("Jwt:Key ต้องยาวอย่างน้อย 32 ตัวอักษร (ตั้งใน user-secrets / appsettings.Local.json)");
builder.Services.AddSingleton(jwt);
builder.Services.AddSingleton<JwtTokens>();
builder.Services.AddSingleton<CHR.Synchron.Api.Web.UploadCache>();

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.MapInboundClaims = false;
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidIssuer = jwt.Issuer, ValidAudience = jwt.Issuer, IssuerSigningKey = JwtTokens.KeyOf(jwt),
            NameClaimType = System.Security.Claims.ClaimTypes.NameIdentifier
        };
        // Token อยู่ใน Cookie HttpOnly (JavaScript อ่านไม่ได้)
        o.Events = new JwtBearerEvents
        {
            OnMessageReceived = ctx => { ctx.Token ??= ctx.Request.Cookies[jwt.CookieName]; return Task.CompletedTask; }
        };
    });
builder.Services.AddAuthorization();
builder.Services.AddMemoryCache();
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUser, CurrentUser>();
builder.Services.AddControllers();
builder.Services.AddResponseCaching();
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins(builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? new[] { "http://localhost:3000" })
    .AllowAnyHeader().AllowAnyMethod().AllowCredentials()));

var app = builder.Build();

app.UseMiddleware<ClientContextMiddleware>();
app.UseCors();
app.UseResponseCaching();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapGet("/api/health", () => Results.Ok(new { ok = true, time = DateTime.Now }));

app.Run();
