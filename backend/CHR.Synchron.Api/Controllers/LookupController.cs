using CHR.Synchron.Api.Web;
using CIMS.Core;
using CIMS.Services;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;

namespace CHR.Synchron.Api.Controllers;

// 🔎 ค้นหาข้อมูลกลาง (เลือกสินค้า / รายชื่อคลัง / ผู้ติดต่อ Admin) - ใช้ได้ทุกหน้าที่ Login แล้ว
[Route("api/lookup")]
public sealed class LookupController : AppController
{
    // สินค้าในระบบ: ตรงเป๊ะก่อน > ขึ้นต้นด้วย > มีอยู่ข้างใน (PRODUCT CODE / ชื่อ / PART A / QR CODE) - stkId = เฉพาะสินค้าที่อยู่คลังนั้น
    [HttpGet("parts")]
    public IActionResult Parts([FromQuery] string key, [FromQuery] int? stkId, [FromQuery] int top = 20)
    {
        string k = (key ?? "").Trim();
        if (k.Length == 0) return Ok(Array.Empty<object>());
        using var conn = new SqlConnection(GlobalConfig.ConnStr);
        var rows = conn.Query(@"
            SELECT TOP (@top) p.PartID AS partId, p.PartCode AS partCode, p.Description AS partName, ISNULL(p.PartA, '') AS partA,
                   ISNULL(p.Category, '') AS category, p.PackSize AS packSize
            FROM CIMS.Parts p WITH (NOLOCK)
            WHERE p.IsActive = 1
              AND (p.PartCode LIKE '%' + @k + '%' OR p.Description LIKE '%' + @k + '%' OR ISNULL(p.PartA, '') LIKE '%' + @k + '%' OR ISNULL(p.QRCode, '') LIKE '%' + @k + '%')
              AND (@stk IS NULL OR EXISTS (SELECT 1 FROM CIMS.PartStocks ps WHERE ps.PartID = p.PartID AND ps.StockID = @stk)
                   OR (ISNULL(p.IsShowInMaster, 0) = 1 AND EXISTS (SELECT 1 FROM CIMS.Stocks s WHERE s.StockID = @stk AND s.IsMain = 1)))
            ORDER BY CASE WHEN p.PartCode = @k THEN 0 WHEN p.PartCode LIKE @k + '%' THEN 1 WHEN p.Description LIKE @k + '%' THEN 2 ELSE 3 END, p.PartCode",
            new { k, stk = stkId, top = Math.Clamp(top, 1, 100) });
        return Ok(rows);
    }

    // ☎ ผู้ติดต่อ Admin (แสดงในข้อความ "กรุณาติดต่อ Admin")
    [HttpGet("contacts")]
    public IActionResult Contacts() => Ok(new { text = ScannerSetupService.ContactText(new ScannerSetupService().GetAdminContacts()) });
}
