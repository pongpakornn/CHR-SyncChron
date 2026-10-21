using System.Text;
using CHR.Synchron.Api.Web;
using CHR.Synchron.Api.Web.Scanner;
using CIMS.Helpers;
using CIMS.Services;
using Microsoft.AspNetCore.Mvc;

namespace CHR.Synchron.Api.Controllers;

// ✔ DEDUCTED / ⚠ NOT DEDUCTED (DeductMissWindow + NotDeductedRegisterWindow) และ ✏️ ADJUST SCAN (ScanAdjustWindow)
[Route("api/scanner")]
public sealed class ScannerActionsController : AppController
{
    private ScannerScope Scope() => new(Me, null);

    // ---------------------------------------------------------------- DEDUCTED / NOT DEDUCTED
    private static object Row(DeductMissRow r) => new
    {
        r.MissId, r.TxId, date = r.DateText, r.CoilNo, r.MotherCoil, r.PartId, partCode = r.PartCodeText, partName = r.PartNameText, r.HasProduct,
        r.StockId, r.SourceStockId, r.StockCode, r.SourceCode, r.LabelQty, r.Deducted, r.Reason, reasonText = r.ReasonText, r.Status, statusText = r.StatusText,
        r.IsPending, r.UserId, r.Barcode, r.MotherNow, motherNowText = r.MotherNowText, r.SourcePartCode, r.SourcePartName, r.SourceAfter, r.How,
        r.MotherBefore, r.MotherAfter, r.FormatId
    };

    [HttpGet("deduct")]
    public IActionResult DeductList([FromQuery] bool deducted, [FromQuery] string key, [FromQuery] DateTime? from, [FromQuery] DateTime? to)
    {
        if (Me?.CanViewScannerMenu != true) return Deny();
        var sc = Scope();
        DateTime f = (from ?? (deducted ? DateTime.Today : DateTime.Today.AddDays(-60))).Date, t = (to ?? DateTime.Today).Date;
        if (t < f) (f, t) = (t, f);
        var svc = new DeductMissService();
        var rows = deducted ? svc.GetDeducted(key ?? "", f, t, sc.DeductStockIds) : svc.GetRows(key ?? "", f, t, sc.DeductStockIds);
        return Ok(new { canAct = !deducted && Me.CanApproveScan && DbSchema.HasMissStatus, rows = rows.Select(Row) });
    }

    public sealed record ExportRequest(bool Deducted, string Key, DateTime? From, DateTime? To, List<int> Ids);

    [HttpPost("deduct/export")]
    public IActionResult DeductExport([FromBody] ExportRequest req)
    {
        if (Me?.CanViewScannerMenu != true) return Deny();
        var sc = Scope();
        DateTime f = (req.From ?? DateTime.Today).Date, t = (req.To ?? DateTime.Today).Date;
        if (t < f) (f, t) = (t, f);
        var svc = new DeductMissService();
        var rows = req.Deducted ? svc.GetDeducted(req.Key ?? "", f, t, sc.DeductStockIds) : svc.GetRows(req.Key ?? "", f, t, sc.DeductStockIds);
        // ติ๊กไว้ = เฉพาะที่ติ๊ก / ไม่ได้ติ๊ก = ทุกแถวที่แสดงอยู่
        if (req.Ids?.Count > 0) rows = rows.Where(r => req.Ids.Contains(r.MissId)).ToList();
        if (rows.Count == 0) return Fail("ไม่มีรายการให้ Export");
        try
        {
            string path = req.Deducted ? svc.ExportDeducted(rows) : svc.Export(rows);
            LogService.WriteLog(Uid, req.Deducted ? "EXPORT_DEDUCTED" : "EXPORT_NOT_DEDUCTED", $"Exported {rows.Count} {(req.Deducted ? "deducted" : "not-deducted")} labels", req.Deducted ? "DEDUCTED" : "NOT_DEDUCTED");
            return Download(path);
        }
        catch (Exception ex) { return Fail(ex, "Export ไม่สำเร็จ:"); }
    }

    // รายการเดียวจาก NOT DEDUCTED (เฉพาะคลังที่ผู้ใช้เห็น)
    private DeductMissRow FindMiss(int missId) =>
        new DeductMissService().GetRows("", new DateTime(2000, 1, 1), DateTime.Today, Scope().DeductStockIds).FirstOrDefault(r => r.MissId == missId);

    private bool CanAct => Me?.CanApproveScan == true && DbSchema.HasMissStatus;

    [HttpPost("deduct/{missId:int}/approve")]
    public IActionResult Approve(int missId)
    {
        if (!CanAct) return Deny("ต้องมีสิทธิ์ APPROVE ของ Multi-Scanner");
        var r = FindMiss(missId);
        if (r == null) return NotFound(new { message = "ไม่พบรายการ (อาจถูกดำเนินการไปแล้ว)" });
        if (!r.HasProduct) return Fail("ยังไม่มี PD CODE ของป้ายนี้ในระบบ\nกด ＋ PRODUCT เพื่อลงทะเบียนสินค้าก่อน");
        var res = new DeductMissService().Receive(r, r.PartId.Value, r.LabelQty, Uid, "APPROVED");
        if (!res.Ok) return Fail(res.Message);
        var d = res.Deduct;
        return Ok(new
        {
            message = $"{r.PartCode}  {r.LabelQtyText} → {r.StockCode}\n" +
                      (d.Deducted > 0 ? $"ตัด {d.SourceCode} {Qty.Plain(d.Deducted)} ({d.SourcePartCode} เหลือ {Qty.Plain(d.SourceAfter)})" : $"ยังไม่ได้ตัด {r.SourceCode}") + "\nย้ายไปที่ DEDUCTED แล้ว"
        });
    }

    [HttpDelete("deduct/{missId:int}")]
    public IActionResult DeleteMiss(int missId)
    {
        if (!CanAct) return Deny("ต้องมีสิทธิ์ APPROVE ของ Multi-Scanner");
        var r = FindMiss(missId);
        if (r == null) return NotFound(new { message = "ไม่พบรายการ (อาจถูกดำเนินการไปแล้ว)" });
        var res = new DeductMissService().Delete(r, Uid);
        return res.Ok ? Ok(new { message = $"ลบแล้ว  Coil {r.CoilNo}" }) : Fail(res.Message);
    }

    // ＋ PRODUCT: ลงทะเบียน / เลือกสินค้าที่มีแล้ว -> รับเข้าตามป้าย (MAX / MIN / STOCK COIL / STOCK ไม่บังคับ)
    public sealed record RegisterRequest(int PartId, string MasterCoil, string CoilNo, decimal? Max, decimal? Min, decimal? CoilCount, decimal? Qty);

    [HttpPost("deduct/{missId:int}/register")]
    public IActionResult Register(int missId, [FromBody] RegisterRequest req)
    {
        if (!CanAct) return Deny("ต้องมีสิทธิ์ APPROVE ของ Multi-Scanner");
        var r = FindMiss(missId);
        if (r == null) return NotFound(new { message = "ไม่พบรายการ (อาจถูกดำเนินการไปแล้ว)" });
        if (r.Status == "RECEIVED") return Fail($"รายการเดิมนี้รับเข้า {r.StockCode} ไปแล้ว (มี PD CODE แล้ว)\nใช้ ✔ APPROVE เพื่อตัด {r.SourceCode} ตามหลัง");
        if (req.PartId <= 0) return Fail("ไม่พบสินค้าในระบบ");
        if (new[] { req.Max, req.Min, req.CoilCount, req.Qty }.Any(v => v < 0)) return Fail("MAX / MIN / STOCK ต้องเป็นตัวเลข (เว้นว่างได้)");
        if (!string.IsNullOrWhiteSpace(req.CoilNo)) r.CoilNo = req.CoilNo.Trim();
        if (!string.IsNullOrWhiteSpace(req.MasterCoil)) r.MotherCoil = req.MasterCoil.Trim();
        var stock = new StockService().GetStocks().FirstOrDefault(s => s.StkId == r.StockId);
        decimal qty = Qty.Round(req.Qty ?? r.LabelQty, stock?.AllowDecimal ?? true);
        if (qty <= 0) return Fail("จำนวนที่รับเข้าต้องมากกว่า 0");
        var svc = new DeductMissService();
        var res = svc.Receive(r, req.PartId, qty, Uid, "REGISTERED");
        if (!res.Ok) return Fail(res.Message);
        if (req.Max.HasValue || req.Min.HasValue || (req.CoilCount.HasValue && req.CoilCount.Value != 1))
            svc.ApplyStockSetting(r.StockId, req.PartId, req.Max, req.Min, req.CoilCount.HasValue ? Math.Max(0, (int)req.CoilCount.Value - 1) : null, Uid);
        var d = res.Deduct;
        return Ok(new
        {
            message = $"รับเข้า {r.StockCode} แล้ว  {Qty.Plain(qty)}\n" +
                      (d != null && d.Deducted > 0 ? $"ตัด {d.SourceCode} {Qty.Plain(d.Deducted)} ({d.SourcePartCode} เหลือ {Qty.Plain(d.SourceAfter)})" : $"ยังไม่ได้ตัด {r.SourceCode} (ไม่มี Master Coil)") +
                      "\n\nรายการย้ายไปที่ DEDUCTED แล้ว"
        });
    }

    // ---------------------------------------------------------------- ✏️ ADJUST SCAN (DEL ของ Multi-Scanner)
    [HttpGet("adjust")]
    public IActionResult AdjustList([FromQuery] string key, [FromQuery] DateTime? from, [FromQuery] DateTime? to, [FromQuery] int? stkId, [FromQuery] string type)
    {
        if (Me?.CanDeleteScan != true) return Deny();
        var sc = Scope();
        DateTime f = (from ?? DateTime.Today.AddDays(-7)).Date, t = (to ?? DateTime.Today).Date;
        if (t < f) (f, t) = (t, f);
        var stock = stkId.HasValue ? sc.Stocks.FirstOrDefault(s => s.StkId == stkId.Value) : null;
        var rows = new ScanAdjustService().GetRows(key ?? "", f, t, stock?.StkId, stock?.IsMain ?? false, string.IsNullOrWhiteSpace(type) ? null : type);
        return Ok(new
        {
            stocks = sc.Stocks.Select(s => new { s.StkId, s.Code, s.Name }),
            rows = rows.Select(r => new
            {
                r.TxId, date = r.DateText, r.StockCode, r.TxType, r.PartCode, r.PartName, r.Qty, r.AllowDecimal, user = r.UserText,
                r.IsCancel, r.CanSelect, status = r.StatusText, note = r.AdjNote, pr = r.PrText
            })
        });
    }

    // แถวของรายการสแกน (ค้นเฉพาะวันของรายการนั้น - GetRows คืนสูงสุด 500 แถวล่าสุด)
    private static ScanAdjustRow FindScan(int txId)
    {
        using var conn = new Microsoft.Data.SqlClient.SqlConnection(CIMS.Core.GlobalConfig.ConnStr);
        using var cmd = new Microsoft.Data.SqlClient.SqlCommand("SELECT TransactionDate FROM CIMS.ScanTransactions WHERE TransactionID = @t", conn);
        cmd.Parameters.AddWithValue("@t", txId);
        conn.Open();
        if (cmd.ExecuteScalar() is not DateTime d) return null;
        return new ScanAdjustService().GetRows("", d.Date, d.Date, null, false, null).FirstOrDefault(r => r.TxId == txId);
    }

    public sealed record EditQtyRequest(decimal Qty, string Reason);

    [HttpPost("adjust/{txId:int}/qty")]
    public IActionResult EditQty(int txId, [FromBody] EditQtyRequest req)
    {
        if (Me?.CanDeleteScan != true) return Deny();
        if (string.IsNullOrWhiteSpace(req?.Reason)) return Fail("กรุณาระบุหมายเหตุ / สาเหตุที่แก้ไข Stock ก่อนยืนยัน");
        var row = FindScan(txId);
        if (row == null || !row.CanSelect) return NotFound(new { message = "ไม่พบรายการสแกน (หรือถูกลบไปแล้ว)" });
        if (req.Qty == row.Qty) return Fail("จำนวนใหม่เท่ากับจำนวนเดิม");
        try
        {
            string reason = req.Reason.Trim();
            var res = new ScanAdjustService().EditQty(txId, req.Qty, reason, Uid);
            LogService.WriteLog(Uid, "SCAN_ADJUST",
                $"Edit scan #{row.TxId} {row.TxType} {row.StockCode} {row.PartCode}: {row.QtyText} -> {Qty.Plain(req.Qty)} | Balance: {Qty.Plain(res.BalanceAfter)} | Reason: {reason}", row.TxId.ToString());
            var msg = new StringBuilder($"แก้ไขจำนวนเรียบร้อย\nยอดคงเหลือ {res.StockCode} : {Qty.Plain(res.BalanceAfter)}");
            if (!string.IsNullOrEmpty(res.PrNo)) msg.Append($"\n\n⚠ รายการนี้มี PR {res.PrNo} ({res.PrStatus}) ผู้มีสิทธิ์ PR ต้องแก้ไขจำนวนใน PR เอง");
            return Ok(new { message = msg.ToString(), warn = !string.IsNullOrEmpty(res.PrNo) });
        }
        catch (Exception ex) { return Fail(ex, "แก้ไขไม่สำเร็จ (ยอด Stock ไม่ถูกเปลี่ยน)"); }
    }

    public sealed record CancelRequest(List<int> TxIds, string Reason);

    [HttpPost("adjust/cancel")]
    public IActionResult Cancel([FromBody] CancelRequest req)
    {
        if (Me?.CanDeleteScan != true) return Deny();
        if (req?.TxIds == null || req.TxIds.Count == 0) return Fail("กรุณาติ๊กเลือกรายการที่ต้องการลบ");
        if (string.IsNullOrWhiteSpace(req.Reason)) return Fail("กรุณาระบุหมายเหตุ / สาเหตุที่แก้ไข Stock ก่อนยืนยัน");
        string reason = req.Reason.Trim();
        var svc = new ScanAdjustService();
        var all = req.TxIds.Distinct().Select(FindScan).Where(r => r != null && r.CanSelect).ToList();
        var ok = new List<ScanAdjustResult>();
        var fails = new List<string>();
        foreach (var row in all)
        {
            try
            {
                var res = svc.CancelScan(row.TxId, reason, Uid);
                ok.Add(res);
                LogService.WriteLog(Uid, "SCAN_ADJUST",
                    $"Delete scan #{row.TxId} {row.TxType} {row.StockCode} {row.PartCode} x{row.Qty} | Balance: {res.BalanceAfter}{(res.SourceNote != null ? " | " + res.SourceNote : "")} | Reason: {reason}", row.TxId.ToString());
            }
            catch (Exception ex) { fails.Add($"• {row.PartCode} ({row.TxType} {row.StockCode}): {ex.Message}"); }
        }
        var msg = new StringBuilder($"ลบรายการสแกนแล้ว {ok.Count:N0} รายการ ยอด Stock ปรับย้อนกลับเรียบร้อย");
        var src = ok.Where(r => r.SourceNote != null).Select(r => r.SourceNote).ToList();
        if (src.Count > 0) msg.Append("\n" + string.Join("\n", src));
        var prs = ok.Where(r => !string.IsNullOrEmpty(r.PrNo)).Select(r => $"{r.PrNo} ({r.PrStatus})").ToList();
        if (prs.Count > 0) msg.Append($"\n\n⚠ มี PR ที่สร้างจากการสแกนออกนี้: {string.Join(", ", prs)}\nผู้มีสิทธิ์ PR ต้องไป Reject / แก้ไขเองที่หน้า PR");
        if (fails.Count > 0) msg.Append($"\n\n❌ ลบไม่ได้ {fails.Count:N0} รายการ:\n" + string.Join("\n", fails));
        return Ok(new { message = msg.ToString(), level = fails.Count > 0 && ok.Count == 0 ? "error" : fails.Count > 0 || prs.Count > 0 ? "warn" : "ok" });
    }
}
