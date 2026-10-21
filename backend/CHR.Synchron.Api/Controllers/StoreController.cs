using CHR.Synchron.Api.Web;
using CIMS.Helpers;
using CIMS.Models;
using CIMS.Services;
using Microsoft.AspNetCore.Mvc;

namespace CHR.Synchron.Api.Controllers;

// 🏬 Store (Max-Min) (SystemID StoreMaxMin + สิทธิ์ของแต่ละคลัง = รหัสคลัง)
//   StockCardsView + StoreMaxMinView + StoreMaxMinViewModel + StockEditorWindow + BarcodeFormatWindow
//   VIEW = เมนู + เข้าดูคลัง / EDIT = แก้รูปแบบบาร์โค้ด + ตั้งค่าคลัง / ADD = เพิ่มรูปแบบ + เพิ่มคลัง / DEL = ลบคลัง
//   ในคลัง: VIEW = เห็น (พิมพ์ REMARK ได้) / EDIT = แก้ MAX / MIN / QTY / STOCK(BOX) / STOCK(PCS) / ADD = IMPORT EXCEL
[Route("api/store")]
public sealed class StoreController : AppController
{
    private readonly UploadCache _uploads;
    public StoreController(UploadCache uploads) => _uploads = uploads;

    private readonly StockService _stocks = new();
    private readonly StoreProductService _products = new();

    private StockModel VisibleStock(int stkId)
    {
        var s = _stocks.GetStock(stkId);
        return s != null && Me.CanViewStock(s) ? s : null;
    }

    private static string AllLabel(StockModel s) => s.GroupByCustomer ? "ALL CUSTOMERS" : s.GroupBySupplier ? "ALL SUPPLIERS" : "ALL CATEGORIES";

    // ---------------------------------------------------------------- การ์ดคลัง
    [HttpGet("stocks")]
    public IActionResult Stocks()
    {
        if (Me?.CanViewStore != true) return Deny();
        var visible = _stocks.GetStocks().Where(s => Me.CanViewStock(s)).ToList();
        var coils = visible.Any(s => s.CountCoil) && DbSchema.HasCoilRegister ? new CoilService().GetSummary() : new();
        var counts = new ProductControlService().GetStockPartCounts(visible);
        return Ok(new
        {
            canCreate = Me.CanCreateStock, canFormats = Me.CanManageFormats, canEdit = Me.CanEditStore,
            stocks = visible.Select(s =>
            {
                var c = s.CountCoil && DbSchema.HasCoilRegister ? (coils.TryGetValue(s.StkId, out var x) ? x : new CoilService.CoilSummary()) : null;
                return new
                {
                    s.StkId, s.Code, s.Name, s.IsMain, unit = s.UnitDisplay, itemCount = counts.TryGetValue(s.StkId, out int n) ? n : s.ItemCount,
                    canDelete = Me.CanDeleteStock(s),
                    coil = c == null ? null : new { c.MasterCount, c.MasterKg, c.ChildCount, c.ChildKg, c.TotalCount, c.TotalKg }
                };
            })
        });
    }

    // ---------------------------------------------------------------- ตั้งค่าคลัง (StockEditorWindow)
    [HttpGet("stocks/{stkId:int}/settings")]
    public IActionResult Settings(int stkId)
    {
        if (Me?.CanEditStore != true) return Deny("คุณไม่มีสิทธิ์แก้ไขคลังนี้");
        var s = _stocks.GetStock(stkId);
        return s == null ? NotFound() : Ok(new { stock = s, columns = s.ColumnOrderList(), coilRowOrder = s.CoilRowOrder(), formats = _stocks.GetFormats().Select(f => new { f.FmtId, f.Name, f.IsActive }) });
    }

    [HttpGet("formats/brief")]
    public IActionResult FormatsBrief()
    {
        if (Me?.CanViewStore != true) return Deny();
        return Ok(_stocks.GetFormats().Select(f => new { f.FmtId, f.Name, f.IsActive }));
    }

    private IActionResult ValidateStock(StockModel s, out StockModel clean)
    {
        clean = null;
        string code = (s?.Code ?? "").Trim(), name = (s?.Name ?? "").Trim();
        if (code.Length == 0) return Fail("กรุณากรอกรหัสคลัง (STOCK CODE)");
        if (name.Length == 0) return Fail("กรุณากรอกชื่อคลัง (STOCK NAME)");
        if (code.Length > 30) return Fail("รหัสคลังยาวได้ไม่เกิน 30 ตัวอักษร");
        if (StockModel.ReservedCodes.Contains(code.ToUpperInvariant())) return Fail($"รหัสคลัง \"{code}\" ซ้ำกับชื่อสิทธิ์ของระบบ กรุณาใช้รหัสอื่น");
        var cols = (s.ColumnOrder ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries);
        if (cols.Length == 0) return Fail("กรุณาเลือกคอลัมน์ที่ต้องการแสดงอย่างน้อย 1 คอลัมน์");
        bool usesSupplier = s.InSupplier || s.OutSupplier;
        if (usesSupplier && (s.FormatIds == null || s.FormatIds.Count == 0)) return Fail("เปิดช่องทาง SUPPLIER LABEL แล้ว กรุณาเลือกรูปแบบบาร์โค้ด Supplier อย่างน้อย 1 รูปแบบ");
        if (_stocks.IsStockCodeTaken(code, s.StkId)) return Fail($"รหัสคลัง \"{code}\" มีอยู่ในระบบแล้ว กรุณาใช้รหัสอื่น");
        s.Code = code; s.Name = name;
        s.Unit = s.Unit is "PCS" or "SHEET" ? s.Unit : "KG";
        s.GroupBy = s.GroupBy is "CUSTOMER" or "SUPPLIER" ? s.GroupBy : "CATEGORY";
        if (!new[] { "KG", "PCS", "SHEET", "BOX", "COIL", "UNIT" }.Contains(s.MaxMinBasis)) s.MaxMinBasis = "UNIT";
        if (!usesSupplier) s.FormatIds = new List<int>();
        // คอลัมน์ที่ติ๊ก = ลำดับที่ติ๊ก (Col* ตาม ColumnOrder)
        var set = new HashSet<string>(cols);
        s.ColNo = set.Contains("NO"); s.ColImage = set.Contains("IMAGE"); s.ColCustomer = set.Contains("CUSTOMER"); s.ColCode = set.Contains("CODE");
        s.ColPartA = set.Contains("PARTA"); s.ColPartB = set.Contains("PARTB"); s.ColPartNo = set.Contains("PARTNO"); s.ColModel = set.Contains("MODEL");
        s.ColName = set.Contains("NAME"); s.UseMaxMin = set.Contains("MAXMIN"); s.ColQty = set.Contains("QTY"); s.ColStockBox = set.Contains("BOX");
        s.CountCoil = set.Contains("COIL"); s.ColStockPcs = set.Contains("PCS"); s.ColRemark = set.Contains("REMARK");
        s.ColumnOrder = string.Join(",", cols);
        clean = s;
        return null;
    }

    [HttpPost("stocks")]
    public IActionResult Create([FromBody] StockModel s)
    {
        if (Me?.CanCreateStock != true) return Deny("คุณไม่มีสิทธิ์สร้างคลังใหม่");
        s.StkId = 0;
        if (ValidateStock(s, out var clean) is { } bad) return bad;
        try
        {
            _stocks.CreateStock(clean, Uid);
            LogService.WriteLog(Uid, "STOCK_CREATE", $"Created stock {clean.Code} ({clean.Name}) | Unit: {clean.Unit}", clean.Code);
            return Ok(new { message = $"สร้างคลัง {clean.Code} สำเร็จ" });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกข้อมูลคลังไม่สำเร็จ"); }
    }

    [HttpPut("stocks/{stkId:int}")]
    public IActionResult Update(int stkId, [FromBody] StockModel s)
    {
        if (Me?.CanEditStore != true) return Deny("คุณไม่มีสิทธิ์แก้ไขคลังนี้");
        var original = _stocks.GetStock(stkId);
        if (original == null) return NotFound();
        s.StkId = stkId;
        s.IsMain = original.IsMain;
        s.LiveSource = original.LiveSource;
        if (ValidateStock(s, out var clean) is { } bad) return bad;
        try
        {
            _stocks.UpdateStock(clean, Uid);
            LogService.WriteLog(Uid, "STOCK_UPDATE", $"Updated stock {original.Code} -> {clean.Code} ({clean.Name}) | Unit: {clean.Unit}", clean.Code);
            return Ok(new { message = $"บันทึกการตั้งค่าคลัง {clean.Code} สำเร็จ" });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกข้อมูลคลังไม่สำเร็จ"); }
    }

    public sealed record DeleteStockRequest(string Reason);

    [HttpPost("stocks/{stkId:int}/delete")]
    public IActionResult DeleteStock(int stkId, [FromBody] DeleteStockRequest req)
    {
        var s = _stocks.GetStock(stkId);
        if (s == null) return NotFound();
        if (!Me.CanDeleteStock(s)) return Deny("คุณไม่มีสิทธิ์ลบคลังนี้");
        if (string.IsNullOrWhiteSpace(req?.Reason)) return Fail("กรุณาระบุเหตุผลในการลบคลัง");
        try
        {
            _stocks.DeleteStock(stkId, req.Reason.Trim(), Uid);
            LogService.WriteLog(Uid, "STOCK_DELETE", $"Deleted stock {s.Code} ({s.Name}) | Reason: {req.Reason.Trim()}", s.Code);
            return Ok(new { message = $"ลบคลัง {s.Code} เรียบร้อยแล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "ลบคลังไม่สำเร็จ"); }
    }

    // ---------------------------------------------------------------- ตารางสินค้า
    [HttpGet("{stkId:int}")]
    public IActionResult Stock(int stkId)
    {
        if (Me?.CanViewStore != true) return Deny();
        var s = VisibleStock(stkId);
        if (s == null) return Deny("คุณไม่มีสิทธิ์ดูคลังนี้");
        var cats = _products.GetCategories(s).Skip(1).ToList();
        var counts = _products.GetStatusCounts(s);
        return Ok(new
        {
            stock = s,
            columns = s.ColumnOrderList(),
            coilRowOrder = s.CoilRowOrder(),
            allLabel = AllLabel(s), groupLabel = s.GroupCode, categories = cats,
            counts = counts == null ? null : new { counts.Value.Total, counts.Value.Max, counts.Value.Min, counts.Value.NoOrder },
            canEdit = !s.IsLiveView && Me.CanEditStock(s),
            canImport = !s.IsLiveView && Me.CanImportStock(s),
            hasCoilRegister = DbSchema.HasCoilRegister
        });
    }

    private static object Row(StoreProductModel p) => new
    {
        p.PartId, p.PartCode, p.PartName, p.Customer, p.PartA, p.PartB, p.PartNo, p.Model, p.Category, p.Supplier, p.Bin, p.GroupKey,
        p.PackSize, p.Max, p.Min, p.Qty, p.StockBox, p.StockPcs, p.Remark, p.StockStatus, p.Priority,
        imageUrl = string.IsNullOrWhiteSpace(p.ImageFileName) ? null : $"/api/images/file?name={Uri.EscapeDataString(p.ImageFileName)}"
    };

    [HttpGet("{stkId:int}/products")]
    public IActionResult Products(int stkId, [FromQuery] string key, [FromQuery] string cat, [FromQuery] string filter, [FromQuery] int skip = 0, [FromQuery] int take = 100)
    {
        if (Me?.CanViewStore != true) return Deny();
        var s = VisibleStock(stkId);
        if (s == null) return Deny("คุณไม่มีสิทธิ์ดูคลังนี้");
        string catFilter = string.IsNullOrEmpty(cat) || cat == AllLabel(s) ? "" : cat;
        var rows = _products.GetProducts(s, key ?? "", catFilter, filter ?? "", Math.Max(0, skip), Math.Clamp(take, 1, 100000));
        return Ok(new { token = _products.GetChangeToken(s), rows = rows.Select(Row) });
    }

    // ⚡ เรียลไทม์: ถาม "เปลี่ยนไหม" ทุก 3 วินาที - เปลี่ยน = ตัวเลขล่าสุดของทั้งคลัง (ยอด / MAX / MIN / REMARK / สถานะ)
    [HttpGet("{stkId:int}/numbers")]
    public IActionResult Numbers(int stkId, [FromQuery] string token)
    {
        if (Me?.CanViewStore != true) return Deny();
        var s = VisibleStock(stkId);
        if (s == null) return Deny();
        string now = _products.GetChangeToken(s);
        if (now != null && now == token) return Ok(new { token = now, changed = false });
        var counts = _products.GetStatusCounts(s);
        return Ok(new
        {
            token = now, changed = true,
            counts = counts == null ? null : new { counts.Value.Total, counts.Value.Max, counts.Value.Min, counts.Value.NoOrder },
            rows = _products.GetStockNumbers(s).Select(p => new { p.PartId, p.PartCode, p.Qty, p.Max, p.Min, p.Remark, p.StockStatus, p.StockBox, p.StockPcs })
        });
    }

    // แก้ในตาราง (StoreMaxMinViewModel.ProcessUpdate): REMARK ทุกคนที่เห็นคลัง / ตัวเลข = EDIT ของคลัง
    public sealed class EditRequest
    {
        public string PartCode { get; set; }
        public string Remark { get; set; }
        public string Max { get; set; }
        public string Min { get; set; }
        public string Qty { get; set; }
        public string StockBox { get; set; }
        public string StockPcs { get; set; }
        public EditRequest Original { get; set; }
    }

    [HttpPut("{stkId:int}/products/{partId:int}")]
    public IActionResult Edit(int stkId, int partId, [FromBody] EditRequest p)
    {
        if (Me?.CanViewStore != true) return Deny();
        var stock = VisibleStock(stkId);
        if (stock == null) return Deny("คุณไม่มีสิทธิ์ดูคลังนี้");
        if (stock.IsLiveView) return Fail(StockModel.LiveViewMessage);
        var o = p.Original ?? new EditRequest();
        if (p.Remark != o.Remark)
            LogService.WriteLog(Uid, "UPDATE_REMARK", $"| Remark: {o.Remark ?? ""} -> {p.Remark ?? ""}", p.PartCode);

        bool canEdit = Me.CanEditStock(stock);
        bool numbersChanged = p.Max != o.Max || p.Min != o.Min || p.Qty != o.Qty || p.StockBox != o.StockBox || p.StockPcs != o.StockPcs;
        if (!canEdit)
        {
            if (numbersChanged) return Deny("คุณไม่มีสิทธิ์แก้ไขข้อมูลในคลังนี้ (แก้ไขได้เฉพาะ REMARK)");
            return _products.UpdateRemark(stock, p.PartCode, p.Remark, partId) ? Ok() : Fail("ไม่สามารถบันทึกข้อมูลได้");
        }
        try
        {
            var changes = new List<string>();
            if (p.Max != o.Max) changes.Add($"MAX: {o.Max}->{p.Max}");
            if (p.Min != o.Min) changes.Add($"MIN: {o.Min}->{p.Min}");
            if (p.Qty != o.Qty) changes.Add($"QTY: {o.Qty}->{p.Qty}");
            bool dec = stock.AllowDecimal, mmDec = stock.MaxMinDecimal;
            decimal Field(string text, string name)
            {
                string t = (text ?? "").Trim();
                if (t.Length == 0 || t == "-") return 0;
                if (!Qty.TryParse(t, out decimal v)) throw new FormatException($"{name} \"{t}\" ไม่ใช่ตัวเลข");
                return Qty.Round(Math.Max(0, v), mmDec);
            }
            void CheckNumber(string text, string original, string name)
            {
                string t = (text ?? "").Trim();
                if (t != (original ?? "").Trim() && t.Length > 0 && t != "-" && !Qty.TryParse(t, out _)) throw new FormatException($"{name} \"{t}\" ไม่ใช่ตัวเลข");
            }
            decimal maxVal = Field(p.Max, "MAX"), minVal = Field(p.Min, "MIN");
            CheckNumber(p.Qty, o.Qty, "QTY");
            CheckNumber(p.StockPcs, o.StockPcs, "STOCK (PCS)");
            CheckNumber(p.StockBox, o.StockBox, stock.BoxHeader);
            decimal? qtyVal = Qty.TryParse(p.Qty, out decimal q) ? q : null;
            int? boxVal = null;
            if (p.StockPcs != o.StockPcs && Qty.TryParse(p.StockPcs, out decimal pcs)) { qtyVal = pcs; changes.Add($"STOCK(PCS): {o.StockPcs}->{p.StockPcs}"); }
            else if (p.StockBox != o.StockBox && Qty.TryParse(p.StockBox, out decimal box))
            { boxVal = (int)Math.Max(0, Math.Round(box)); changes.Add($"{(stock.CountCoil ? "QTY(COIL)" : "STOCK(BOX)")}: {o.StockBox}->{p.StockBox}"); }
            if (qtyVal.HasValue) qtyVal = Qty.Round(Math.Max(0, qtyVal.Value), dec);
            string tag = stock.IsMain ? "" : $"Stock: {stock.Code} | ";
            if (changes.Count > 0) LogService.WriteLog(Uid, "UPDATE_PRODUCT_MASTER", $"| {tag}Changes: {string.Join(", ", changes)}", p.PartCode);
            return _products.UpdateProductMaster(stock, p.PartCode, p.Remark, maxVal, minVal, qtyVal, boxVal, partId) ? Ok() : Fail("ไม่สามารถบันทึกข้อมูลได้");
        }
        catch (Exception ex) { return Fail("ไม่สามารถบันทึกข้อมูลได้\n" + ex.Message); }
    }

    // 🧲 แถว Coil ย่อยของสินค้า (คลิก PD CODE)
    [HttpGet("{stkId:int}/coils/{partId:int}")]
    public IActionResult Coils(int stkId, int partId)
    {
        if (Me?.CanViewStore != true) return Deny();
        if (VisibleStock(stkId) == null) return Deny();
        return Ok(new CoilService().GetCoilRows(stkId, partId).Select(c => new
        {
            c.CoilId, c.IsMother, c.No, c.CoilNo, c.MotherCoil, c.WeightKG, ton = c.WeightKG / 1000m, c.LabelDate, received = c.DateText
        }));
    }

    // ---------------------------------------------------------------- 📤 Export / Template
    [HttpGet("{stkId:int}/export")]
    public IActionResult Export(int stkId, [FromQuery] string key, [FromQuery] string cat, [FromQuery] string filter)
    {
        if (Me?.CanViewStore != true) return Deny();
        var s = VisibleStock(stkId);
        if (s == null) return Deny();
        string catFilter = string.IsNullOrEmpty(cat) || cat == AllLabel(s) ? "" : cat;
        var rows = _products.GetProducts(s, key ?? "", catFilter, filter ?? "", 0, 1000000).OrderBy(p => p.GroupKey).ThenBy(p => p.PartCode).ToList();
        if (rows.Count == 0) return Fail("ไม่มีข้อมูลในตารางให้ Export");
        try
        {
            string path = ImportTemplateService.NewPath(ImportTemplateService.Systems.Store, s.Code);
            StoreExcel.Write(path, s, rows, s.GroupCode);
            LogService.WriteLog(Uid, "EXPORT_STORE_EXCEL", $"Exported {rows.Count} rows | Stock: {s.Code} | File: {Path.GetFileName(path)}", s.Code);
            return Download(path);
        }
        catch (Exception ex) { return Fail(ex, "Export ไม่สำเร็จ"); }
    }

    [HttpGet("{stkId:int}/template")]
    public IActionResult Template(int stkId, [FromQuery] bool coil)
    {
        if (Me?.CanViewStore != true) return Deny();
        var s = VisibleStock(stkId);
        if (s == null) return Deny();
        try
        {
            string path;
            if (coil) path = new CoilImportService().WriteTemplate(s);
            else
            {
                var products = _products.GetProducts(s, "", "", "", 0, 1000000).OrderBy(p => p.GroupKey).ThenBy(p => p.PartCode).ToList();
                path = new StoreMasterImportService().WriteTemplate(s, products, _stocks.GetStocks());
                LogService.WriteLog(Uid, "STORE_TEMPLATE", $"Stock: {s.Code} | Rows: {products.Count} | File: {Path.GetFileName(path)}", s.Code);
            }
            return Download(path);
        }
        catch (Exception ex) { return Fail(ex, "สร้างไฟล์ Template ไม่สำเร็จ"); }
    }

    // ---------------------------------------------------------------- 📥 IMPORT EXCEL (3 แบบตามไฟล์: อัพเดทข้อมูล / COIL LIST / บวกยอด)
    private static string Errs<T>(IEnumerable<T> bad, Func<T, string> line)
    {
        var list = bad.ToList();
        return string.Join("\n", list.Take(8).Select(line)) + (list.Count > 8 ? $"\n• ... และอีก {list.Count - 8:N0} แถว" : "");
    }

    [HttpPost("{stkId:int}/import")]
    [RequestSizeLimit(30_000_000)]
    public async Task<IActionResult> ImportPreview(int stkId, IFormFile file)
    {
        var s = VisibleStock(stkId);
        if (s == null) return Deny();
        if (s.IsLiveView) return Fail(StockModel.LiveViewMessage);
        if (!Me.CanImportStock(s)) return Deny("คุณไม่มีสิทธิ์ Import ข้อมูลเข้าคลังนี้");
        string path;
        try { path = await SaveUpload(file); } catch (Exception ex) { return Fail(ex.Message); }
        string fileName = file.FileName;
        try
        {
            if (StoreMasterImportService.IsMasterFile(path))
            {
                var stocks = _stocks.GetStocks();
                var rows = new StoreMasterImportService().Read(path, s, stocks);
                var noRight = rows.Where(r => r.IsValid).SelectMany(r => r.Stocks).GroupBy(x => x.StkId).Select(g => g.First()).Where(x => !Me.CanImportStock(x)).Select(x => x.Code).ToList();
                if (noRight.Count > 0) { TryDelete(path); return Deny("คุณไม่มีสิทธิ์ Import ข้อมูลเข้าคลัง: " + string.Join(", ", noRight)); }
                var valid = rows.Where(r => r.IsValid).ToList();
                var bad = rows.Where(r => !r.IsValid).ToList();
                string errs = Errs(bad, r => $"• แถว {r.RowNumber}: {r.Error}");
                if (valid.Count == 0) { TryDelete(path); return Fail("ไม่พบรายการที่นำเข้าได้ในไฟล์นี้\n\n" + errs); }
                var stockCodes = string.Join(", ", valid.SelectMany(r => r.Stocks).Select(x => x.Code).Distinct());
                string summary = $"ไฟล์: {fileName}\nคลัง: {stockCodes}\n\n" +
                                 $"อัพเดทสินค้าเดิม {valid.Count(r => !r.IsNew && !r.IsCoilExtra):N0} รายการ  •  เพิ่มสินค้าใหม่ {valid.Count(r => r.IsNew && !r.IsCoilExtra):N0} รายการ\n" +
                                 (valid.Any(r => r.CoilNo != null) ? $"COIL {valid.Count(r => r.CoilNo != null):N0} ลูก  •  น้ำหนักรวม {valid.Where(r => r.CoilNo != null).Sum(r => r.CoilWeight):#,##0.###} KG (STOCK (UNIT) ของสินค้า = น้ำหนักรวม Coil ในทะเบียน)\n" : "") +
                                 "ยอดคงคลัง / MAX / MIN จะถูกตั้งตามตัวเลขในไฟล์ (ช่องว่าง = ไม่เปลี่ยน)" +
                                 (bad.Count > 0 ? $"\n\n⚠ ข้ามแถวที่มีปัญหา {bad.Count:N0} แถว:\n{errs}" : "") + "\n\nยืนยันการนำเข้าหรือไม่?";
                return Ok(new { id = _uploads.Put(path, fileName, Uid, "store-master:" + stkId, rows), kind = "MASTER", summary });
            }
            if (s.CountCoil && DbSchema.HasCoilRegister && CoilImportService.IsCoilFile(path))
            {
                var rows = new CoilImportService().Read(path, s);
                var valid = rows.Where(r => r.IsValid).ToList();
                var bad = rows.Where(r => !r.IsValid).ToList();
                string errs = Errs(bad, r => $"• แถว {r.RowNumber}: {r.Error}");
                if (valid.Count == 0) { TryDelete(path); return Fail("ไม่พบรายการที่นำเข้าได้ในไฟล์นี้\n\n" + errs); }
                string summary = $"ไฟล์: {fileName}\nคลัง: {s.Code}\n\n" +
                                 $"COIL ใหม่ {valid.Count(r => !r.IsUpdate):N0} ลูก  •  อัพเดท COIL เดิม {valid.Count(r => r.IsUpdate):N0} ลูก\n" +
                                 $"สินค้า {valid.Select(r => r.PartId).Distinct().Count():N0} รายการ  •  น้ำหนักรวม {valid.Sum(r => r.WeightKG):#,##0.###} KG\n" +
                                 "STOCK (COIL) ของสินค้าในไฟล์ = นับใหม่จากทะเบียน Coil (ยอด KG ไม่เปลี่ยน)" +
                                 (bad.Count > 0 ? $"\n\n⚠ ข้ามแถวที่มีปัญหา {bad.Count:N0} แถว:\n{errs}" : "") + "\n\nยืนยันการนำเข้าหรือไม่?";
                return Ok(new { id = _uploads.Put(path, fileName, Uid, "store-coil:" + stkId, rows), kind = "COIL", summary });
            }
            {
                var rows = _stocks.ReadImportExcel(path);
                var valid = rows.Where(r => r.IsValid).ToList();
                var invalid = rows.Where(r => !r.IsValid).ToList();
                string errs = Errs(invalid, r => $"• แถว {r.RowNumber}: {(string.IsNullOrEmpty(r.Code) ? "-" : r.Code)} - {r.Error}");
                if (valid.Count == 0) { TryDelete(path); return Fail("ไม่พบรายการที่นำเข้าได้ในไฟล์นี้\n\n" + errs); }
                string summary = $"ไฟล์: {fileName}\nคลัง: {s.Code}\n\n" +
                                 $"นำเข้าได้ {valid.Count:N0} แถว  (รวม {valid.Sum(r => r.Qty):N0} {s.Unit})\n" +
                                 "จำนวนจะถูกบวกเพิ่มจากยอดเดิม" +
                                 (invalid.Count > 0 ? $"\n\n⚠ ข้ามแถวที่มีปัญหา {invalid.Count:N0} แถว:\n{errs}" : "") + "\n\nยืนยันการนำเข้าหรือไม่?";
                return Ok(new { id = _uploads.Put(path, fileName, Uid, "store-qty:" + stkId, rows), kind = "QTY", summary });
            }
        }
        catch (Exception ex) { TryDelete(path); return Fail(ex, "อ่านไฟล์ Excel ไม่สำเร็จ"); }
    }

    public sealed record ApplyRequest(string Id, string Kind);

    [HttpPost("{stkId:int}/import/apply")]
    public IActionResult ImportApply(int stkId, [FromBody] ApplyRequest req)
    {
        var s = VisibleStock(stkId);
        if (s == null) return Deny();
        if (!Me.CanImportStock(s)) return Deny("คุณไม่มีสิทธิ์ Import ข้อมูลเข้าคลังนี้");
        string kind = req.Kind switch { "MASTER" => "store-master:", "COIL" => "store-coil:", _ => "store-qty:" } + stkId;
        var it = _uploads.Get(req.Id, Uid, kind);
        if (it == null) return Fail("ไฟล์หมดเวลาแล้ว กรุณาเลือกไฟล์ใหม่");
        try
        {
            string msg;
            switch (req.Kind)
            {
                case "MASTER":
                {
                    var rows = (List<StoreMasterRow>)it.State;
                    var bad = rows.Count(r => !r.IsValid);
                    var stockCodes = string.Join(", ", rows.Where(r => r.IsValid).SelectMany(r => r.Stocks).Select(x => x.Code).Distinct());
                    var r = new StoreMasterImportService().Apply(rows, Uid);
                    LogService.WriteLog(Uid, "STOCK_MASTER_IMPORT",
                        $"Import Excel (update) -> {stockCodes} | File: {it.FileName} | Updated: {r.Updated} | Added: {r.Added} | Stock rows: {r.StockRows} | Coils: {r.Coils} | Skipped rows: {bad}", s.Code);
                    msg = $"นำเข้าข้อมูลสำเร็จ\nอัพเดท {r.Updated:N0} รายการ  •  เพิ่มใหม่ {r.Added:N0} รายการ" + (r.Coils > 0 ? $"\nCOIL {r.Coils:N0} ลูก" : "");
                    break;
                }
                case "COIL":
                {
                    var rows = (List<CoilImportRow>)it.State;
                    var r = new CoilImportService().Apply(s, rows, Uid);
                    LogService.WriteLog(Uid, "COIL_IMPORT",
                        $"Import COIL LIST -> {s.Code} | File: {it.FileName} | Added: {r.Added} | Updated: {r.Updated} | Products: {r.Parts} | Skipped rows: {rows.Count(x => !x.IsValid)}", s.Code);
                    msg = $"นำเข้า COIL สำเร็จ\nCOIL ใหม่ {r.Added:N0} ลูก  •  อัพเดท {r.Updated:N0} ลูก  •  สินค้า {r.Parts:N0} รายการ";
                    break;
                }
                default:
                {
                    var rows = (List<StockImportRow>)it.State;
                    var result = _stocks.ApplyImport(s.StkId, rows, it.FileName, Uid);
                    LogService.WriteLog(Uid, "STOCK_IMPORT",
                        $"Import Excel -> {s.Code} | File: {it.FileName} | Items: {result.Items} | Total qty: {result.TotalQty} | Skipped rows: {rows.Count(x => !x.IsValid)}", s.Code);
                    msg = $"นำเข้าข้อมูลสำเร็จ {result.Items:N0} รายการ\nรวม {result.TotalQty:N0} {s.Unit}";
                    break;
                }
            }
            _uploads.Remove(req.Id);
            return Ok(new { message = msg });
        }
        catch (Exception ex) { return Fail(ex, "นำเข้าข้อมูลไม่สำเร็จ (ยกเลิกทั้งไฟล์ ไม่มีรายการใดถูกบันทึก)"); }
    }

    // ---------------------------------------------------------------- 🏷️ BARCODE FORMATS (BarcodeFormatWindow)
    [HttpGet("formats")]
    public IActionResult Formats()
    {
        if (Me?.CanManageFormats != true) return Deny();
        return Ok(new
        {
            canAdd = Me.CanAddStore, canEdit = Me.CanEditStore, canDelete = Me.CanDeleteStore,
            formats = _stocks.GetFormats(),
            stocks = _stocks.GetStocks().Select(s => new { s.StkId, s.Code, s.Name, display = s.DisplayName })
        });
    }

    private static int RequiredMinFields(BarcodeFormatModel f)
    {
        int m = Math.Max(f.CodePos, Math.Max(f.AltCodePos ?? 0, Math.Max(f.QtyPos ?? 0, Math.Max(f.CoilNoPos ?? 0, f.MotherCoilPos ?? 0))));
        if (f.MatchByName) foreach (int n in f.NamePositions()) m = Math.Max(m, n);
        return Math.Max(1, m);
    }

    // 🧪 ทดสอบรูปแบบกับป้ายตัวอย่าง: แยกช่อง + รหัส / จำนวน / Coil ที่อ่านได้ + หาสินค้าในระบบ
    [HttpPost("formats/test")]
    public IActionResult TestFormat([FromBody] BarcodeFormatModel f)
    {
        if (Me?.CanManageFormats != true) return Deny();
        f.IsActive = true;
        if (f.DelimMode == "SPACES" && string.IsNullOrEmpty(f.Delimiter)) f.Delimiter = " ";
        f.MinFields = Math.Max(f.MinFields, RequiredMinFields(f));
        string sample = f.SampleText ?? "";
        var fields = string.IsNullOrEmpty(sample) ? Array.Empty<string>() : f.SplitFields(sample);
        bool ok = f.TryParse(sample, out var codes, out var qty);
        string coilNo = null, mother = null;
        if (ok) f.ReadCoil(sample, out coilNo, out mother);
        string lookup = null;
        if (ok && codes.Count > 0)
        {
            var part = new ScanService().FindPart(f, codes, out string note);
            lookup = part != null ? $"FOUND IN SYSTEM:  {part.PartCode}  •  {part.PartName}"
                                  : "NOT FOUND IN SYSTEM" + (string.IsNullOrEmpty(note) ? "  (no product has this " + (f.MatchByName ? "name" : "code") + ")" : "  -  " + note);
        }
        return Ok(new { ok, fields, codes, qty, coilNo, mother, lookup, minFields = RequiredMinFields(f), namePositions = f.NamePositions() });
    }

    public sealed class SaveFormatRequest
    {
        public BarcodeFormatModel Format { get; set; }
        public int? TypedMinFields { get; set; }
    }

    [HttpPost("formats")]
    public IActionResult SaveFormat([FromBody] SaveFormatRequest req)
    {
        var f = req?.Format;
        if (f == null) return Fail("ข้อมูลไม่ครบ");
        if (!(f.FmtId == 0 ? Me?.CanAddStore == true : Me?.CanEditStore == true))
            return Deny(f.FmtId == 0 ? "คุณไม่มีสิทธิ์เพิ่มรูปแบบบาร์โค้ด" : "คุณไม่มีสิทธิ์แก้ไขรูปแบบบาร์โค้ด");
        f.Name = (f.Name ?? "").Trim();
        f.DelimMode = f.DelimMode == "SPACES" ? "SPACES" : "CHAR";
        if (f.SplitBySpaces && string.IsNullOrEmpty(f.Delimiter)) f.Delimiter = " ";
        f.CodePrefix = f.CodePrefix is "DIGIT" or "CUT" ? f.CodePrefix : "NONE";
        f.MatchBy = f.MatchBy == "NAME" ? "NAME" : "CODE";
        if (string.IsNullOrEmpty(f.Name)) return Fail("กรุณากรอกชื่อรูปแบบ (FORMAT NAME)");
        if (!f.SplitBySpaces && string.IsNullOrEmpty(f.Delimiter)) return Fail("กรุณากรอกตัวคั่น (DELIMITER) เช่น ; หรือเลือก SPLIT FIELDS BY = ANY SPACES");
        if (f.CodePrefix == "CUT" && !(f.CodeCut > 0)) return Fail("กรุณากรอกจำนวนตัวอักษรที่ต้องการตัด (N)");
        if (f.CodePos <= 0) return Fail("กรุณากรอกตำแหน่งช่องรหัสสินค้า (CODE FIELD #)");
        if (f.MatchByName && !string.IsNullOrWhiteSpace(f.NameFields) && f.NamePositions().Count == 0) return Fail("กรุณากรอกช่องชื่อสินค้า (NAME FIELDS #) เป็นตัวเลข เช่น 6,7");
        int needMin = RequiredMinFields(f);
        if (req.TypedMinFields.HasValue && req.TypedMinFields.Value < needMin)
            return Fail($"MIN FIELDS ต้องไม่น้อยกว่า {needMin}\n(ช่องที่ใช้อยู่ไกลสุดคือช่อง #{needMin}) - เว้นว่างไว้ได้ ระบบใส่ให้เอง");
        f.MinFields = Math.Max(req.TypedMinFields ?? needMin, needMin);
        if (_stocks.GetFormats().Any(x => x.FmtId != f.FmtId && string.Equals(x.Name, f.Name, StringComparison.OrdinalIgnoreCase)))
            return Fail($"ชื่อรูปแบบ \"{f.Name}\" มีอยู่แล้ว กรุณาใช้ชื่ออื่น");
        try
        {
            bool isNew = f.FmtId == 0;
            int id = _stocks.SaveFormat(f, Uid);
            LogService.WriteLog(Uid, isNew ? "BARCODE_FMT_CREATE" : "BARCODE_FMT_UPDATE",
                $"{f.Name} | Delim: {f.Delimiter} | Code#{f.CodePos} Alt#{f.AltCodePos} Qty#{f.QtyPos} Min{f.MinFields} Coil#{f.CoilNoPos} Master#{f.MotherCoilPos} | Match: {(f.MatchByName ? "NAME#" + string.Join(",", f.NamePositions()) : "CODE")} | Active: {f.IsActive} | DeductStk: {f.SourceStkId}", f.Name);
            return Ok(new { id, message = $"บันทึกรูปแบบ {f.Name} สำเร็จ" });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกรูปแบบบาร์โค้ดไม่สำเร็จ"); }
    }

    [HttpDelete("formats/{fmtId:int}")]
    public IActionResult DeleteFormat(int fmtId)
    {
        if (Me?.CanDeleteStore != true) return Deny();
        var f = _stocks.GetFormats().FirstOrDefault(x => x.FmtId == fmtId);
        if (f == null) return NotFound();
        try
        {
            _stocks.DeleteFormat(fmtId);
            LogService.WriteLog(Uid, "BARCODE_FMT_DELETE", $"Deleted format {f.Name}", f.Name);
            return Ok();
        }
        catch (Exception ex) { return Fail(ex, "ลบรูปแบบบาร์โค้ดไม่สำเร็จ"); }
    }
}
