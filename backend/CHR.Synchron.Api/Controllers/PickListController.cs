using CHR.Synchron.Api.Web;
using CIMS.Core;
using CIMS.Models;
using CIMS.Services;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;

namespace CHR.Synchron.Api.Controllers;

// 📦 PICK LIST (SystemID PackingCard: VIEW) - PackingCardView
//   🔒 CHR-Synchron ไม่เชื่อม ERP ของระบบจริง (192.168.10.10): รายการมาจากประวัติการพิมพ์ใน CHR-Synchron (CIMS.PickListPrintLogs)
//   ซึ่งเก็บข้อมูลการ์ดครบ (BILL / ITEM / GROUP / PD CODE / WORK ORDER / LOT / JOB / QTY / วันที่) -> ดู / พิมพ์ซ้ำ / Export ได้
//   ตั้ง ConnectionStrings:Erp (ฐานทดสอบที่อนุญาตเท่านั้น) = ดึงรายการใหม่จาก ERP แบบเดิม
[Route("api/picklist")]
public sealed class PickListController : AppController
{
    public sealed class Card
    {
        public string TicketNo { get; set; }
        public string ItemNo { get; set; }
        public string GroupCode { get; set; }
        public string MaterialCode { get; set; }
        public string WorkOrder { get; set; }
        public string LotNo { get; set; }
        public string JobName { get; set; }
        public decimal Qty { get; set; }
        public DateTime? TicketDate { get; set; }
        public string ProductName { get; set; }
        public string Unit { get; set; }
        public string FgName { get; set; }
        public string PrintedBy { get; set; }
        public DateTime? PrintedDate { get; set; }
        public int PrintCount { get; set; }
        public string LastPrintedBy { get; set; }
        public DateTime? LastPrintedDate { get; set; }
    }

    private static bool ErpOn => !string.IsNullOrWhiteSpace(GlobalConfig.ErpConnStr);

    [HttpGet]
    public IActionResult List([FromQuery] DateTime? from, [FromQuery] DateTime? to)
    {
        if (Me?.CanViewPackingCard != true) return Deny();
        DateTime f = (from ?? DateTime.Today).Date, t = (to ?? DateTime.Today).Date;
        if (t < f) (f, t) = (t, f);
        if (f < DateTime.Today.AddMonths(-PackingCardErpService.HistoryMonths)) f = DateTime.Today.AddMonths(-PackingCardErpService.HistoryMonths);
        if (ErpOn)
        {
            var list = new PackingCardErpService().GetHistory(f, t);
            return Ok(new
            {
                source = "ERP",
                rows = list.Select(x => new Card
                {
                    TicketNo = x.TicketNo, ItemNo = x.ItemNo, GroupCode = x.GroupCode, MaterialCode = x.MaterialCode, WorkOrder = x.WorkOrder, LotNo = x.LotNo,
                    JobName = x.JobName, Qty = x.Qty, TicketDate = x.TicketDate == DateTime.MinValue ? null : x.TicketDate, ProductName = x.ProductName, Unit = x.Unit,
                    FgName = x.FgName, PrintedBy = x.PrintedBy, PrintedDate = x.PrintedDate, PrintCount = x.PrintCount, LastPrintedBy = x.LastPrintedBy, LastPrintedDate = x.LastPrintedDate
                })
            });
        }
        using var conn = new SqlConnection(GlobalConfig.ConnStr);
        var rows = conn.Query<Card>(@"
            SELECT l.TicketNo, CAST(l.ItemNo AS varchar(10)) AS ItemNo, l.Warehouse AS GroupCode, l.MaterialCode, l.WorkOrder, l.LotNo, l.JobName,
                   l.Quantity AS Qty, CAST(l.TicketDate AS datetime) AS TicketDate, ISNULL(p.Description, '') AS ProductName, '' AS Unit, '' AS FgName,
                   l.PrintedBy, l.PrintedDate, ISNULL(l.PrintCount, 1) AS PrintCount, l.LastPrintedBy, l.LastPrintedDate
            FROM CIMS.PickListPrintLogs l
            OUTER APPLY (SELECT TOP 1 Description FROM CIMS.Parts WHERE PartCode = l.MaterialCode ORDER BY IsActive DESC, PartID DESC) p
            WHERE ISNULL(l.TicketDate, CAST(l.PrintedDate AS date)) BETWEEN @f AND @t
            ORDER BY l.Warehouse, l.TicketNo, l.ItemNo", new { f, t }).ToList();
        return Ok(new { source = "CHR-Synchron", rows });
    }

    private static PackingCardModel Model(Card c) => new()
    {
        TicketNo = c.TicketNo, ItemNo = c.ItemNo, GroupCode = c.GroupCode, MaterialCode = c.MaterialCode, WorkOrder = c.WorkOrder, LotNo = c.LotNo,
        JobName = c.JobName, Qty = c.Qty, TicketDate = c.TicketDate ?? DateTime.MinValue, ProductName = c.ProductName, Unit = c.Unit, FgName = c.FgName
    };

    // 🖨 พิมพ์แล้ว (พิมพ์จาก Browser) -> บันทึก CIMS.PickListPrintLogs: ครั้งแรก + นับพิมพ์ซ้ำ / คนพิมพ์ล่าสุด
    [HttpPost("printed")]
    public IActionResult Printed([FromBody] List<Card> items)
    {
        if (Me?.CanViewPackingCard != true) return Deny();
        if (items == null || items.Count == 0) return Fail("กรุณาเลือกรายการที่ต้องการพิมพ์");
        var svc = new PackingPrintLogService();
        var fails = new List<string>();
        foreach (var c in items)
        {
            try { svc.LogPrinted(Model(c), Uid); }
            catch (Exception ex) { fails.Add($"{c.TicketNo}/{c.ItemNo}: {ex.Message}"); }
        }
        LogService.WriteLog(Uid, "PRINT_PICKLIST", $"Printed {items.Count - fails.Count} card(s) | Bills: {string.Join(", ", items.Select(i => i.TicketNo).Distinct().Take(30))}", "");
        return Ok(new { saved = items.Count - fails.Count, fails });
    }

    [HttpPost("export")]
    public IActionResult Export([FromBody] List<Card> items)
    {
        if (Me?.CanViewPackingCard != true) return Deny();
        if (items == null || items.Count == 0) return Fail("กรุณาติ๊กเลือกรายการที่ต้องการ Export อย่างน้อย 1 รายการครับ");
        try
        {
            string path = ImportTemplateService.NewPath(ImportTemplateService.Systems.PickList, "PickList");
            string[] heads = { "NO", "BILL NO.", "ITEM NO", "GROUP", "PD CODE", "PRODUCT NAME", "QTY", "UNIT", "WORKORDER", "LOT", "PART NAME", "DATE", "PRINTED", "REPRINT" };
            using (var wb = new ClosedXML.Excel.XLWorkbook())
            {
                var ws = wb.AddWorksheet("PICK LIST");
                ImportTemplateService.Header(ws, heads, new double[] { 6.4, 16, 9, 10, 18, 40, 10, 8, 18, 10, 40, 13, 24, 24 });
                int r = 2;
                string Stamp(DateTime d) => d.ToString("dd/MM/yyyy HH:mm", System.Globalization.CultureInfo.InvariantCulture);
                foreach (var x in items)
                {
                    ws.Cell(r, 1).Value = r - 1;
                    ws.Cell(r, 2).Value = x.TicketNo ?? "";
                    ws.Cell(r, 3).Value = x.ItemNo ?? "";
                    ws.Cell(r, 4).Value = x.GroupCode ?? "";
                    ws.Cell(r, 5).Value = x.MaterialCode ?? "";
                    ws.Cell(r, 6).Value = x.ProductName ?? "";
                    ws.Cell(r, 7).Value = x.Qty; ws.Cell(r, 7).Style.NumberFormat.Format = "#,##0.##";
                    ws.Cell(r, 8).Value = x.Unit ?? "";
                    ws.Cell(r, 9).Value = x.WorkOrder ?? "";
                    ws.Cell(r, 10).Value = x.LotNo ?? "";
                    ws.Cell(r, 11).Value = x.FgName ?? "";
                    if (x.TicketDate.HasValue) { ws.Cell(r, 12).Value = x.TicketDate.Value; ws.Cell(r, 12).Style.DateFormat.Format = "dd/MM/yyyy"; }
                    ws.Cell(r, 13).Value = x.PrintedDate.HasValue ? $"{Stamp(x.PrintedDate.Value)}  {x.PrintedBy}" : "";
                    ws.Cell(r, 14).Value = x.PrintCount > 1 && x.LastPrintedDate.HasValue ? $"×{x.PrintCount} • {Stamp(x.LastPrintedDate.Value)}  {x.LastPrintedBy}" : "";
                    r++;
                }
                ImportTemplateService.Body(ws, r - 1, heads.Length);
                ImportTemplateService.LeftAlign(ws, r - 1, 6, 11);
                ws.Column(1).Style.Font.Bold = true;
                ws.SheetView.FreezeRows(1);
                wb.SaveAs(path);
            }
            LogService.WriteLog(Uid, "EXPORT_PICKLIST", $"File: {Path.GetFileName(path)} | Items: {items.Count} | Bills: {string.Join(", ", items.Select(i => i.TicketNo).Distinct().Take(30))}", "");
            return Download(path);
        }
        catch (Exception ex) { return Fail(ex, "Export ไม่สำเร็จ"); }
    }
}
