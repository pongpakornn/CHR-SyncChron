using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace CHR.Synchron.Api.Web.Auth;

public sealed class JwtOptions
{
    public string Key { get; set; } = "";
    public string Issuer { get; set; } = "CHR-Synchron";
    public int Hours { get; set; } = 12;
    public string CookieName { get; set; } = "chr_token";
}

public sealed class JwtTokens
{
    private readonly JwtOptions _opt;
    public JwtTokens(JwtOptions opt) => _opt = opt;

    public static SymmetricSecurityKey KeyOf(JwtOptions o) => new(Encoding.UTF8.GetBytes(o.Key));

    public string Create(string userId, string device)
    {
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, userId),
            new Claim("device", device ?? "")
        };
        var token = new JwtSecurityToken(_opt.Issuer, _opt.Issuer, claims,
            expires: DateTime.UtcNow.AddHours(_opt.Hours),
            signingCredentials: new SigningCredentials(KeyOf(_opt), SecurityAlgorithms.HmacSha256));
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
