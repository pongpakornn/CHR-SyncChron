using System.Globalization;
using ClosedXML.Excel;
using CIMS.Helpers;
using CIMS.Models;
using CIMS.Services;

namespace CHR.Synchron.Api.Web;

// 📤 Export Excel ของหน้า Store (Max-Min) - ย้ายมาจาก StoreMaxMinView.btnExportExcel_Click (รูปแบบไฟล์เดิม)
//    NO / PD CODE / PRODUCT NAME / ยอด (+ STOCK (COIL) + แถว Coil ย่อย + แผ่น COIL DETAIL สำหรับคลังที่นับ Coil)
public static class StoreExcel
{
    public static void Write(string path, StockModel stock, List<StoreProductModel> rows, string groupLabel)
    {
        string qtyHeader = stock.QtyHeader;
        bool dec = stock.AllowDecimal, coil = stock.CountCoil;
        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add("Store");
        string[] heads = coil ? new[] { "NO", "PD CODE", "PRODUCT NAME", qtyHeader, "STOCK (COIL)" } : new[] { "NO", "PD CODE", "PRODUCT NAME", qtyHeader };
        ImportTemplateService.Header(ws, heads, new double[] { 6.4, 20, 46, 16, 13 });

        var coilsOf = coil && DbSchema.HasCoilRegister ? new CoilService().GetCoils(stock.StkId, 0).ToLookup(c => c.PartId) : null;
        var coilRowNos = new List<int>();
        int r = 2;
        var groupRows = new List<(int Row, string Text)>();
        foreach (var g in rows.GroupBy(p => string.IsNullOrWhiteSpace(p.GroupKey) ? "-" : p.GroupKey))
        {
            groupRows.Add((r, $"{groupLabel} : {g.Key}   ({g.Count():N0} ITEMS)"));
            r++;
            int no = 1;
            foreach (var p in g)
            {
                ws.Cell(r, 1).Value = no++;
                ws.Cell(r, 2).Value = p.PartCode;
                ws.Cell(r, 3).Value = p.PartName;
                if (Qty.TryParse(p.Qty, out decimal q)) ws.Cell(r, 4).Value = q; else ws.Cell(r, 4).Value = p.Qty;
                if (coil) { if (Qty.TryParse(p.StockBox, out decimal cq)) ws.Cell(r, 5).Value = cq; else ws.Cell(r, 5).Value = 0; }
                r++;
                if (coilsOf != null && coilsOf.Contains(p.PartId))
                    foreach (var c in coilsOf[p.PartId])
                    {
                        ws.Cell(r, 2).Value = "↳ " + c.CoilNo;
                        ws.Cell(r, 3).Value = "MASTER COIL : " + (string.IsNullOrWhiteSpace(c.MotherCoil) ? "-" : c.MotherCoil)
                                            + (c.ReceivedDate.HasValue ? "   •   RECEIVED " + c.ReceivedDate.Value.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture) : "");
                        ws.Cell(r, 4).Value = c.WeightKG;
                        ws.Cell(r, 5).Value = 1;
                        coilRowNos.Add(r);
                        r++;
                    }
            }
        }
        int last = r - 1;
        ImportTemplateService.Body(ws, last, heads.Length);
        ImportTemplateService.LeftAlign(ws, last, 3);
        ws.Range(2, 1, last, 1).Style.Font.Bold = true;
        ws.Range(2, 4, last, 4).Style.NumberFormat.Format = ImportTemplateService.QtyFormat(dec);
        if (coil) ws.Range(2, 5, last, 5).Style.NumberFormat.Format = "#,##0";
        foreach (var (row, text) in groupRows) ImportTemplateService.GroupRow(ws, row, heads.Length, text);
        foreach (int cr0 in coilRowNos)
        {
            var rr = ws.Range(cr0, 1, cr0, heads.Length);
            rr.Style.Fill.BackgroundColor = XLColor.FromHtml("#F4F0FC");
            rr.Style.Font.FontColor = XLColor.FromHtml("#5F5A66");
            rr.Style.Font.Bold = false;
            ws.Cell(cr0, 2).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Left;
            ws.Cell(cr0, 4).Style.NumberFormat.Format = "#,##0.00#";
        }

        if (coil && DbSchema.HasCoilRegister)
        {
            var coils = new CoilService().GetCoils(stock.StkId, 0).ToLookup(c => c.PartId);
            var cs = wb.Worksheets.Add("COIL DETAIL");
            string[] ch = { "NO", "MASTER COIL", "COIL NO", "WEIGHT (KG.)", "WEIGHT (TON)", "LABEL DATE", "RECEIVED" };
            ImportTemplateService.Header(cs, ch, new double[] { 6.4, 20, 22, 15, 15, 15, 19 });
            int cr = 2;
            var cGroups = new List<(int Row, string Text)>();
            foreach (var p in rows.Where(p => coils.Contains(p.PartId)))
            {
                var list = coils[p.PartId].ToList();
                cGroups.Add((cr, $"{p.PartCode}  {p.PartName}   ({list.Count:N0} COIL  •  {list.Sum(c => c.WeightKG):#,##0.###} KG)"));
                cr++;
                int no = 1;
                foreach (var c in list)
                {
                    cs.Cell(cr, 1).Value = no++;
                    cs.Cell(cr, 2).Value = c.MotherCoil ?? "-";
                    cs.Cell(cr, 3).Value = c.CoilNo;
                    cs.Cell(cr, 4).Value = c.WeightKG;
                    cs.Cell(cr, 5).Value = Math.Round(c.WeightKG / 1000m, 3);
                    cs.Cell(cr, 6).Value = c.LabelDate ?? "-";
                    cs.Cell(cr, 7).Value = c.ReceivedDate?.ToString("dd/MM/yyyy HH:mm", CultureInfo.InvariantCulture) ?? "-";
                    cr++;
                }
            }
            int clast = cr - 1;
            ImportTemplateService.Body(cs, clast, ch.Length);
            if (clast >= 2)
            {
                cs.Range(2, 1, clast, 1).Style.Font.Bold = true;
                cs.Range(2, 4, clast, 4).Style.NumberFormat.Format = "#,##0.00#";
                cs.Range(2, 5, clast, 5).Style.NumberFormat.Format = "#,##0.000";
            }
            foreach (var (row, text) in cGroups) ImportTemplateService.GroupRow(cs, row, ch.Length, text);
        }
        wb.SaveAs(path);
    }
}
