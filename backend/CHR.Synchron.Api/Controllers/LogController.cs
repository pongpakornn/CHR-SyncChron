using CHR.Synchron.Api.Web.Auth;
using CIMS.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CHR.Synchron.Api.Controllers;

// 🕘 Activity Log: เปิดหน้าไหน (MainView.NavigateToPage -> OPEN_PAGE)
[ApiController]
[Authorize]
[Route("api/log")]
public sealed class LogController : ControllerBase
{
    private readonly ICurrentUser _me;
    public LogController(ICurrentUser me) => _me = me;

    public sealed record PageRequest(string Title, string Stock);

    [HttpPost("page")]
    public IActionResult Page([FromBody] PageRequest req)
    {
        if (_me.Session == null || string.IsNullOrWhiteSpace(req?.Title)) return Ok();
        string title = req.Title.Trim().ToUpperInvariant();
        if (title.Length > 100) title = title[..100];
        string detail = string.IsNullOrWhiteSpace(req.Stock) ? title : $"{title} | Stock: {req.Stock.Trim()}";
        LogService.WriteLog(_me.UserId, "OPEN_PAGE", detail, "");
        return Ok();
    }
}
