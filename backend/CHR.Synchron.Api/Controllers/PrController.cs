using CHR.Synchron.Api.Web;
using CIMS.Helpers;
using CIMS.Models;
using CIMS.Services;
using Microsoft.AspNetCore.Mvc;

namespace CHR.Synchron.Api.Controllers;

// 🧾 PR (SystemID PR) - PRView + PRViewModel + PRApproveWindow + PRApprovedWindow + PREditWindow
//   VIEW = เมนู + รายการ + APPROVED LIST / ADD = SUBMIT PR / EDIT = EDIT ใน APPROVED LIST / DEL = DEL ใน APPROVED LIST
//   APPROVE = APPROVE + REJECT + EXPORT / ลบ PR ทั้งหมดที่แสดง = Level 1
[Route("api/pr")]
public sealed class PrController : AppController
{
    private const string KeyPrStock = "PR.Stock";
    private readonly PRService _svc = new();

    // ค่าเริ่มต้นเดิมเมื่อไม่ได้กรอก (PRViewModel)
    private const string FixedDept = "41304134-บำรุงรักษาแม่พิมพ์", FixedRemark = "ซ่อมแม่พิมพ์/ประตู2B", FixedTarget = "ชนนิกานต์";

    private static object Row(PRModel x) => new
    {
        x.ID, x.PRNumber, date = x.PR_DATE_Display, x.Requester, x.PartCode, x.PartName, x.QTY, x.Unit, x.Status, x.Remark, x.Department, x.TargetDept,
        x.UserID, appDate = x.AppDateDisplay, export = x.ExportDisplay, x.IsExported, x.StockID, x.StockCode, x.PartId, x.CoilNo, x.MotherCoil
    };

    [HttpGet("meta")]
    public IActionResult Meta()
    {
        if (Me?.CanViewPR != true) return Deny();
        var stocks = DbSchema.HasPrStock ? new StockService().GetPrStocks() : new List<StockModel>();
        string saved = UserSettings.Get(Uid, KeyPrStock, "");
        var pick = stocks.FirstOrDefault(s => s.StkId.ToString() == saved) ?? stocks.FirstOrDefault();
        return Ok(new
        {
            can = new { submit = Me.CanSubmitPR, edit = Me.CanEditPR, delete = Me.CanDeletePR, approve = Me.CanApprovePR, deleteAll = Me.UserLevel == 1 },
            hasPrStock = DbSchema.HasPrStock,
            stocks = stocks.Select(s => new { s.StkId, s.Code, s.Name, s.CountCoil }),
            selected = pick?.StkId,
            userName = Me.UserName,
            today = DateTime.Today.ToString("dd/MM/yyyy", System.Globalization.CultureInfo.InvariantCulture),
            noStockText = stocks.Count == 0 && DbSchema.HasPrStock
                ? "⚠ No stock keeps PR yet - ask the Admin to switch it on in User Management → SETUP → PR SETTINGS   " + ScannerSetupService.AdminContacts().Replace("\n", "   ")
                : null
        });
    }

    [HttpPost("stock")]
    public IActionResult SaveStock([FromBody] int stkId)
    {
        if (Me?.CanViewPR != true) return Deny();
        UserSettings.Set(Uid, KeyPrStock, stkId.ToString());
        return Ok();
    }

    [HttpGet]
    public IActionResult List([FromQuery] string key, [FromQuery] int? stkId)
    {
        if (Me?.CanViewPR != true) return Deny();
        var data = _svc.GetPRList(key ?? "", DbSchema.HasPrStock ? stkId ?? -1 : null);
        return Ok(new { signature = string.Join("|", data.Select(x => $"{x.PRNumber}:{x.Status}:{x.QTY}")), rows = data.Select(Row) });
    }

    [HttpGet("parts")]
    public IActionResult Parts([FromQuery] string key, [FromQuery] int? stkId)
    {
        if (Me?.CanViewPR != true) return Deny();
        if (string.IsNullOrWhiteSpace(key)) return Ok(Array.Empty<object>());
        return Ok(_svc.GetPartOptions(key.Trim(), stkId).Select(o => new { o.PartId, o.Code, o.Name, o.InStock }));
    }

    // ช่องที่พิมพ์เองได้ + แนะนำค่าที่เคยใช้ / DEPARTMENT = รายการแผนกที่ Admin ตั้งไว้ขึ้นก่อน
    [HttpGet("lookups")]
    public IActionResult Lookups([FromQuery] string field, [FromQuery] string text)
    {
        if (Me?.CanViewPR != true) return Deny();
        field = (field ?? "").ToUpperInvariant();
        if (field is not ("REQUESTER" or "DEPT" or "REMARK" or "TARGET")) return Ok(Array.Empty<string>());
        var used = _svc.GetLookupValues(field, text ?? "");
        if (field != "DEPT") return Ok(used);
        var set = new ScannerSetupService().GetDepartments().Where(d => string.IsNullOrWhiteSpace(text) || d.Contains(text.Trim(), StringComparison.OrdinalIgnoreCase)).ToList();
        return Ok(set.Concat(used.Where(u => !set.Contains(u, StringComparer.OrdinalIgnoreCase))).ToList());
    }

    public sealed record SubmitRequest(int? StkId, int PartId, string PartCode, int Qty, string Requester, string Dept, string Remark, string Target);

    [HttpPost]
    public IActionResult Submit([FromBody] SubmitRequest req)
    {
        if (Me?.CanSubmitPR != true) return Deny("คุณไม่มีสิทธิ์สร้างรายการ PR");
        if (DbSchema.HasPrStock && req.StkId == null) return Fail("กรุณาเลือกคลัง (STOCK) ก่อนครับ");
        var part = _svc.GetPartOptions(req.PartCode ?? "", req.StkId, 50).FirstOrDefault(o => o.PartId == req.PartId);
        if (part == null) return Fail("กรุณาเลือก Product Code ที่มีในระบบ (พิมพ์รหัสแล้วเลือกจากรายการ)");
        if (req.Qty <= 0) return Fail("กรุณาใส่ QTY เป็นตัวเลขมากกว่า 0");
        if (string.IsNullOrWhiteSpace(req.Requester) || string.IsNullOrWhiteSpace(req.Dept) || string.IsNullOrWhiteSpace(req.Target))
            return Fail("กรุณากรอก Requester, Department และ Target Dept ให้ครบถ้วน");
        string reqName = req.Requester.Trim(), dept = req.Dept.Trim(), remark = string.IsNullOrWhiteSpace(req.Remark) ? FixedRemark : req.Remark.Trim(), target = req.Target.Trim();
        try
        {
            string prNo = _svc.GetNextPRNo();
            bool ok = _svc.InsertPR(prNo, Uid, string.IsNullOrWhiteSpace(dept) ? FixedDept : dept, part.Name, req.Qty, remark, string.IsNullOrWhiteSpace(target) ? FixedTarget : target, reqName, part.PartId, req.StkId);
            if (!ok) return Fail("บันทึก PR ไม่สำเร็จ");
            _svc.SaveLookupValues(new Dictionary<string, string> { ["REQUESTER"] = reqName, ["DEPT"] = dept, ["REMARK"] = remark, ["TARGET"] = target });
            LogService.WriteLog(Uid, "CREATE_PR", $"Issued PR | NO: {prNo}", prNo);
            return Ok(new { prNo, message = "บันทึกสำเร็จ" });
        }
        catch (Exception ex) { return Fail(ex, "บันทึก PR ไม่สำเร็จ"); }
    }

    public sealed record ApproveRequest(int Qty, bool KeepRemainder);

    [HttpPost("{prNo}/approve")]
    public IActionResult Approve(string prNo, [FromBody] ApproveRequest req)
    {
        if (Me?.CanApprovePR != true) return Deny("คุณไม่มีสิทธิ์ในการอนุมัติรายการนี้");
        var item = _svc.GetPRList(prNo, null).FirstOrDefault(x => x.PRNumber == prNo);
        if (item == null) return NotFound(new { message = "ไม่พบ PR" });
        if (req.Qty <= 0 || req.Qty > item.QTY) return Fail($"กรุณากรอกยอดที่อนุมัติ 1 - {item.QTY:N0}");
        bool keep = req.Qty < item.QTY && req.KeepRemainder;
        try
        {
            string newPr = _svc.ApprovePR(prNo, req.Qty, keep, Uid);
            string detail = req.Qty == item.QTY ? $"Approved PR No: {prNo} | QTY: {req.Qty}"
                          : $"Approved PR No: {prNo} | QTY: {item.QTY}->{req.Qty}" + (newPr != null ? $" | Remaining {item.QTY - req.Qty} -> new PR {newPr} (Waiting)" : $" | Remaining {item.QTY - req.Qty} not kept");
            LogService.WritePRLog(Uid, "APPROVE_PR", detail, prNo);
            return Ok(new { message = $"อนุมัติ {prNo} จำนวน {req.Qty:N0} แล้ว" + (newPr != null ? $"\nยอดที่เหลือ {item.QTY - req.Qty:N0} -> PR ใหม่ {newPr}" : "") });
        }
        catch (Exception ex) { return Fail(ex, "อนุมัติไม่สำเร็จ"); }
    }

    [HttpPost("{prNo}/reject")]
    public IActionResult Reject(string prNo)
    {
        if (Me?.CanApprovePR != true) return Deny("คุณไม่มีสิทธิ์ปฏิเสธรายการนี้");
        try
        {
            if (!_svc.UpdatePRStatus(prNo, "Rejected", Uid)) return Fail("Reject ไม่สำเร็จ");
            LogService.WritePRLog(Uid, "REJECT_PR", $"Rejected PR No: {prNo}", prNo);
            return Ok();
        }
        catch (Exception ex) { return Fail(ex, "Reject ไม่สำเร็จ"); }
    }

    public sealed record DeleteAllRequest(List<string> PrNos, string Key);

    [HttpPost("delete-all")]
    public IActionResult DeleteAll([FromBody] DeleteAllRequest req)
    {
        if (Me?.UserLevel != 1) return Deny("ลบทั้งหมดได้เฉพาะ Admin (Level 1)");
        var prs = (req.PrNos ?? new()).Where(n => !string.IsNullOrWhiteSpace(n)).Distinct().ToList();
        if (prs.Count == 0) return Fail("ไม่มี PR ในตารางให้ลบ");
        try
        {
            int n = _svc.DeletePRs(prs);
            string key = (req.Key ?? "").Trim();
            LogService.WritePRLog(Uid, "DELETE_ALL_PR", $"Deleted {n} PR{(key.Length > 0 ? $" (search: {key})" : "")}: {string.Join(", ", prs.Take(30))}{(prs.Count > 30 ? " ..." : "")}", "PR");
            return Ok(new { message = $"ลบ PR แล้ว {n:N0} รายการ" });
        }
        catch (Exception ex) { return Fail(ex, "ลบไม่สำเร็จ"); }
    }

    // ---------------------------------------------------------------- APPROVED LIST
    [HttpGet("approved")]
    public IActionResult Approved([FromQuery] string key, [FromQuery] DateTime? from, [FromQuery] DateTime? to, [FromQuery] int? stkId)
    {
        if (Me?.CanViewPR != true) return Deny();
        DateTime f = (from ?? new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1)).Date, t = (to ?? DateTime.Today).Date;
        if (t < f) (f, t) = (t, f);
        var list = _svc.GetApprovedList(key ?? "", f, t, stkId);
        var layouts = new StockService().GetPrExcelLayouts();
        var prStocks = DbSchema.HasPrStock ? new StockService().GetPrStocks() : new List<StockModel>();
        return Ok(new
        {
            rows = list.Select(Row),
            hasCoil = list.Any(x => !string.IsNullOrWhiteSpace(x.CoilNo)),
            exportStocks = prStocks.Select(s => new { s.StkId, s.Code, s.Name }),
            pathStocks = prStocks.Where(s => layouts.TryGetValue(s.StkId, out var l) && l.HasPath).Select(s => new
            {
                s.StkId, s.Code, s.Name,
                file = Path.GetFileName(CIMS.Core.Storage.MapExternal(layouts[s.StkId].Path)),
                fileFound = System.IO.File.Exists(CIMS.Core.Storage.MapExternal(layouts[s.StkId].Path)),
                fields = string.Join("  •  ", layouts[s.StkId].Entries.Select(x => $"{PRExcelFields.Label(x.Field)} = {x.Target}")),
                startRow = layouts[s.StkId].StartRow
            })
        });
    }

    public sealed record EditRequest(int Qty, string Dept, string Target, string Remark);

    [HttpPut("{prNo}")]
    public IActionResult Edit(string prNo, [FromBody] EditRequest req)
    {
        if (Me?.CanEditPR != true) return Deny();
        if (req.Qty <= 0) return Fail("จำนวนต้องมากกว่า 0");
        if (string.IsNullOrWhiteSpace(req.Dept)) return Fail("กรุณากรอก Department");
        var pr = _svc.GetApprovedList(prNo, new DateTime(2000, 1, 1), DateTime.Today.AddDays(1), null).FirstOrDefault(x => x.PRNumber == prNo);
        if (pr == null) return NotFound(new { message = "ไม่พบ PR" });
        string d = req.Dept.Trim(), t = (req.Target ?? "").Trim(), r = (req.Remark ?? "").Trim();
        try
        {
            _svc.UpdatePR(prNo, req.Qty, d, t, r);
            var changes = new List<string>();
            if (req.Qty != pr.QTY) changes.Add($"QTY: {pr.QTY}->{req.Qty}");
            if (d != (pr.Department ?? "")) changes.Add($"DEPT: {pr.Department}->{d}");
            if (t != (pr.TargetDept ?? "")) changes.Add($"TARGET: {pr.TargetDept}->{t}");
            if (r != (pr.Remark ?? "")) changes.Add($"REMARK: {pr.Remark}->{r}");
            LogService.WritePRLog(Uid, "EDIT_PR", $"Edited PR No: {prNo} | {(changes.Count == 0 ? "no change" : string.Join(", ", changes))}", prNo);
            return Ok(new { message = $"แก้ไข {prNo} แล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "แก้ไขไม่สำเร็จ"); }
    }

    [HttpDelete("{prNo}")]
    public IActionResult Delete(string prNo)
    {
        if (Me?.CanDeletePR != true) return Deny();
        var pr = _svc.GetApprovedList(prNo, new DateTime(2000, 1, 1), DateTime.Today.AddDays(1), null).FirstOrDefault(x => x.PRNumber == prNo);
        if (pr == null) return NotFound(new { message = "ไม่พบ PR" });
        try
        {
            _svc.DeletePR(prNo);
            LogService.WritePRLog(Uid, "DELETE_PR", $"Deleted approved PR No: {prNo} | {pr.PartName} | QTY: {pr.QTY}", prNo);
            return Ok(new { message = $"ลบ {prNo} แล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "ลบไม่สำเร็จ"); }
    }

    public sealed record ExportRequest(string Mode, List<string> PrNos, int? StkId, DateTime? From, DateTime? To);

    // 📤 EXPORT (ไฟล์ใหม่ -> ดาวน์โหลด) / 📥 EXPORT PATH (ต่อข้อมูลลงไฟล์ Excel ของคลังใน storage/excel ตามช่องที่ตั้งไว้)
    [HttpPost("export")]
    public IActionResult Export([FromBody] ExportRequest req)
    {
        if (Me?.CanApprovePR != true) return Deny("คุณไม่มีสิทธิ์ส่งออกข้อมูล");
        var wanted = new HashSet<string>(req.PrNos ?? new());
        if (wanted.Count == 0) return Fail("กรุณาติ๊กเลือกรายการที่ต้องการ Export ก่อนครับ");
        var all = _svc.GetApprovedList("", new DateTime(2000, 1, 1), DateTime.Today.AddDays(1), null).Where(x => wanted.Contains(x.PRNumber)).ToList();
        // รายการจากหน้าหลัก (ยังไม่อนุมัติ) = ใช้รายการ PR ทั้งหมด
        if (all.Count < wanted.Count) all = all.Concat(_svc.GetPRList("", null).Where(x => wanted.Contains(x.PRNumber) && all.All(a => a.PRNumber != x.PRNumber))).ToList();
        var stock = req.StkId.HasValue ? new StockService().GetStock(req.StkId.Value) : null;
        var items = stock == null ? all : all.Where(r => r.StockID == null || r.StockID == stock.StkId).ToList();
        if (items.Count == 0) return Fail($"ไม่มีรายการที่ติ๊กของคลัง {stock?.Code}");
        try
        {
            if (req.Mode == "PATH")
            {
                if (stock == null || !new StockService().GetPrExcelLayouts().TryGetValue(stock.StkId, out var layout) || !layout.HasPath)
                    return Fail("ยังไม่มีคลังที่ตั้งไฟล์ Excel\nตั้งได้ที่ User Management -> ⚙ SETUP -> EXCEL SETUP (Admin)");
                var rows = new ExportService().ExportPRToPath(items, layout);
                string file = Path.GetFileName(CIMS.Core.Storage.MapExternal(layout.Path));
                MarkExported(items, "EXPORT_PR_PATH", $"{stock.Code} -> {file}" + (rows.First > 0 ? $" rows {rows.First}-{rows.Last}" : ""));
                return Ok(new { message = $"ต่อข้อมูลลงไฟล์ {stock.Code} แล้ว {items.Count:N0} รายการ" + (rows.First > 0 ? $" (แถว {rows.First} - {rows.Last})" : ""), stkId = stock.StkId });
            }
            string path = new ExportService().ExportPRFile(items, stock?.Code);
            MarkExported(items, "EXPORT_PR", Path.GetFileName(path));
            return Download(path);
        }
        catch (Exception ex) { return Fail(ex, "Export ไม่สำเร็จ:"); }
    }

    private void MarkExported(IEnumerable<PRModel> items, string action, string target)
    {
        foreach (var item in items)
            if (_svc.UpdateAfterExport(item.PRNumber, Uid))
                LogService.WriteLog(Uid, action, $"Exported PR No: {item.PRNumber} | {target}", item.PRNumber);
    }

    // ไฟล์ Excel ของคลัง (EXPORT PATH) - ดาวน์โหลดไว้ตรวจ / อัปโหลด Template ของ CHR-Synchron
    [HttpGet("file/{stkId:int}")]
    public IActionResult File(int stkId)
    {
        if (Me?.CanViewPR != true) return Deny();
        if (!new StockService().GetPrExcelLayouts().TryGetValue(stkId, out var l) || !l.HasPath) return NotFound();
        string path = CIMS.Core.Storage.MapExternal(l.Path);
        return System.IO.File.Exists(path) ? Download(path) : NotFound(new { message = "ยังไม่มีไฟล์ใน CHR-Synchron - กด UPLOAD FILE ก่อน" });
    }

    [HttpPost("file/{stkId:int}")]
    [RequestSizeLimit(30_000_000)]
    public async Task<IActionResult> Upload(int stkId, IFormFile file)
    {
        if (Me?.CanApprovePR != true) return Deny();
        if (!new StockService().GetPrExcelLayouts().TryGetValue(stkId, out var l) || !l.HasPath) return Fail("คลังนี้ยังไม่ได้ตั้งไฟล์ Excel");
        if (file == null || !file.FileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase)) return Fail("กรุณาเลือกไฟล์ Excel (.xlsx)");
        string path = CIMS.Core.Storage.MapExternal(l.Path);
        await using (var fs = System.IO.File.Create(path)) await file.CopyToAsync(fs);
        return Ok(new { name = Path.GetFileName(path) });
    }
}
