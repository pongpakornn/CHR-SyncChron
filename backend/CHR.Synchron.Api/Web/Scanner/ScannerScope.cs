using CIMS.Helpers;
using CIMS.Models;
using CIMS.Services;

namespace CHR.Synchron.Api.Web.Scanner;

// 🏬 คลังที่ผู้ใช้คนนี้สแกนได้ + การตั้งค่าที่ Admin กำหนด (ย้ายมาจาก ScanInViewModel.LoadStocks / ApplyScope)
//    สร้างใหม่ทุก Request (เว็บไม่มีหน้าจอค้างไว้ -> Admin เปลี่ยนคลังให้แล้วมีผลกับการสแกนครั้งถัดไปทันที)
public sealed class ScannerScope
{
    public UserSession User { get; }
    public List<StockModel> AllStocks { get; }
    public List<StockModel> Stocks { get; } = new();        // คลังที่เห็น + เปิดช่องทางสแกน
    public List<BarcodeFormatModel> Formats { get; }         // รูปแบบป้าย Supplier ที่เปิดใช้งาน
    public bool AssignMode { get; }                          // Update_20261015.sql: คลังสแกนกำหนดโดย Admin ต่อ UserID
    public bool Auto { get; private set; }
    public List<int> ScopeIds { get; private set; } = new();
    public int? PriorityId { get; private set; }
    public bool NotAssigned { get; private set; }
    public HashSet<int> AskEmployee { get; } = new();
    public HashSet<int> AskDepartment { get; } = new();
    public HashSet<int> EligibleDeduct { get; } = new();
    public List<int> AssignedDeduct { get; } = new();
    public string AssignToken { get; }

    public bool IsAdmin => User?.UserLevel == 1;
    public bool IsScanOutOnlyUser => User != null && User.CanViewScanOut && !User.CanViewScanIn;
    public List<StockModel> ScopeStocks => Auto ? Stocks.ToList() : Stocks.Where(s => ScopeIds.Contains(s.StkId)).ToList();
    public bool IsMultiScope => Auto || ScopeIds.Count > 1;
    public StockModel SelectedStock => IsMultiScope ? null : ScopeStocks.FirstOrDefault();
    public bool CanChangeScope => AssignMode ? IsAdmin : User?.CanEditScanner == true;

    // คลังที่เห็นปุ่ม DEDUCTED / NOT DEDUCTED (null = ทุกคลังแบบเดิม)
    public List<int> DeductStockIds => !AssignMode ? null
        : ScopeStocks.Select(s => s.StkId).Where(id => EligibleDeduct.Contains(id) && (IsAdmin || AssignedDeduct.Contains(id))).ToList();
    public bool HasDeductStocks => DeductStockIds == null || DeductStockIds.Count > 0;

    // clientScope = ค่าที่ Browser จำไว้ (ใช้เฉพาะฐานที่ยังไม่รัน Update_20261015.sql - แบบเดิมจำไว้ในเครื่อง)
    public ScannerScope(UserSession user, string clientScope = null)
    {
        User = user;
        var stockSvc = new StockService();
        Formats = stockSvc.GetFormats(activeOnly: true);
        AllStocks = stockSvc.GetStocks();
        bool canIn = user?.CanViewScanIn == true, canOut = user?.CanViewScanOut == true;
        foreach (var s in AllStocks)
        {
            bool visible = user?.CanViewStock(s) == true;
            // มีแค่ VIEW (ไม่มี ADD / EDIT) -> เห็นคลังที่เปิดช่องทางสแกนไว้ ใช้ได้เฉพาะ TEST MODE / HISTORY
            bool scannable = (canIn && s.CanScanIn) || (canOut && s.CanScanOut) || (!canIn && !canOut && (s.CanScanIn || s.CanScanOut));
            if (visible && scannable) Stocks.Add(s);
        }

        AssignMode = DbSchema.HasUserScanStocks;
        if (AssignMode)
        {
            var setup = new ScannerSetupService();
            var a = setup.GetAssignment(user?.UserId);
            AssignToken = setup.AssignmentToken(user?.UserId);
            foreach (var id in ScannerSetupService.DeductStockIds(AllStocks, Formats)) EligibleDeduct.Add(id);
            AssignedDeduct.AddRange(a.DeductIds);
            foreach (var id in a.EmployeeIds) AskEmployee.Add(id);
            foreach (var id in a.DepartmentIds) AskDepartment.Add(id);
            Apply(false, a.StockIds, a.PriorityId);
        }
        else
        {
            ParseScope(clientScope, out bool auto, out var ids, out int? prio);
            Apply(auto, ids, prio);
        }
    }

    private void Apply(bool auto, List<int> ids, int? priorityId)
    {
        Auto = auto;
        ScopeIds = (ids ?? new List<int>()).Where(id => Stocks.Any(s => s.StkId == id)).Distinct().ToList();
        // คลังที่ Admin กำหนด: ไม่มี = ล็อก (ไม่ใช้คลังหลักแทน กันสแกนผิดคลังโดยไม่รู้ตัว)
        if (AssignMode) NotAssigned = !Auto && ScopeIds.Count == 0;
        if (!Auto && ScopeIds.Count == 0 && !AssignMode)
        {
            var fallback = Stocks.FirstOrDefault(s => s.IsMain) ?? Stocks.FirstOrDefault();
            if (fallback != null) ScopeIds.Add(fallback.StkId);
        }
        PriorityId = priorityId.HasValue && Stocks.Any(s => s.StkId == priorityId.Value) ? priorityId : null;
    }

    // "15" (คลังเดียว) / "1,15;15" (หลายคลัง;★) / "AUTO;15" - รูปแบบเดียวกับไฟล์ scanner_stock.txt ของ WPF
    public static void ParseScope(string raw, out bool auto, out List<int> ids, out int? priority)
    {
        auto = false; ids = new List<int>(); priority = null;
        var parts = (raw ?? "").Trim().Split(';');
        if (parts.Length > 1 && int.TryParse(parts[1].Trim(), out int p)) priority = p;
        if (string.Equals(parts[0].Trim(), "AUTO", StringComparison.OrdinalIgnoreCase)) { auto = true; return; }
        foreach (var t in parts[0].Split(','))
            if (int.TryParse(t.Trim(), out int id)) ids.Add(id);
    }

    public static string FormatScope(bool auto, IEnumerable<int> ids, int? priority) =>
        (auto ? "AUTO" : string.Join(",", ids)) + (priority.HasValue ? ";" + priority.Value : "");

    public static bool SupportsReturn(StockModel s) => s != null && (s.InSysQr || s.InSupplier);
}
