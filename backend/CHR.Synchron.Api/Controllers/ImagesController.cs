using CIMS.Core;
using CIMS.Helpers;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Data.SqlClient;

namespace CHR.Synchron.Api.Controllers;

// 🖼 รูปสินค้าจาก Shared Folder (\\192.168.10.56\ProgramCHR\...) - Server อ่านไฟล์แล้วส่งให้ Browser
//    ลำดับเดียวกับ ScanInViewModel.LoadProductImage: ImageFileName ของสินค้า -> ไม่มี = รูปเก่าชื่อ Product Code (.png / .jpg)
[ApiController]
[Authorize]
[Route("api/images")]
public sealed class ImagesController : ControllerBase
{
    private static readonly FileExtensionContentTypeProvider Types = new();

    [HttpGet("part/{partId:int}")]
    [ResponseCache(Duration = 300, Location = ResponseCacheLocation.Client)]
    public IActionResult Part(int partId)
    {
        string imgPath = null, code = null;
        using (var conn = new SqlConnection(GlobalConfig.ConnStr))
        using (var cmd = new SqlCommand("SELECT ImageFileName, PartCode FROM CIMS.Parts WHERE PartID = @p", conn))
        {
            cmd.Parameters.AddWithValue("@p", partId);
            conn.Open();
            using var r = cmd.ExecuteReader();
            if (r.Read()) { imgPath = ImagePaths.Resolve(r[0] as string); code = r[1] as string; }
        }
        if (!ImageCacheHelper.Exists(imgPath) && !string.IsNullOrWhiteSpace(code))
        {
            string png = Path.Combine(ImagePaths.LegacyRoot, $"{code}.png"), jpg = Path.Combine(ImagePaths.LegacyRoot, $"{code}.jpg");
            imgPath = ImageCacheHelper.Exists(png) ? png : ImageCacheHelper.Exists(jpg) ? jpg : null;
        }
        return Send(imgPath);
    }

    // ImageFileName ตามที่เก็บในฐานข้อมูล (เช่น "STOCK-MAT\STOCK-MAT-01.png" / "STOREPC:xxx.jpg") - อ่านได้เฉพาะใต้โฟลเดอร์รูปที่กำหนด
    [HttpGet("file")]
    [ResponseCache(Duration = 300, Location = ResponseCacheLocation.Client)]
    public IActionResult ByName([FromQuery] string name)
    {
        string path = ImagePaths.Resolve(name);
        if (path == null) return NotFound();
        string full = Path.GetFullPath(path);
        bool allowed = new[] { ImagePaths.StockRoot, ImagePaths.LegacyRoot, ImagePaths.StorePcRoot }
            .Any(root => full.StartsWith(Path.GetFullPath(root).TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase));
        return allowed ? Send(full) : NotFound();
    }

    private IActionResult Send(string path)
    {
        if (!ImageCacheHelper.Exists(path)) return NotFound();
        if (!Types.TryGetContentType(path, out var type) || !type.StartsWith("image/")) return NotFound();
        return PhysicalFile(path, type);
    }
}
