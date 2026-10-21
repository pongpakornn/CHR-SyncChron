using CIMS.Helpers;
using CIMS.Models;
using CIMS.Services;

namespace CHR.Synchron.Api.Web.Scanner;

// 📊 ตารางวันนี้ + ตารางสรุป (ScanInViewModel.LoadTodayDataAsync + UpdateSummary)
//    1 แถวสรุป = 1 สินค้า (PartID) ต่อ 1 คลัง / RETURN นับรวมเป็นยอดรับเข้า / FinalStock = ยอดจริงจากฐานข้อมูล
public sealed class SummaryRowDto
{
    public int PartId { get; set; }
    public int StkId { get; set; }
    public string StockCode { get; set; }
    public string PartCode { get; set; }
    public string PartName { get; set; }
    public string Code { get; set; }
    public int InCount { get; set; }
    public decimal TotalInQty { get; set; }
    public int OutCount { get; set; }
    public decimal TotalOutQty { get; set; }
    public decimal FinalStock { get; set; }
    public string ImageUrl { get; set; }
}

public sealed class TodayDto
{
    public string Signature { get; set; }
    public List<ScanRowDto> Rows { get; set; } = new();          // ใหม่สุดก่อน
    public List<SummaryRowDto> Summary { get; set; } = new();
}

public static class ScannerToday
{
    public static TodayDto Load(ScannerScope scope)
    {
        var svc = new ScanService();
        var stocks = scope.ScopeStocks;
        var dto = new TodayDto();
        if (stocks.Count == 0) { dto.Signature = "empty"; return dto; }

        var displayMap = svc.GetScanDisplayMap(scope.User?.UserId);
        var displayFormats = displayMap.Values.Any(v => v.StartsWith("FIELD:")) ? new StockService().GetFormats() : new List<BarcodeFormatModel>();

        var rows = stocks
            .SelectMany(st => svc.GetTodayTransactions(st).Select(t => { t.StkId = st.StkId; t.StockCode = st.Code; t.ShowStockInCode = stocks.Count > 1; return t; }))
            .OrderBy(t => t.UpdateTime).ToList();

        var balances = new Dictionary<(int, int), decimal>();
        foreach (var k in rows.Select(r => (r.StkId, r.PartId)).Distinct())
            balances[k] = svc.GetInventoryBalance(k.PartId, stocks.FirstOrDefault(s => s.StkId == k.StkId));

        dto.Signature = string.Join(",", stocks.Select(s => s.StkId)) + "|" + rows.Count + "|" + rows.Sum(d => d.Qty) + "|" +
                        (rows.Count > 0 ? rows.Max(d => d.UpdateTime).Ticks : 0);

        var summary = new List<SummaryRowDto>();
        foreach (var item in rows)
        {
            if (displayMap.TryGetValue(item.StkId, out string key))
            {
                string v = ScanDisplay.Resolve(key, item.PartCode, item.PartA, item.PartNumber, item.Model, item.PartName, item.RefNo, displayFormats);
                item.DisplayCode = string.IsNullOrWhiteSpace(v) ? null : v;
            }
            if (item.Status == "IN" || item.Status == "RETURN" || item.Status == "OUT") dto.Rows.Insert(0, ScanRowDto.From(item));

            if (item.PartId <= 0 && string.IsNullOrWhiteSpace(item.PartACode)) continue;
            decimal bal = balances.TryGetValue((item.StkId, item.PartId), out decimal b) ? b : 0;
            var existing = summary.FirstOrDefault(x => x.StkId == item.StkId &&
                (item.PartId > 0 ? x.PartId == item.PartId : x.PartId <= 0 && x.PartCode == item.PartACode));
            bool isIn = item.Status == "IN" || item.Status == "RETURN", isOut = item.Status == "OUT";
            if (existing == null)
            {
                summary.Add(existing = new SummaryRowDto
                {
                    PartId = item.PartId, StkId = item.StkId, StockCode = item.StockCode, PartCode = item.PartCode, PartName = item.PartName,
                    Code = item.CodeText, ImageUrl = item.PartId > 0 ? $"/api/images/part/{item.PartId}" : null
                });
            }
            else
            {
                if (string.IsNullOrEmpty(existing.PartCode) && !string.IsNullOrEmpty(item.PartCode)) existing.PartCode = item.PartCode;
                if (string.IsNullOrEmpty(existing.PartName) && !string.IsNullOrEmpty(item.PartName)) existing.PartName = item.PartName;
            }
            if (isIn) { existing.InCount++; existing.TotalInQty += item.Qty; }
            else if (isOut) { existing.OutCount++; existing.TotalOutQty += item.Qty; }
            existing.FinalStock = bal;
        }
        dto.Summary = summary;
        return dto;
    }
}
