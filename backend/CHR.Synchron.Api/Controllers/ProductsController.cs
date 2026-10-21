using CHR.Synchron.Api.Web;
using CIMS.Helpers;
using CIMS.Models;
using CIMS.Services;
using Microsoft.AspNetCore.Mvc;

namespace CHR.Synchron.Api.Controllers;

// 🏷️ Inventory Registration (SystemID ProductControl) - ProductControlView + ProductControlViewModel + ADMIN (Level 1)
//   VIEW = เมนู + ดู + Export QR / ADD = ลงทะเบียน + IMPORT / EDIT = แก้ไข + SHOW/HIDE + รูปภาพ / DEL = ลบสินค้า
[Route("api/products")]
public sealed class ProductsController : AppController
{
    private const string KeyFilter = "ProductControl.Filter", KeyStocks = "ProductControl.Stocks";
    private readonly UploadCache _uploads;
    public ProductsController(UploadCache uploads) => _uploads = uploads;

    private readonly ProductControlService _svc = new();
    private readonly StockService _stocks = new();

    private static ProductControlLayout LayoutOf(Dictionary<int, ProductControlLayout> all, int? stkId) =>
        all.TryGetValue(stkId ?? 0, out var l) ? l : ProductControlColumns.Default(stkId ?? 0);

    // ---------------------------------------------------------------- หน้าจอ
    [HttpGet("meta")]
    public IActionResult Meta()
    {
        if (Me?.CanViewProductControl != true) return Deny();
        var stocks = _stocks.GetStocks();
        var layouts = new ProductControlLayoutService().GetAll();
        var sg = new ProductControlLayoutService().GetSuggestions();
        string savedFilter = UserSettings.Get(Uid, KeyFilter, "");
        string savedStocks = UserSettings.Get(Uid, KeyStocks, "");
        return Ok(new
        {
            can = new { add = Me.CanAddProduct, edit = Me.CanEditProduct, delete = Me.CanDeleteProduct, admin = Me.UserLevel == 1 },
            stocks = stocks.Select(s => new { s.StkId, s.Code, s.Name, s.IsMain, s.CountCoil, s.ShowCoilRows, s.IsLiveView, canView = Me.CanViewStock(s) }),
            columns = ProductControlColumns.All.Select(c => new { key = c.Key, label = c.Label }),
            layouts = stocks.Select(s => (int?)s.StkId).Prepend(null).Select(id => new { stkId = id ?? 0, layout = LayoutOf(layouts, id) }),
            suggestions = new { suppliers = sg.Suppliers, customers = sg.Customers, categories = sg.Categories },
            savedFilter = int.TryParse(savedFilter, out int f) && stocks.Any(s => s.StkId == f) ? f : (int?)null,
            savedStocks,
            hasCoilRegister = DbSchema.HasCoilRegister
        });
    }

    [HttpPost("filter")]
    public IActionResult SaveFilter([FromBody] int? stkId)
    {
        if (Me?.CanViewProductControl != true) return Deny();
        UserSettings.Set(Uid, KeyFilter, stkId?.ToString() ?? "");
        return Ok();
    }

    // คลังที่ติ๊กไว้ตอนลงทะเบียนสินค้าใหม่ (จำค่าของผู้ใช้) "main|id,id"
    [HttpPost("default-stocks")]
    public IActionResult SaveDefaultStocks([FromBody] string value)
    {
        if (Me?.CanViewProductControl != true) return Deny();
        UserSettings.Set(Uid, KeyStocks, value ?? "");
        return Ok();
    }

    private static object Row(ProductControlModel p) => new
    {
        p.PtId, p.PartCode, p.PartName, p.PackSize, p.Category, p.Location, p.QRCodeData, p.Max, p.Min, p.Stock, supplier = p.CustomerCode,
        p.Customer, p.PartA, p.PartB, p.PartNo, p.Model, p.IsShow, p.IsShowMain, p.IsActive, p.ImageFileName,
        p.MotherCoil, p.CoilNo, p.CoilCount, p.GroupKey,
        imageUrl = string.IsNullOrWhiteSpace(p.ImageFileName) ? null : $"/api/images/file?name={Uri.EscapeDataString(p.ImageFileName)}"
    };

    private static string Short(List<string> list, int max) =>
        list.Count <= max ? string.Join("\n", list) : string.Join("\n", list.Take(max)) + $"\n+{list.Count - max:N0}";

    [HttpGet]
    public IActionResult List([FromQuery] string key, [FromQuery] int? stkId, [FromQuery] int skip = 0, [FromQuery] int take = 100)
    {
        if (Me?.CanViewProductControl != true) return Deny();
        var layout = LayoutOf(new ProductControlLayoutService().GetAll(), stkId);
        var all = _svc.GetInventoryForQR(key?.Trim(), stkId);
        var rows = all.Skip(Math.Max(0, skip)).Take(Math.Clamp(take, 1, 100000)).ToList();
        // ข้อมูลเสริม (ProductControlViewModel.Decorate): หัวกลุ่ม + Coil ในคลัง
        var stock = stkId.HasValue ? _stocks.GetStock(stkId.Value) : null;
        int? coilStk = stock != null && stock.ShowCoilRows && DbSchema.HasCoilRegister ? stock.StkId : null;
        bool needCoils = coilStk.HasValue || layout.Columns.Contains("MOTHER") || layout.Columns.Contains("COILNO");
        var coils = needCoils ? new ProductControlLayoutService().GetCoils(stkId) : null;
        foreach (var p in rows)
        {
            string g = layout.GroupBy == "CUSTOMER" ? p.Customer : layout.GroupBy == "SUPPLIER" ? p.CustomerCode : p.Category;
            p.GroupKey = string.IsNullOrWhiteSpace(g) ? "-" : g.Trim();
            if (coils != null && coils.TryGetValue(p.PtId, out var c))
            {
                p.MotherCoil = Short(c.Mothers, 3);
                p.CoilNo = c.Coils.Count == 0 ? "" : $"{c.Coils.Count:N0} COIL\n" + Short(c.Coils, 2);
                p.CoilCount = coilStk.HasValue ? c.Coils.Count : 0;
            }
        }
        return Ok(new { total = all.Count, layout, coilStkId = coilStk, rows = rows.Select(Row) });
    }

    // VIEW / EDIT สินค้า: คลังที่สินค้าอยู่ + Coil ในคลังตอนนี้ (แสดงอย่างเดียว)
    [HttpGet("{ptId:int}/detail")]
    public IActionResult Detail(int ptId, [FromQuery] string code, [FromQuery] int? stkId)
    {
        if (Me?.CanViewProductControl != true) return Deny();
        var ids = _svc.GetPartStockIds(code ?? "", ptId);
        string coilText = null;
        var map = new ProductControlLayoutService().GetCoils(stkId, ptId);
        if (map.TryGetValue(ptId, out var c) && c.Coils.Count > 0)
            coilText = $"🧲 IN STOCK NOW: {c.Coils.Count:N0} COIL  •  COIL NO {string.Join(", ", c.Coils.Take(8))}{(c.Coils.Count > 8 ? " ..." : "")}" +
                       (c.Mothers.Count > 0 ? $"  •  MASTER COIL {string.Join(", ", c.Mothers.Take(5))}{(c.Mothers.Count > 5 ? " ..." : "")}" : "");
        return Ok(new { stockIds = ids, coilText });
    }

    [HttpGet("{ptId:int}/coils")]
    public IActionResult Coils(int ptId, [FromQuery] int stkId)
    {
        if (Me?.CanViewProductControl != true) return Deny();
        return Ok(new CoilService().GetCoilRows(stkId, ptId).Select(c => new { c.CoilId, c.IsMother, c.No, c.CoilNo, c.MotherCoil, c.WeightKG, ton = c.WeightKG / 1000m, received = c.DateText }));
    }

    // ---------------------------------------------------------------- ลงทะเบียน / แก้ไข
    public sealed class ProductForm
    {
        public string Supplier { get; set; }
        public string Category { get; set; }
        public string PartCode { get; set; }
        public string PartName { get; set; }
        public string PackSize { get; set; }
        public string Bin { get; set; }
        public string QrCode { get; set; }
        public string Customer { get; set; }
        public string PartA { get; set; }
        public string PartB { get; set; }
        public string PartNo { get; set; }
        public string Model { get; set; }
        public string ImageFileName { get; set; }
        public bool InMain { get; set; }
        public List<int> OtherStockIds { get; set; } = new();
        public string CoilNo { get; set; }
        public string MasterCoil { get; set; }
        public string CoilKg { get; set; }
        public int? FilterStkId { get; set; }
        public string OldCode { get; set; }
    }

    private ProductControlModel ModelOf(ProductForm f)
    {
        string code = (f.PartCode ?? "").Trim();
        return new ProductControlModel
        {
            CustomerCode = (f.Supplier ?? "").Trim(), Category = (f.Category ?? "").Trim(), PartCode = code, PartACode = code,
            PartName = (f.PartName ?? "").Trim(), PackSize = (f.PackSize ?? "").Trim(), Location = (f.Bin ?? "").Trim(), QRCodeData = (f.QrCode ?? "").Trim(),
            Customer = (f.Customer ?? "").Trim(), PartA = (f.PartA ?? "").Trim(), PartB = (f.PartB ?? "").Trim(), PartNo = (f.PartNo ?? "").Trim(),
            Model = (f.Model ?? "").Trim(), ImageFileName = f.ImageFileName
        };
    }

    // ตรวจ Coil ที่กรอก (ProductControlView.ValidateCoil): ไม่กรอก = ไม่เพิ่ม / กรอกไม่ครบหรือผิด = แจ้ง
    private string ValidateCoil(ProductForm f, List<StockModel> stocks, out (string No, string Master, decimal Kg, StockModel Stock)? coil)
    {
        coil = null;
        string no = (f.CoilNo ?? "").Trim(), master = (f.MasterCoil ?? "").Trim(), kgText = (f.CoilKg ?? "").Replace(",", "").Trim();
        if (no.Length == 0 && master.Length == 0 && kgText.Length == 0) return null;
        if (!DbSchema.HasCoilRegister) return "ฐานข้อมูลยังไม่รองรับทะเบียน Coil";
        if (no.Length == 0) return "กรุณากรอก COIL NO (เลข Coil ลูก)";
        if (!Qty.TryParse(kgText, out decimal kg) || kg <= 0) return "กรุณากรอก COIL WEIGHT (KG) เป็นตัวเลขมากกว่า 0";
        var ticked = stocks.Where(s => s.CountCoil && ((s.IsMain && f.InMain) || f.OtherStockIds.Contains(s.StkId))).ToList();
        var stock = ticked.FirstOrDefault(s => s.StkId == f.FilterStkId) ?? ticked.FirstOrDefault();
        if (stock == null) return "กรุณาติ๊กคลังที่นับ Coil (เช่น STOCK-MAT / STOCK-PANTA / STOCK-MSH) ในช่อง STOCK\nเพื่อรับ Coil " + no + " เข้าคลังนั้น";
        string where = _svc.CoilInStock(no);
        if (where != null) return $"Coil {no} อยู่ในคลัง {where} แล้ว - ไม่เพิ่มซ้ำ";
        coil = (no, master.Length == 0 ? null : master, kg, stock);
        return null;
    }

    // หลังบันทึก: คลังของสินค้า + Coil ที่กรอก -> ข้อความแจ้งผล
    private List<string> AfterSave(ProductControlModel m, ProductForm f, int ptId, (string No, string Master, decimal Kg, StockModel Stock)? coil)
    {
        var notes = new List<string>();
        var blocked = _svc.SyncPartStocks(m.PartACode, f.InMain, f.OtherStockIds ?? new(), ptId);
        if (blocked.Count > 0)
            notes.Add($"⚠ ไม่สามารถเอาสินค้า {m.PartACode} ออกจากคลังต่อไปนี้ได้ เพราะยังมียอดคงเหลือ\n• {string.Join("\n• ", blocked)}\nกรุณาโอนย้ายหรือตัดยอดให้เป็น 0 ก่อน");
        if (coil != null && ptId > 0)
        {
            var c = coil.Value;
            try
            {
                _svc.AddCoil(ptId, c.Stock, c.No, c.Master, c.Kg, Uid);
                LogService.WriteLog(Uid, "ADD_COIL", $"{c.Stock.Code} | {m.PartCode} | Coil {c.No} | Master {c.Master ?? "-"} | {Qty.Plain(c.Kg)} KG", m.PartCode);
                notes.Add($"เพิ่ม Coil {c.No} ({Qty.Plain(c.Kg)} KG) เข้า {c.Stock.Code} แล้ว");
            }
            catch (Exception ex) { notes.Add($"⚠ บันทึกสินค้าแล้ว แต่เพิ่ม Coil {c.No} ไม่สำเร็จ\n{ex.Message}"); }
        }
        return notes;
    }

    private static string CheckForm(ProductForm f, List<StockModel> stocks)
    {
        if (string.IsNullOrWhiteSpace(f.PartCode)) return "กรุณากรอกรหัสสินค้าก่อนทำการลงทะเบียนครับ";
        string ps = (f.PackSize ?? "").Trim();
        if (ps.Length > 0 && !ps.All(char.IsDigit)) return "PACKSIZE ต้องเป็นตัวเลขเท่านั้นครับ";
        if (stocks.Count > 0 && !f.InMain && (f.OtherStockIds == null || f.OtherStockIds.Count == 0)) return "กรุณาเลือกคลัง (STOCK) อย่างน้อย 1 คลังครับ";
        return null;
    }

    [HttpPost]
    public async Task<IActionResult> Register([FromBody] ProductForm f)
    {
        if (Me?.CanAddProduct != true && Me?.CanApproveScan != true) return Deny("คุณไม่มีสิทธิ์ลงทะเบียนสินค้า");
        var stocks = _stocks.GetStocks();
        if (CheckForm(f, stocks) is { } err) return Fail(err);
        if (ValidateCoil(f, stocks, out var coil) is { } cerr) return Fail(cerr);
        var m = ModelOf(f);
        int psz = int.TryParse(m.PackSize, out int p) ? p : 0;
        if (await _svc.CheckDuplicateCodeAsync(m.PartACode, m.PartA))
            return Fail($"มีสินค้า PRODUCT CODE {m.PartACode} + PART A {m.PartA} นี้ในระบบแล้วครับ");
        try
        {
            string fullDetail = $"SUPPLIER: {m.CustomerCode}  | CAT: {m.Category}  | PDCODE : {m.PartCode}  | BIN: {m.Location}  | PDNAME: {m.PartName}  | PZ : {psz}";
            LogService.WriteLog(Uid, "REGISTER_PART", $"Registered New Part: {fullDetail}", m.PartACode);
            int newId = await _svc.InsertNewPartAsync(m.PartCode, m.PartName, psz, m.QRCodeData, 0, 0, m.Category, m.ImageFileName,
                                                      m.CustomerCode, m.Location, m.Customer, m.PartA, m.PartNo, m.Model, m.PartB);
            if (newId <= 0) return Fail("ฐานข้อมูลปฏิเสธการบันทึกข้อมูล กรุณาตรวจสอบการกรอกข้อมูลให้ครบถ้วน");
            var notes = AfterSave(m, f, newId, coil);
            return Ok(new { ptId = newId, partCode = m.PartCode, message = "ลงทะเบียนสินค้าใหม่เรียบร้อยแล้ว!" + (notes.Count > 0 ? "\n\n" + string.Join("\n\n", notes) : "") });
        }
        catch (Exception ex) { return Fail(ex, "ลงทะเบียนสินค้าใหม่ไม่สำเร็จ"); }
    }

    [HttpPut("{ptId:int}")]
    public async Task<IActionResult> Update(int ptId, [FromBody] ProductForm f)
    {
        if (Me?.CanEditProduct != true) return Deny("คุณไม่มีสิทธิ์แก้ไขสินค้า");
        var stocks = _stocks.GetStocks();
        if (CheckForm(f, stocks) is { } err) return Fail(err);
        if (ValidateCoil(f, stocks, out var coil) is { } cerr) return Fail(cerr);
        var m = ModelOf(f);
        m.PtId = ptId;
        if (await _svc.CheckDuplicateCodeAsync(m.PartACode, m.PartA, ptId))
            return Fail($"ไม่สามารถบันทึกได้ เนื่องจากมีสินค้า PRODUCT CODE {m.PartACode} + PART A {m.PartA} นี้ในระบบแล้วครับ");
        var old = _svc.GetInventoryForQR(f.OldCode ?? m.PartCode, null).FirstOrDefault(x => x.PtId == ptId);
        string changeLog = old == null ? null : Diff(old, m);
        LogService.WriteLog(Uid, "EDIT_PART", $" | Edited Details : {changeLog ?? "No changes detected"}", m.PartACode);
        int psz = int.TryParse(m.PackSize, out int p) ? p : 0;
        try
        {
            bool ok = await _svc.UpdateExistingPartAsync(f.OldCode ?? old?.PartACode ?? m.PartACode, m.PartACode, m.PartCode, m.PartName, psz, m.QRCodeData, m.Category, Uid,
                                                         m.ImageFileName, m.CustomerCode, m.Location, m.Customer, m.PartA, m.PartNo, m.Model, ptId, m.PartB);
            if (!ok) return Fail("อัปเดตข้อมูลไม่สำเร็จ");
            var notes = AfterSave(m, f, ptId, coil);
            return Ok(new { ptId, message = "แก้ไขข้อมูลเรียบร้อยแล้ว!" + (notes.Count > 0 ? "\n\n" + string.Join("\n\n", notes) : "") });
        }
        catch (Exception ex) { return Fail(ex, "อัปเดตข้อมูลไม่สำเร็จ"); }
    }

    private static string Diff(ProductControlModel o, ProductControlModel n)
    {
        var d = new List<string>();
        if (o.PartCode != n.PartCode) d.Add($"PDCODE: {o.PartCode}->{n.PartCode}");
        if (o.PartName != n.PartName) d.Add($"PTNAME: {o.PartName}->{n.PartName}");
        if (o.PackSize != n.PackSize) d.Add($"PZ: {o.PackSize}->{n.PackSize}");
        if (o.Category != n.Category) d.Add($"CAT: {o.Category}->{n.Category}");
        if (o.CustomerCode != n.CustomerCode) d.Add($"SUPPLIER: {o.CustomerCode}->{n.CustomerCode}");
        if (o.Location != n.Location) d.Add($"BIN: {o.Location}->{n.Location}");
        if ((o.Customer ?? "") != (n.Customer ?? "")) d.Add($"CUSTOMER: {o.Customer}->{n.Customer}");
        if ((o.PartA ?? "") != (n.PartA ?? "")) d.Add($"PART A: {o.PartA}->{n.PartA}");
        if ((o.PartB ?? "") != (n.PartB ?? "")) d.Add($"PART B: {o.PartB}->{n.PartB}");
        if ((o.PartNo ?? "") != (n.PartNo ?? "")) d.Add($"PART NO: {o.PartNo}->{n.PartNo}");
        if ((o.Model ?? "") != (n.Model ?? "")) d.Add($"MODEL: {o.Model}->{n.Model}");
        if (o.QRCodeData != n.QRCodeData) d.Add($"QR: {o.QRCodeData}->{n.QRCodeData}");
        return d.Count > 0 ? string.Join("  |  ", d) : null;
    }

    public sealed record ToggleRequest(string PartCode, string PartName, bool Show, int? StkId);

    [HttpPost("{ptId:int}/toggle")]
    public IActionResult Toggle(int ptId, [FromBody] ToggleRequest req)
    {
        if (Me?.CanEditProduct != true) return Deny();
        if (!_svc.UpdateShowStatus(req.PartCode, req.Show, Uid, req.StkId, ptId)) return Fail("บันทึกไม่สำเร็จ");
        LogService.WriteLog(Uid, "TOGGLE_STATUS", $" | Set show status to {(req.Show ? "Enabled" : "Disabled")}{(req.StkId.HasValue ? $" | Stock id: {req.StkId}" : "")}  | PDNAME : {req.PartName}", req.PartCode);
        return Ok(new { message = req.Show ? "แสดงรายการแล้ว" : "ซ่อนรายการแล้ว" });
    }

    public sealed record DeleteRequest(string PartCode, string PartName);

    [HttpPost("{ptId:int}/delete")]
    public IActionResult Delete(int ptId, [FromBody] DeleteRequest req)
    {
        if (Me?.CanDeleteProduct != true) return Deny();
        if (!_svc.DeletePart(req.PartCode, Uid, out string error, ptId))
            return Fail($"ลบสินค้า {req.PartCode} ไม่สำเร็จ\n\n{error ?? "ไม่ทราบสาเหตุ"}");
        LogService.WriteLog(Uid, "DELETE_PART", $"Deleted PDNAME : {req.PartName}", req.PartCode);
        return Ok(new { message = "ลบสำเร็จ!" });
    }

    // 🖼 รูปสินค้า -> storage/images/stock/<คลัง>/<คลัง>-NN.ext (ไม่แตะ Share ของระบบจริง)
    [HttpPost("image")]
    [RequestSizeLimit(15_000_000)]
    public async Task<IActionResult> Image(IFormFile file, [FromForm] string stockCode, [FromForm] string current)
    {
        if (Me?.CanAddProduct != true && Me?.CanEditProduct != true) return Deny();
        string ext = Path.GetExtension(file?.FileName ?? "").ToLowerInvariant();
        if (file == null || file.Length == 0 || ext is not (".png" or ".jpg" or ".jpeg")) return Fail("กรุณาเลือกไฟล์รูป (.png / .jpg)");
        try
        {
            string name = ImagePaths.NextImageName(string.IsNullOrWhiteSpace(stockCode) ? "STOCK" : stockCode, current, ext);
            string dest = ImagePaths.Resolve(name);
            string dir = Path.GetDirectoryName(dest), baseName = Path.GetFileNameWithoutExtension(dest);
            foreach (var old in Directory.GetFiles(dir, baseName + ".*")) { System.IO.File.Delete(old); ImageCacheHelper.Forget(old); }
            await using (var fs = System.IO.File.Create(dest)) await file.CopyToAsync(fs);
            ImageCacheHelper.Forget(dest);
            return Ok(new { imageFileName = name, imageUrl = $"/api/images/file?name={Uri.EscapeDataString(name)}&v={DateTime.Now.Ticks}" });
        }
        catch (Exception ex) { return Fail(ex, "ไม่สามารถอัปโหลดรูปได้"); }
    }

    // ---------------------------------------------------------------- Template / Import / Export QR
    [HttpGet("template")]
    public IActionResult Template([FromQuery] int? stkId)
    {
        if (Me?.CanAddProduct != true) return Deny("คุณไม่มีสิทธิ์ Import สินค้า");
        var stocks = _stocks.GetStocks();
        var forStock = stkId.HasValue ? stocks.FirstOrDefault(s => s.StkId == stkId.Value) : null;
        try
        {
            string path = ImportTemplateService.NewPath(ImportTemplateService.Systems.Product, forStock == null ? "ALL_STOCKS_Template" : $"{forStock.Code}_Template");
            new ImportTemplateService().CreatePartTemplate(path, stocks, forStock);
            LogService.WriteLog(Uid, "PART_TEMPLATE", $"File: {Path.GetFileName(path)} | Stock: {forStock?.Code ?? "ALL"}", "");
            return Download(path);
        }
        catch (Exception ex) { return Fail(ex, "สร้างไฟล์ Template ไม่สำเร็จ"); }
    }

    [HttpGet("template/options")]
    public IActionResult TemplateOptions()
    {
        if (Me?.CanAddProduct != true) return Deny();
        return Ok(_stocks.GetStocks().Where(s => Me.CanViewStock(s) && !s.IsLiveView).Select(s => new
        {
            s.StkId, s.Code, s.Name, heads = string.Join(" · ", ImportTemplateService.PartHeadsFor(s).Where(h => h != "NO")), s.CountCoil
        }));
    }

    [HttpPost("import")]
    [RequestSizeLimit(30_000_000)]
    public async Task<IActionResult> ImportPreview(IFormFile file)
    {
        if (Me?.CanAddProduct != true) return Deny("คุณไม่มีสิทธิ์ Import สินค้า");
        string path;
        try { path = await SaveUpload(file); } catch (Exception ex) { return Fail(ex.Message); }
        try
        {
            var rows = new PartImportService().ReadExcel(path, _stocks.GetStocks());
            var valid = rows.Where(r => r.IsValid).ToList();
            var invalid = rows.Where(r => !r.IsValid).ToList();
            string errors = string.Join("\n", invalid.Take(8).Select(r => $"• แถว {r.RowNumber}: {(string.IsNullOrEmpty(r.Code) ? "-" : r.Code)} - {r.Error}"))
                            + (invalid.Count > 8 ? $"\n• ... และอีก {invalid.Count - 8:N0} แถว" : "");
            if (valid.Count == 0) { TryDelete(path); return Fail("ไม่พบรายการที่ลงทะเบียนได้ในไฟล์นี้\n\n" + errors); }
            int products = valid.Count(r => !r.IsCoilExtra), coilCount = valid.Count(r => r.CoilNo != null);
            string summary = $"ไฟล์: {file.FileName}\n\nลงทะเบียนสินค้าใหม่ได้ {products:N0} รายการ" +
                             (coilCount > 0 ? $"\nCOIL {coilCount:N0} ลูก  •  น้ำหนักรวม {valid.Where(r => r.CoilNo != null).Sum(r => r.CoilWeight):#,##0.###} KG (STOCK (UNIT) ของสินค้า = น้ำหนักรวม Coil ในทะเบียน)" : "") +
                             (invalid.Count > 0 ? $"\n\n⚠ ข้ามแถวที่มีปัญหา {invalid.Count:N0} แถว:\n{errors}" : "") + "\n\nยืนยันการลงทะเบียนหรือไม่?";
            return Ok(new { id = _uploads.Put(path, file.FileName, Uid, "parts", rows), summary });
        }
        catch (Exception ex) { TryDelete(path); return Fail(ex, "อ่านไฟล์ Excel ไม่สำเร็จ"); }
    }

    [HttpPost("import/apply")]
    public IActionResult ImportApply([FromBody] string id)
    {
        if (Me?.CanAddProduct != true) return Deny("คุณไม่มีสิทธิ์ Import สินค้า");
        var it = _uploads.Get(id, Uid, "parts");
        if (it == null) return Fail("ไฟล์หมดเวลาแล้ว กรุณาเลือกไฟล์ใหม่");
        var rows = (List<PartImportRow>)it.State;
        try
        {
            int count = new PartImportService().ApplyImport(rows, Uid);
            var valid = rows.Where(r => r.IsValid).ToList();
            LogService.WriteLog(Uid, "REGISTER_PART_IMPORT",
                $"Import Excel: {it.FileName} | Registered: {count} | Skipped rows: {rows.Count(r => !r.IsValid)} | Coils: {valid.Count(r => r.CoilNo != null)} | Codes: {string.Join(", ", valid.Where(v => !v.IsCoilExtra).Select(v => v.Code).Take(50))}", "");
            _uploads.Remove(id);
            return Ok(new { message = $"ลงทะเบียนสินค้าใหม่สำเร็จ {count:N0} รายการ" });
        }
        catch (Exception ex) { return Fail(ex, "ลงทะเบียนไม่สำเร็จ (ยกเลิกทั้งไฟล์ ไม่มีรายการใดถูกบันทึก)"); }
    }

    [HttpGet("count")]
    public IActionResult Count([FromQuery] int? stkId)
    {
        if (Me?.CanViewProductControl != true) return Deny();
        return Ok(new { count = _svc.GetInventoryForQR("", stkId).Count });
    }

    public sealed record ExportQrRequest(string Mode, List<int> Ids, int? StkId, string Key, string StockName);

    // ▣ EXPORT QR (PDF A4) ตามรูปแบบที่ตั้งไว้ของคลังในช่องกรอง (ADMIN > QR CODE)
    [HttpPost("export-qr")]
    public IActionResult ExportQr([FromBody] ExportQrRequest req)
    {
        if (Me?.CanViewProductControl != true) return Deny();
        List<ProductControlModel> items;
        if (req.Mode == "ALL") items = _svc.GetInventoryForQR("", req.StkId);
        else
        {
            var ids = new HashSet<int>(req.Ids ?? new());
            items = _svc.GetInventoryForQR("", req.StkId).Where(p => ids.Contains(p.PtId)).ToList();
            if (items.Count < ids.Count) items = _svc.GetInventoryForQR("", null).Where(p => ids.Contains(p.PtId)).ToList();
        }
        string stockName = string.IsNullOrWhiteSpace(req.StockName) ? "ALL STOCKS" : req.StockName;
        if (items.Count == 0) return Fail(req.Mode == "ALL" ? $"ไม่มีสินค้าใน {stockName}" : "กรุณาเลือกรายการที่ต้องการ Export อย่างน้อย 1 รายการครับ");
        try
        {
            var lay = LayoutOf(new ProductControlLayoutService().GetAll(), req.StkId);
            var qrFields = lay.QrFields.ToList(); var labelFields = lay.QrLabel.ToList();
            bool needCoils = qrFields.Concat(labelFields).Any(k => k == "MOTHER" || k == "COILNO");
            var coils = needCoils ? new ProductControlLayoutService().GetCoils(req.StkId) : null;
            string pdf = new ExportService().GenerateA4Pdf(items, qrFields, labelFields, coils);
            string qrText = QrFormat.Sample(qrFields);
            if (req.Mode == "ALL")
                LogService.WriteLog(Uid, "EXPORT_QR_PDF", $"Exported QR Code to PDF: ALL IN {stockName} ({items.Count:N0} items) | QR: {qrText}", stockName);
            else
                foreach (var item in items) LogService.WriteLog(Uid, "EXPORT_QR_PDF", $"Exported QR Code to PDF for Part: {item.PartName} | QR: {qrText}", item.PartCode);
            return Download(pdf, "application/pdf");
        }
        catch (Exception ex) { return Fail(ex, "Export ไม่สำเร็จ"); }
    }

    // ---------------------------------------------------------------- 🛠 ADMIN (Level 1)
    [HttpGet("admin")]
    public IActionResult Admin()
    {
        if (Me?.UserLevel != 1) return Deny("เฉพาะ Admin (Level 1) เท่านั้น");
        var stocks = _stocks.GetStocks();
        var layouts = new ProductControlLayoutService().GetAll();
        var counts = _svc.GetStockPartCounts(stocks);
        return Ok(new
        {
            stocks = stocks.Select(s => new { s.StkId, s.Code, s.Name, count = counts.TryGetValue(s.StkId, out int n) ? n : 0 }),
            layouts = stocks.Select(s => (int?)s.StkId).Prepend(null).Select(id => new { stkId = id ?? 0, code = id == null ? "ALL STOCKS" : stocks.First(s => s.StkId == id).Code, layout = LayoutOf(layouts, id) }),
            columns = ProductControlColumns.All.Select(c => new { key = c.Key, label = c.Label }),
            qrFields = QrFormat.Fields.Select(c => new { key = c.Key, label = c.Label }),
            groups = ProductControlColumns.Groups,
            defaultOrder = ProductControlColumns.DefaultOrder,
            hasQrFields = DbSchema.HasQrFields
        });
    }

    public sealed record LayoutSave(int StkId, List<string> Columns, string GroupBy, List<string> QrFields, List<string> QrLabel);

    [HttpPost("admin/layouts")]
    public IActionResult SaveLayouts([FromBody] List<LayoutSave> list)
    {
        if (Me?.UserLevel != 1) return Deny("เฉพาะ Admin (Level 1) เท่านั้น");
        if (list == null || list.Count == 0) return Ok();
        var now = new ProductControlLayoutService().GetAll();
        var save = new List<ProductControlLayout>();
        foreach (var r in list)
        {
            var l = LayoutOf(now, r.StkId == 0 ? null : r.StkId).Clone();
            l.StockId = r.StkId;
            if (r.Columns != null)
            {
                var cols = ProductControlColumns.Parse(string.Join(",", r.Columns));
                if (cols.Count == 0) return Fail($"กรุณาเลือกคอลัมน์อย่างน้อย 1 คอลัมน์");
                l.Columns = cols;
                l.GroupBy = ProductControlColumns.Groups.Contains(r.GroupBy) ? r.GroupBy : "CATEGORY";
            }
            if (r.QrFields != null)
            {
                var qf = QrFormat.Parse(string.Join(",", r.QrFields), QrFormat.DefaultFields);
                if (!qf.Contains("CODE")) qf.Insert(0, "CODE");
                if (!DbSchema.HasQrFields && !(qf.SequenceEqual(new[] { "CODE" }) || qf.SequenceEqual(QrFormat.DefaultFields)))
                    return Fail("ฐานข้อมูลยังไม่รองรับรูปแบบนี้ กรุณารัน Database/Update_20261017b.sql ก่อน");
                l.QrFields = qf;
                l.QrLabel = QrFormat.Parse(string.Join(",", r.QrLabel ?? new()), QrFormat.DefaultLabel);
            }
            save.Add(l);
        }
        try
        {
            new ProductControlLayoutService().Save(save, Uid);
            bool qr = list.Any(r => r.QrFields != null);
            LogService.WriteLog(Uid, qr ? "PRODUCT_CONTROL_QR" : "PRODUCT_CONTROL_LAYOUT",
                string.Join(" | ", save.Select(l => qr
                    ? $"{l.StockId}: QR {QrFormat.Sample(l.QrFields)} / LABEL {string.Join(", ", l.QrLabel.Select(ProductControlColumns.Label))}"
                    : $"{l.StockId}: {l.GroupBy} | {string.Join(",", l.Columns)}")), "");
            return Ok(new { message = "บันทึกแล้ว" });
        }
        catch (Exception ex) { return Fail(ex, "บันทึกไม่สำเร็จ"); }
    }

    public sealed record StockDeleteRequest(List<int> StockIds, bool All, List<int> PartIds, string Reason);

    [HttpPost("admin/delete")]
    public IActionResult AdminDelete([FromBody] StockDeleteRequest req)
    {
        if (Me?.UserLevel != 1) return Deny("เฉพาะ Admin (Level 1) เท่านั้น");
        if (string.IsNullOrWhiteSpace(req.Reason)) return Fail("กรุณาระบุเหตุผล");
        var stocks = _stocks.GetStocks().Where(s => (req.StockIds ?? new()).Contains(s.StkId)).ToList();
        if (stocks.Count == 0) return Fail("Select at least 1 stock.");
        if (!req.All && (req.PartIds == null || req.PartIds.Count == 0)) return Fail("ยังไม่ได้ติ๊กสินค้าในตาราง");
        try
        {
            var res = _svc.DeleteInStocks(stocks, req.All ? null : req.PartIds, true);
            int count = res.Deleted.Count + res.Removed.Count;
            LogService.WriteLog(Uid, "ADMIN_DELETE_PART",
                $"{(req.All ? "Delete ALL" : "Delete ticked")} in {string.Join(", ", stocks.Select(s => s.Code))} | Deleted: {res.Deleted.Count} | Removed from stock only: {res.Removed.Count} | Reason: {req.Reason.Trim()} | Codes: {string.Join(", ", res.Deleted.Concat(res.Removed).Take(100))}{(count > 100 ? " ..." : "")}",
                string.Join(",", stocks.Select(s => s.Code)));
            if (count == 0) return Ok(new { level = "warn", message = "ไม่พบสินค้าที่ตรงกับคลังที่เลือก ไม่มีรายการใดถูกลบ" });
            return Ok(new { level = "ok", message = $"ลบสินค้าออกจากระบบแล้ว {res.Deleted.Count:N0} รายการ" + (res.Removed.Count > 0 ? $"\nเอาออกเฉพาะคลังที่เลือก (ยังอยู่คลังอื่น) {res.Removed.Count:N0} รายการ" : "") });
        }
        catch (Exception ex) { return Fail(ex, "ลบไม่สำเร็จ (ยกเลิกทั้งหมด ไม่มีรายการใดถูกลบ)"); }
    }
}
