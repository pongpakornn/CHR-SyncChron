using CHR.Synchron.Api.Web;
using CIMS.Services;
using Microsoft.AspNetCore.Mvc;

namespace CHR.Synchron.Api.Controllers;

// 📊 DASHBOARD (SystemID DASHBOARD: VIEW) - DashboardViewModel
//   การ์ด 4 ใบ (STOCK / PRODUCT ALL / MAX / MIN) แยกตามคลังที่ผู้ใช้มีสิทธิ์ - นับแบบเดียวกับปุ่ม MAX / MIN ของหน้า Store
//   สัดส่วน Order ของลูกค้าเดือนนี้ (vw_DashboardPieChart) + Forecast / Order / Delivery ทั้งปี (vw_DashboardBarChart)
[Route("api/dashboard")]
public sealed class DashboardController : AppController
{
    private readonly DashboardService _svc = new();

    [HttpGet("cards")]
    public IActionResult Cards()
    {
        if (Me?.CanViewDashboard != true) return Deny();
        var visible = _svc.GetStockSummaries().Where(d => Me.CanViewStock(d.Stock)).ToList();
        return Ok(new
        {
            stocks = visible.Select(v => new { v.Stock.StkId, v.Stock.Code, v.Stock.Name, v.Items, v.MaxCount, v.MinCount }),
            totals = new { stocks = visible.Count, items = visible.Sum(v => v.Items), max = visible.Sum(v => v.MaxCount), min = visible.Sum(v => v.MinCount) },
            time = DateTime.Now.ToString("HH:mm:ss", System.Globalization.CultureInfo.InvariantCulture),
            canStore = Me.CanViewStore
        });
    }

    [HttpGet("charts")]
    public IActionResult Charts()
    {
        if (Me?.CanViewDashboard != true) return Deny();
        var pie = _svc.GetMonthlyCustomerOrders();
        var bar = _svc.GetYearlyForecastOrder();
        return Ok(new
        {
            month = DateTime.Now.ToString("MMMM yyyy", System.Globalization.CultureInfo.InvariantCulture),
            year = DateTime.Now.Year,
            customers = pie.OrderByDescending(p => p.OrderAmount).Select(p => new { name = p.CustomerName, amount = p.OrderAmount, p.Percentage }),
            months = Enumerable.Range(1, 12).Select(m =>
            {
                var r = bar.FirstOrDefault(x => x.MonthOrder == m);
                return new
                {
                    month = m, label = new DateTime(2000, m, 1).ToString("MMM", System.Globalization.CultureInfo.InvariantCulture),
                    forecast = r?.ForecastValue ?? 0, order = r?.OrderValue ?? 0, delivery = r?.DeliveryValue ?? 0
                };
            })
        });
    }
}
