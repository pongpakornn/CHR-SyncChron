using CIMS.Helpers;
using CIMS.Models;
using CIMS.Services;

namespace CHR.Synchron.Api.Web.Scanner;

// 📷 Multi-Scanner: ย้าย ScanInViewModel.ProcessScan / ProcessReturnScan มาไว้ฝั่ง Server (เงื่อนไขเดิมทุกข้อ ข้อความเดิม)
//    สิ่งที่ WPF เด้งหน้าต่างถาม (เลือกคลัง / กรอกจำนวนเศษ / กรอกจำนวนคืน) -> ตอบกลับ NeedStock / NeedQty
//    แล้ว Browser ส่งบาร์โค้ดเดิมซ้ำพร้อมคำตอบ (ChosenStockId / EnteredQty) - ก่อนถึงจุดที่ถามยังไม่มีการบันทึกอะไร จึงทำซ้ำได้ปลอดภัย
public sealed class ScanRequest
{
    public string Barcode { get; set; }
    public bool Out { get; set; }
    public bool Return { get; set; }
    public bool Remainder { get; set; }
    public bool Test { get; set; }
    public string EmployeeId { get; set; }
    public string Department { get; set; }
    public int? ChosenStockId { get; set; }
    public decimal? EnteredQty { get; set; }
    public string ClientScope { get; set; }
}

public sealed class ScanRowDto
{
    public int PartId { get; set; }
    public int StkId { get; set; }
    public string StockCode { get; set; }
    public string PartCode { get; set; }
    public string PartName { get; set; }
    public string PartACode { get; set; }
    public string Code { get; set; }          // CodeText (DISPLAY ของคลัง หรือรหัสสินค้า)
    public decimal Qty { get; set; }
    public string Status { get; set; }        // IN / OUT / RETURN / TEST
    public DateTime Time { get; set; }
    public bool IsDeductOut { get; set; }
    public string ImageUrl { get; set; }

    public static ScanRowDto From(ScanItemModel m) => new()
    {
        PartId = m.PartId, StkId = m.StkId, StockCode = m.StockCode, PartCode = m.PartCode, PartName = m.PartName,
        PartACode = m.PartACode, Code = m.CodeText, Qty = m.Qty, Status = m.Status, Time = m.UpdateTime, IsDeductOut = m.IsDeductOut,
        ImageUrl = m.PartId > 0 ? $"/api/images/part/{m.PartId}" : null
    };
}

public sealed class StockChoiceDto
{
    public int StkId { get; set; }
    public string Code { get; set; }
    public string Name { get; set; }
}

public sealed class ScanResult
{
    // Saved / Test / Error / Warning / Held / NeedStock / NeedQty / Locked / Denied / Ignored
    public string Kind { get; set; }
    public string Title { get; set; }
    public string Message { get; set; }
    public ScanRowDto Item { get; set; }
    public string Focus { get; set; }                 // employee / department
    public List<StockChoiceDto> Candidates { get; set; }
    public bool QtyDecimal { get; set; }
    [System.Text.Json.Serialization.JsonIgnore]
    public (string Title, string Message, bool Ok)? Toast { get; set; }
    public string ToastTitle => Toast?.Title;
    public string ToastMessage => Toast?.Message;
    public bool? ToastOk => Toast?.Ok;
    public bool RefreshDeduct { get; set; }

    public static ScanResult Err(string msg, string title = "ERROR") => new() { Kind = "Error", Title = title, Message = msg };
    public static ScanResult Warn(string msg, string title = "WARNING") => new() { Kind = "Warning", Title = title, Message = msg };
}

public sealed class ScanProcessor
{
    private readonly ScanService _scanService = new();
    private readonly ScannerScope _scope;
    private readonly UserSession _user;
    private readonly ScanRequest _req;
    private Dictionary<int, string> _displayMap;
    private List<BarcodeFormatModel> _displayFormats;
    private List<(BarcodeFormatModel Fmt, List<string> Codes, decimal? Qty)> _supplierHits = new();
    private string _lookupNote;

    // โหมดหลังปรับตามคลัง / สิทธิ์ (เหมือน setter ของ IsScanOutMode / IsReturnMode / IsRemainderMode)
    private bool IsScanOutMode, IsReturnMode, IsRemainderMode, IsTestMode;

    public ScanProcessor(ScannerScope scope, ScanRequest req)
    {
        _scope = scope; _user = scope.User; _req = req;
        var m = EffectiveModes(scope, req.Out, req.Return, req.Remainder, req.Test);
        IsScanOutMode = m.Out; IsReturnMode = m.Return; IsRemainderMode = m.Remainder; IsTestMode = m.Test;
    }

    public static (bool Out, bool Return, bool Remainder, bool Test) EffectiveModes(ScannerScope scope, bool isOut, bool isReturn, bool remainder, bool test)
    {
        if (scope.NotAssigned) return (false, false, false, false);
        if (scope.IsScanOutOnlyUser) isOut = true;
        // คืนเหล็กเป็นการรับเข้า ใช้พร้อมกับโหมดสแกนออกไม่ได้ (และคืนเหล็กกรอกจำนวนเองอยู่แล้ว ปิดโหมดเศษ)
        if (isReturn) { if (!scope.IsScanOutOnlyUser) isOut = false; remainder = false; }
        var list = scope.ScopeStocks;
        if (list.Count > 0)
        {
            bool anyIn = list.Any(s => s.CanScanIn), anyOut = list.Any(s => s.CanScanOut);
            if (!anyIn && anyOut) isOut = true;
            else if (!anyOut && isOut && !scope.IsScanOutOnlyUser) isOut = false;
            if (isReturn && !list.Any(ScannerScope.SupportsReturn)) isReturn = false;
        }
        if (isOut) isReturn = false;
        return (isOut, isReturn, remainder, test);
    }

    private string Uid => _user.UserId;
    private bool IsMultiScope => _scope.IsMultiScope;
    private StockModel SelectedStock => _scope.SelectedStock;
    private List<StockModel> ScopeStocks => _scope.ScopeStocks;
    private List<BarcodeFormatModel> _allFormats => _scope.Formats;
    private string LookupNoteText => string.IsNullOrEmpty(_lookupNote) ? "" : "\n" + _lookupNote;

    public ScanResult Process()
    {
        string inputCode = _req.Barcode;
        if (string.IsNullOrWhiteSpace(inputCode) || _user == null) return new ScanResult { Kind = "Ignored" };

        // 🔒 ยังไม่ได้กำหนดคลังสแกน -> ไม่บันทึกอะไร แจ้งให้ติดต่อ Admin
        if (_scope.NotAssigned)
            return new ScanResult { Kind = "Locked", Title = "NO SCAN STOCK", Message = ScannerSetupService.WithContacts($"ยังไม่ได้กำหนดคลังสแกนให้ {Uid}\nกรุณาติดต่อ Admin") };

        if (IsReturnMode)
        {
            if (!IsTestMode && !_user.CanScanReturn)
                return new ScanResult { Kind = "Denied", Title = "ACCESS DENIED", Message = "คุณไม่มีสิทธิ์รับคืน (ใช้ได้เฉพาะ TEST MODE)" };
            return ProcessReturnScan(inputCode);
        }

        // 🔐 VIEW อย่างเดียวสแกนจริงไม่ได้ (TEST MODE ได้)
        if (!IsTestMode && !(IsScanOutMode ? _user.CanViewScanOut : _user.CanViewScanIn))
            return new ScanResult { Kind = "Denied", Title = "ACCESS DENIED", Message = IsScanOutMode ? "คุณไม่มีสิทธิ์สแกนออก (ใช้ได้เฉพาะ TEST MODE)" : "คุณไม่มีสิทธิ์สแกนเข้า (ใช้ได้เฉพาะ TEST MODE)" };

        string finalSearchCode = inputCode.Trim();
        string rawBarcodeFull = finalSearchCode;
        string uid = Uid;

        bool isOut = IsScanOutMode;
        bool multiScope = IsMultiScope;
        var stock = SelectedStock;
        if (stock == null && !multiScope)
            return ScanResult.Warn("กรุณาเลือกคลัง (STOCK) ก่อนแสกน");

        // ✅ QR ที่พิมพ์จากหน้า Pick List (TicketNo | MaterialCode | WorkOrder | LotNo | JobName | Qty)
        bool isPackingCardScan = PackingCardBarcodeParser.TryParse(finalSearchCode, out string packingMaterialCode, out decimal packingQty);

        // ✅ ป้าย Supplier ตามรูปแบบที่ตั้งไว้ใน CIMS.BarcodeFormats
        List<string> supplierCodes = null;
        decimal? supplierQty = null;
        BarcodeFormatModel supplierFmt = null;
        string supplierRaw = finalSearchCode;
        if (!isPackingCardScan)
            supplierFmt = MatchSupplier(finalSearchCode, multiScope ? null : stock, out supplierCodes, out supplierQty, !isOut);
        bool isSupplierScan = supplierFmt != null;

        if (isPackingCardScan) finalSearchCode = packingMaterialCode;
        else if (isSupplierScan) finalSearchCode = supplierCodes[0];
        else finalSearchCode = SysQrCode(finalSearchCode, multiScope ? null : stock);   // ▣ QR ระบบ

        // ⏸ ป้ายที่ต้องตัดคลังต้นทาง: ค้างอยู่ใน NOT DEDUCTED แล้ว = ไม่รับซ้ำ / สินค้ายังไม่ลงทะเบียน = เก็บเป็น NOT DEDUCTED
        if (isSupplierScan && !isOut && !IsTestMode && !IsRemainderMode && DbSchema.HasMissStatus && DeductSourceFor(supplierFmt) is int holdSrc)
        {
            string cNo = null, mom = null;
            CoilFormatFor(supplierFmt)?.ReadCoil(supplierRaw, out cNo, out mom);
            if (_scanService.HasPendingMiss(cNo, rawBarcodeFull))
                return ScanResult.Err($"ป้ายนี้ค้างอยู่ที่ NOT DEDUCTED แล้ว (รอดำเนินการ)\nรอผู้มีสิทธิ์ APPROVE ของ Multi-Scanner\n\nCode: {rawBarcodeFull}");
            var known = FindPartByCodes(supplierFmt, supplierCodes);
            if (known == null)
            {
                var target = multiScope ? ScopeStocks.FirstOrDefault(s => s.StkId != holdSrc && s.InSupplier && StockAcceptsLabel(s, supplierFmt)) : stock;
                if (target != null && target.StkId != holdSrc)
                {
                    decimal q = Qty.Round(supplierQty ?? 0, target.AllowDecimal);
                    var lbl = new ScanService.CoilLabel { CoilNo = cNo, MotherCoil = mom };
                    _scanService.AddPendingMiss(target.StkId, holdSrc, null, lbl, q, 0, "NO_PRODUCT", rawBarcodeFull, uid, supplierFmt.FmtId);
                    LogService.WriteLog(uid, "NOT_DEDUCTED_PENDING", $"{target.Code} | NO PRODUCT | Coil {cNo} | Master {mom} | Label {Qty.Plain(q)} | {rawBarcodeFull}", supplierCodes.FirstOrDefault());
                    return new ScanResult
                    {
                        Kind = "Held", Title = "NOT DEDUCTED", RefreshDeduct = true,
                        Message = $"⏸ ยังไม่รับเข้า {target.Code}\nไม่พบ PD CODE ของป้ายนี้ในระบบ\n\nเก็บไว้ที่ NOT DEDUCTED (รอดำเนินการ) แล้ว\nรอผู้มีสิทธิ์ APPROVE ของ Multi-Scanner ลงทะเบียน / รับเข้า\n\nCode: {rawBarcodeFull}"
                    };
                }
            }
        }

        // 🏬 สแกนร่วมหลายคลัง / AUTO: ระบบหาคลังของสินค้านี้เอง (ถามให้เลือกถ้าอยู่หลายคลัง)
        if (multiScope)
        {
            var codes = isSupplierScan ? supplierCodes : new List<string> { finalSearchCode };
            var resolved = ResolveStock(isOut, isPackingCardScan, supplierFmt, codes, rawBarcodeFull, out var stop);
            if (stop != null) return stop;
            stock = resolved;
        }

        // 🏷️ หลายรูปแบบในคลังเดียว: ใช้รูปแบบที่ผูกกับคลังนี้
        if (isSupplierScan)
        {
            FormatForStock(stock, ref supplierFmt, ref supplierCodes, ref supplierQty);
            finalSearchCode = supplierCodes[0];
        }

        // 🚦 ตรวจช่องทางแสกนตามการตั้งค่าคลัง
        string channelError = CheckChannel(stock, isOut, isPackingCardScan, supplierFmt);
        if (channelError != null) return ScanResult.Err(channelError + $"\n\nCode: {rawBarcodeFull}");

        // 👷 EMPLOYEE ID / DEPARTMENT
        string whoError = CheckWho(stock, out ScanService.ScanWho who, out string focus);
        if (whoError != null)
        {
            var w = ScanResult.Warn(whoError + $"\n\nCode: {rawBarcodeFull}", "EMPLOYEE / DEPARTMENT");
            w.Focus = focus;
            return w;
        }

        // 🧲 ทะเบียน Coil: เลข Coil ลูก / แม่ จากป้าย + กันสแกนลูกเดิมซ้ำ
        ScanService.CoilLabel coil = null;
        var coilFmt = isSupplierScan ? CoilFormatFor(supplierFmt) : null;
        if (isSupplierScan && stock.CountCoil && coilFmt != null)
        {
            coilFmt.ReadCoil(supplierRaw, out string coilNo, out string mother);
            coil = new ScanService.CoilLabel { CoilNo = coilNo, MotherCoil = mother };
            if (coil.HasCoilNo && !IsRemainderMode)
            {
                var st = _scanService.FindCoil(coil.CoilNo);
                string err = null;
                if (!isOut && st != null && st.Status == "IN" && st.StockId == stock.StkId)
                    err = $"Coil {coil.CoilNo} อยู่ในคลัง {stock.Code} แล้ว (สแกนซ้ำ) - ไม่บันทึก";
                else if (isOut && st != null && st.Status == "OUT")
                    err = $"Coil {coil.CoilNo} จ่ายออกไปแล้ว - ไม่บันทึก";
                else if (isOut && st != null && st.Status == "IN" && st.StockId != stock.StkId)
                    err = $"Coil {coil.CoilNo} อยู่ที่คลัง {st.StockCode} ไม่ใช่คลัง {stock.Code} - ไม่บันทึก";
                if (err != null) return ScanResult.Err(err + $"\n\nCode: {rawBarcodeFull}");
            }
        }

        ScanService.DeductResult deductResult = null;
        bool remainder = IsRemainderMode;

        _lookupNote = null;
        var part = isSupplierScan ? FindPartByCodes(supplierFmt, supplierCodes) : _scanService.GetPartByScan(finalSearchCode);
        ScanItemModel result = null;
        if (part != null)
        {
            bool dec = stock.AllowDecimal;
            decimal originalQty = Qty.Round(isPackingCardScan ? packingQty
                            : (isSupplierScan && supplierQty.HasValue) ? supplierQty.Value
                            : part.Qty, dec);

            // 🔢 สแกนเศษ: กรอกจำนวนเอง (ไม่ใช้ Pack Size / จำนวนบนป้าย) และไม่นับกล่อง
            if (remainder)
            {
                if (_req.EnteredQty == null)
                    return new ScanResult
                    {
                        Kind = "NeedQty", Title = "REMAINDER QTY", QtyDecimal = dec,
                        Message = $"{(isOut ? "สแกนออก (เศษ)" : "สแกนเข้า (เศษ)")}  •  {stock.Code}\n{part.PartCode}  {part.PartName}\n\nกรอกจำนวนเศษ (Pack Size {Qty.Plain(originalQty)})",
                        Candidates = new List<StockChoiceDto> { new() { StkId = stock.StkId, Code = stock.Code, Name = stock.Name } }
                    };
                if (_req.EnteredQty.Value <= 0) return new ScanResult { Kind = "Ignored" };   // กดยกเลิก = ไม่บันทึก ไม่แจ้ง error
                originalQty = Qty.Round(_req.EnteredQty.Value, dec);
            }

            // 🛑 จำนวน 0 -> ไม่บันทึก
            if (originalQty <= 0)
                return ScanResult.Err($"[ไม่บันทึก] จำนวนเป็น 0\n{part.PartCode}  {part.PartName}\n(Pack Size = 0 หรือป้ายอ่านได้ไม่ครบ - กรุณาแสกนใหม่)\n\nCode: {rawBarcodeFull}");

            if (IsTestMode)
            {
                part.Qty = originalQty;
                result = part;
            }
            else
            {
                int? deductFrom = isSupplierScan ? DeductSourceFor(supplierFmt) : null;
                bool useDeduct = !isOut && deductFrom.HasValue && deductFrom.Value != stock.StkId;
                bool isSaved;
                if (useDeduct)
                {
                    deductResult = _scanService.UpdateStockWithDeduct(part.PartId, part.PartCode, part.PartACode, originalQty, uid, rawBarcodeFull, stock, deductFrom.Value, remainder, coil,
                                                                      holdPending: DbSchema.HasMissStatus, formatId: supplierFmt?.FmtId, who: who);
                    isSaved = deductResult.Saved;
                    if (deductResult.Held) { part.Qty = originalQty; result = part; isSaved = false; }
                }
                else
                {
                    isSaved = isOut
                        ? _scanService.UpdateStockOut(part.PartId, part.PartCode, part.PartACode, originalQty, uid, rawBarcodeFull, stock, remainder, coil, who)
                        : _scanService.UpdateStock(part.PartId, part.PartCode, part.PartACode, originalQty, uid, rawBarcodeFull, "IN", stock, remainder, coil, who);
                }
                if (isSaved)
                {
                    string logRef = stock.IsMain ? rawBarcodeFull : $"{rawBarcodeFull} | STOCK: {stock.Code}";
                    if (remainder) logRef += " | REMAINDER";
                    if (deductResult != null)
                        logRef += $" | DEDUCT {deductResult.SourceCode}{(deductResult.MatchedByBin ? $" ({deductResult.SourcePartCode} {deductResult.MatchedHow})" : "")}: {deductResult.Deducted} (bal {deductResult.SourceBefore}->{deductResult.SourceAfter})";
                    if (coil?.HasCoilNo == true) logRef += $" | COIL {coil.CoilNo}";
                    if (who != null) logRef += who.LogText;
                    LogService.WriteScanLog(uid, isOut ? "SCAN_OUT" : "SCAN_IN", part.PartCode, part.PartACode, originalQty, logRef);
                    part.Qty = originalQty;
                    result = part;
                }
            }
        }

        // ⏸ ตัด Master Coil ในคลังต้นทางไม่ได้ / ไม่ครบ -> ไม่รับเข้า ค้างไว้ที่ NOT DEDUCTED
        if (deductResult?.Held == true && result != null)
        {
            string why = deductResult.MatchedHow == null
                ? $"ไม่พบ Master Coil {deductResult.MotherCoil} ใน {deductResult.SourceCode}"
                : $"Master Coil {deductResult.MotherCoil} ใน {deductResult.SourceCode} เหลือ {Qty.Plain(deductResult.MotherBefore ?? deductResult.SourceBefore)} KG (ป้าย {Qty.Plain(deductResult.RequestedQty)} KG)";
            LogService.WriteLog(uid, "NOT_DEDUCTED_PENDING", $"{stock.Code} <- {deductResult.SourceCode} | Coil {coil?.CoilNo} | {why} | {rawBarcodeFull}", result.PartCode);
            return new ScanResult
            {
                Kind = "Held", Title = "NOT DEDUCTED", RefreshDeduct = true,
                Message = $"⏸ ยังไม่รับเข้า {stock.Code}\n{why}\n\n{result.PartCode}  Coil {coil?.CoilNo}\nจำนวนบนป้าย: {Qty.Plain(deductResult.RequestedQty)}\n\nเก็บไว้ที่ NOT DEDUCTED (รอดำเนินการ) แล้ว\nรอผู้มีสิทธิ์ APPROVE ของ Multi-Scanner"
            };
        }

        if (result == null)
        {
            return isOut
                ? ScanResult.Err($"[ระงับการทำรายการ] ไม่พบข้อมูลสินค้า หรือ สินค้าในระบบไม่เพียงพอสำหรับจ่ายออก (คลัง {stock.Code} มีไม่พอ)\nCode: {finalSearchCode}{LookupNoteText}")
                : ScanResult.Err($"[รายการไม่สำเร็จ] ไม่พบข้อมูลสินค้าในระบบ หรือบาร์โค้ดยังไม่ได้ลงทะเบียน\nCode: {finalSearchCode}{LookupNoteText}");
        }

        var newItem = NewItem(result, stock, IsTestMode ? "TEST" : (isOut ? "OUT" : "IN"), rawBarcodeFull);
        var res = new ScanResult { Kind = IsTestMode ? "Test" : "Saved", Item = ScanRowDto.From(newItem) };

        // ⚠ / ✅ ผลการตัดคลังต้นทาง
        if (deductResult != null && deductResult.Short && deductResult.MotherCoil != null)
        {
            string why = deductResult.MatchedHow == null
                ? $"ไม่พบ Master Coil {deductResult.MotherCoil} ใน {deductResult.SourceCode}\n(ยังไม่ได้ลงทะเบียน หรือใช้หมดแล้ว) จึงไม่ได้ตัดยอด"
                : $"Master Coil {deductResult.MotherCoil} ใน {deductResult.SourceCode} เหลือ {Qty.Plain(deductResult.MotherBefore ?? deductResult.SourceBefore)} KG\nตัดได้ {Qty.Plain(deductResult.Deducted)} KG";
            res.Title = "MASTER COIL";
            res.Message = $"{why}\n\n{result.PartCode}  Coil {coil?.CoilNo}\nจำนวนบนป้าย: {Qty.Plain(deductResult.RequestedQty)}\n\n" +
                          $"รับเข้า {stock.Code} เต็มจำนวนแล้ว กรุณาตรวจสอบ {deductResult.SourceCode}" +
                          (DbSchema.HasDeductMisses ? "\nเก็บไว้ที่ปุ่ม NOT DEDUCTED แล้ว" : "");
            res.Kind = "SavedWarning";
            LogService.WriteLog(uid, "NOT_DEDUCTED",
                $"{stock.Code} <- {deductResult.SourceCode} | Coil {coil?.CoilNo} | Master {deductResult.MotherCoil} | Label {Qty.Plain(deductResult.RequestedQty)} | Cut {Qty.Plain(deductResult.Deducted)} | " +
                (deductResult.MatchedHow == null ? "master coil not found" : $"master coil had {Qty.Plain(deductResult.MotherBefore ?? 0)}"), result.PartCode);
            res.RefreshDeduct = true;
        }
        else if (deductResult != null && !deductResult.Short && deductResult.Deducted > 0)
        {
            string from = deductResult.MatchedHow == "MASTER COIL" && deductResult.MotherBefore.HasValue
                ? $"Master Coil {deductResult.MotherCoil}  {Qty.Plain(deductResult.MotherBefore.Value)} → {Qty.Plain(deductResult.MotherBefore.Value - deductResult.Deducted)} KG"
                : deductResult.MatchedHow == "COIL" ? $"ย้าย Coil {coil?.CoilNo} ออกจาก {deductResult.SourceCode}"
                : $"{deductResult.SourcePartCode}";
            res.Toast = ($"OUT {deductResult.SourceCode}  -{Qty.Plain(deductResult.Deducted)} KG", $"{from}\n{deductResult.SourcePartCode}  คงเหลือ {Qty.Plain(deductResult.SourceAfter)}", true);
            LogService.WriteLog(uid, "DEDUCT_SOURCE",
                $"{stock.Code} <- {deductResult.SourceCode} -{Qty.Plain(deductResult.Deducted)} | Coil {coil?.CoilNo} | {from} | {deductResult.SourcePartCode} balance {Qty.Plain(deductResult.SourceAfter)}", deductResult.SourcePartCode);
            res.RefreshDeduct = true;
        }
        else if (deductResult != null && deductResult.Short)
        {
            res.Kind = "SavedWarning";
            res.Title = "SOURCE STOCK SHORT";
            res.Message = $"ยอดใน {deductResult.SourceCode} ไม่พอสำหรับรายการนี้\n\n" +
                          $"{result.PartCode}\nจำนวนบนป้าย: {Qty.Plain(deductResult.RequestedQty)}\n" +
                          $"มีใน {deductResult.SourceCode}: {Qty.Plain(deductResult.SourceBefore)}  (ตัดได้ {Qty.Plain(deductResult.Deducted)})\n\n" +
                          $"รับเข้า {stock.Code} เต็มจำนวน {Qty.Plain(deductResult.RequestedQty)} แล้ว กรุณาตรวจสอบยอด {deductResult.SourceCode}";
        }
        return res;
    }

    // 🔄 โหมดคืนเหล็ก
    private ScanResult ProcessReturnScan(string inputCode)
    {
        string rawBarcodeFull = inputCode.Trim();
        string uid = Uid;
        var stock = SelectedStock;
        if (stock == null && !IsMultiScope) return ScanResult.Warn("กรุณาเลือกคลัง (STOCK) ก่อนแสกน");

        var codes = ExtractReturnScanCodes(rawBarcodeFull, out BarcodeFormatModel matchedFmt);
        string code = codes[0];

        if (stock == null)
        {
            var resolved = ResolveStock(false, false, matchedFmt, codes, rawBarcodeFull, out var stop);
            if (stop != null) return stop;
            stock = resolved;
        }

        string channelError = CheckChannel(stock, false, false, matchedFmt);
        if (channelError != null) return ScanResult.Err(channelError + $"\n\nCode: {rawBarcodeFull}");

        string whoError = CheckWho(stock, out ScanService.ScanWho who, out string focus);
        if (whoError != null)
        {
            var w = ScanResult.Warn(whoError + $"\n\nCode: {rawBarcodeFull}", "EMPLOYEE / DEPARTMENT");
            w.Focus = focus;
            return w;
        }

        var part = FindPartByCodes(matchedFmt, codes);
        if (part == null) return ScanResult.Err($"[รายการไม่สำเร็จ] ไม่พบข้อมูลสินค้าในระบบสำหรับคืนเหล็ก\nCode: {code}{LookupNoteText}");

        if (_req.EnteredQty == null)
            return new ScanResult
            {
                Kind = "NeedQty", Title = "คืนเหล็กเข้าคลัง", QtyDecimal = stock.AllowDecimal,
                Message = $"{part.PartName}\nProduct Code: {part.PartCode}\n\nกรุณากรอกจำนวนที่รับคืนเข้าคลัง",
                Candidates = new List<StockChoiceDto> { new() { StkId = stock.StkId, Code = stock.Code, Name = stock.Name } }
            };
        if (_req.EnteredQty.Value <= 0) return new ScanResult { Kind = "Ignored" };
        decimal qty = Qty.Round(_req.EnteredQty.Value, stock.AllowDecimal);

        if (!IsTestMode)
        {
            bool isSaved = _scanService.UpdateStock(part.PartId, part.PartCode, part.PartACode, qty, uid, rawBarcodeFull, "RETURN", stock, who: who);
            if (!isSaved) return ScanResult.Err("บันทึกการคืนเหล็กไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
            string returnRef = ((stock.IsMain ? "" : $"STOCK: {stock.Code}") + (who?.LogText ?? "")).TrimStart(' ', '|');
            LogService.WriteScanLog(uid, "SCAN_RETURN", part.PartCode, part.PartACode, qty, returnRef.Length == 0 ? null : returnRef);
        }

        part.Qty = qty;
        var item = NewItem(part, stock, IsTestMode ? "TEST" : "RETURN", inputCode);
        return new ScanResult { Kind = IsTestMode ? "Test" : "Saved", Item = ScanRowDto.From(item) };
    }

    private ScanItemModel NewItem(ScanItemModel result, StockModel stock, string status, string raw)
    {
        var item = new ScanItemModel
        {
            PartId = result.PartId, PartCode = result.PartCode, PartName = result.PartName, PartNo = result.PartNo, PartACode = result.PartACode,
            Qty = result.Qty, StkId = stock.StkId, StockCode = stock.Code, ShowStockInCode = IsMultiScope, Status = status, UpdateTime = DateTime.Now
        };
        ApplyDisplay(item, raw, fetchInfo: true);
        return item;
    }

    // ---------------------------------------------------------------- DISPLAY
    private void EnsureDisplay()
    {
        if (_displayMap != null) return;
        _displayMap = _scanService.GetScanDisplayMap(Uid);
        _displayFormats = _displayMap.Values.Any(v => v.StartsWith("FIELD:")) ? new StockService().GetFormats() : new List<BarcodeFormatModel>();
    }

    private void ApplyDisplay(ScanItemModel item, string raw, bool fetchInfo)
    {
        EnsureDisplay();
        if (item == null || !_displayMap.TryGetValue(item.StkId, out string key)) { if (item != null) item.DisplayCode = null; return; }
        if (!string.IsNullOrEmpty(raw)) item.RefNo = raw;
        if (fetchInfo && (key == "PartA" || key == "PartNumber" || key == "Model") && item.PartA == null && item.PartId > 0)
        {
            var info = _scanService.GetPartDisplayInfo(item.PartId);
            item.PartA = info.PartA; item.PartNumber = info.PartNumber; item.Model = info.Model;
        }
        string v = ScanDisplay.Resolve(key, item.PartCode, item.PartA, item.PartNumber, item.Model, item.PartName, item.RefNo, _displayFormats);
        item.DisplayCode = string.IsNullOrWhiteSpace(v) ? null : v;
    }

    // ---------------------------------------------------------------- เงื่อนไขเดิม (ScanInViewModel)
    private string CheckWho(StockModel stock, out ScanService.ScanWho who, out string focus)
    {
        who = null; focus = null;
        if (stock == null || IsTestMode) return null;
        bool emp = _scope.AskEmployee.Contains(stock.StkId), dept = _scope.AskDepartment.Contains(stock.StkId);
        if (!emp && !dept) return null;
        if (emp && string.IsNullOrWhiteSpace(_req.EmployeeId))
        {
            focus = "employee";
            return $"กรุณากรอก EMPLOYEE ID (รหัสพนักงาน) ก่อนสแกน\nคลัง {stock.Code} ต้องบันทึกรหัสพนักงานของคนที่สแกน";
        }
        if (dept)
        {
            var departments = new ScannerSetupService().GetDepartments();
            if (string.IsNullOrWhiteSpace(_req.Department) || !departments.Contains(_req.Department))
            {
                focus = "department";
                return departments.Count == 0
                    ? ScannerSetupService.WithContacts($"คลัง {stock.Code} ต้องเลือก DEPARTMENT แต่ยังไม่มีรายการแผนก\nกรุณาติดต่อ Admin (User Management > SETUP > DEPARTMENTS)")
                    : $"กรุณาเลือก DEPARTMENT (แผนก) ก่อนสแกน\nคลัง {stock.Code} ต้องบันทึกแผนกของคนที่สแกน";
            }
        }
        who = new ScanService.ScanWho { EmployeeId = emp ? _req.EmployeeId.Trim() : null, Department = dept ? _req.Department : null };
        return null;
    }

    private StockModel ResolveStock(bool isOut, bool isPickList, BarcodeFormatModel supplierFmt, List<string> codes, string rawBarcode, out ScanResult stop)
    {
        stop = null;
        var part = FindPartByCodes(supplierFmt, codes);
        if (part == null)
        {
            stop = ScanResult.Err($"[รายการไม่สำเร็จ] ไม่พบข้อมูลสินค้าในระบบ หรือบาร์โค้ดยังไม่ได้ลงทะเบียน\nCode: {codes.FirstOrDefault()}{LookupNoteText}");
            return null;
        }

        var memberIds = _scanService.GetPartStockIds(part.PartId);
        var scope = ScopeStocks;
        var candidates = scope.Where(s => memberIds.Contains(s.StkId)
                                       && (isOut ? s.CanScanOut : s.CanScanIn)
                                       && CheckChannel(s, isOut, isPickList, supplierFmt) == null).ToList();

        int? deductSrc = DeductSourceFor(supplierFmt);
        if (!isOut && deductSrc != null && candidates.Count > 1)
            candidates.RemoveAll(s => s.StkId == deductSrc.Value);

        if (candidates.Count == 0)
        {
            var inStocks = scope.Where(s => memberIds.Contains(s.StkId)).Select(s => s.Code).ToList();
            string where = inStocks.Count == 0
                ? "สินค้านี้ไม่ได้อยู่ในคลังที่เลือกไว้"
                : $"สินค้านี้อยู่ในคลัง {string.Join(", ", inStocks)} แต่คลังนั้นไม่ได้เปิดให้{(isOut ? "จ่ายออก" : "รับเข้า")}ด้วยป้าย/QR แบบนี้";
            stop = ScanResult.Err($"[ระงับการทำรายการ] ไม่พบคลังที่{(isOut ? "จ่ายออก" : "รับเข้า")}รายการนี้ได้\n\n{where}\n\n{part.PartCode} - {part.PartName}\nCode: {rawBarcode}");
            return null;
        }

        if (candidates.Count == 1) return candidates[0];

        if (isOut && _scope.PriorityId.HasValue)
        {
            var first = candidates.FirstOrDefault(s => s.StkId == _scope.PriorityId.Value);
            if (first != null) return first;
        }

        // ผู้ใช้เลือกคลังมาแล้ว (ต้องอยู่ในรายการที่เลือกได้เท่านั้น)
        if (_req.ChosenStockId.HasValue)
        {
            var chosen = candidates.FirstOrDefault(s => s.StkId == _req.ChosenStockId.Value);
            if (chosen != null) return chosen;
        }

        stop = new ScanResult
        {
            Kind = "NeedStock",
            Title = isOut ? "SELECT STOCK ( OUT )" : "SELECT STOCK ( IN )",
            Message = $"{part.PartCode}  •  {part.PartName}\nสินค้านี้อยู่หลายคลัง กรุณาเลือกคลังที่จะ{(isOut ? "จ่ายออก" : "รับเข้า")}",
            Candidates = candidates.Select(s => new StockChoiceDto { StkId = s.StkId, Code = s.Code, Name = s.Name }).ToList()
        };
        return null;
    }

    private List<string> ExtractReturnScanCodes(string raw, out BarcodeFormatModel matchedFmt)
    {
        matchedFmt = null;
        if (string.IsNullOrWhiteSpace(raw)) return new List<string> { string.Empty };
        matchedFmt = MatchSupplier(raw, SelectedStock, out List<string> codes, out _);
        if (matchedFmt != null) return codes;
        string trimmed = raw.Trim();
        return new List<string> { trimmed.IndexOf(QrFormat.Sep) >= 0 ? SysQrCode(trimmed, SelectedStock) : trimmed };
    }

    // ▣ QR ระบบ: รูปแบบที่ 2 ต่อคลัง (CIMS.ProductControlSettings.QrFields) - เก็บไว้ 30 วินาทีเหมือนเดิม
    private static Dictionary<int, ProductControlLayout> _qrLayouts;
    private static DateTime _qrLayoutsAt;
    private static readonly object _qrLock = new();
    private static Dictionary<int, ProductControlLayout> QrLayouts()
    {
        lock (_qrLock)
        {
            if (_qrLayouts == null || (DateTime.Now - _qrLayoutsAt).TotalSeconds > 30)
            {
                try { _qrLayouts = new ProductControlLayoutService().GetAll(); }
                catch { _qrLayouts ??= new Dictionary<int, ProductControlLayout>(); }
                _qrLayoutsAt = DateTime.Now;
            }
            return _qrLayouts;
        }
    }

    private string SysQrCode(string raw, StockModel stock)
    {
        string t = (raw ?? "").Trim();
        string Legacy(string s)
        {
            var parts = s.Split(new[] { '|', ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0) return s;
            string first = parts[0].Trim();
            return first.Length > 2 && char.IsDigit(first[0]) && char.IsLetter(first[1]) ? first.Substring(1) : first;
        }
        if (t.IndexOf(QrFormat.Sep) < 0) return Legacy(t);

        var fields = t.Split(QrFormat.Sep).Select(x => x.Trim()).ToArray();
        var lay = QrLayouts();
        var ids = stock != null ? new List<int> { stock.StkId } : ScopeStocks.Select(s => s.StkId).ToList();
        ids.Add(0);
        var idx = new List<int>();
        foreach (int id in ids)
            if (lay.TryGetValue(id, out var l)) { int i = QrFormat.CodeIndex(l.QrFields); if (!idx.Contains(i)) idx.Add(i); }
        if (!idx.Contains(0)) idx.Add(0);
        idx = idx.Where(i => i < fields.Length && fields[i].Length > 0).ToList();
        if (idx.Count == 0) return Legacy(t);
        if (idx.Count == 1) return idx[0] == 0 ? Legacy(t) : fields[idx[0]];

        try
        {
            var found = new ProductControlLayoutService().ExistingCodes(idx.Select(i => fields[i]));
            foreach (int i in idx) if (found.Contains(fields[i])) return fields[i];
        }
        catch { }
        return idx[0] == 0 ? Legacy(t) : fields[idx[0]];
    }

    public static string CheckChannel(StockModel stock, bool isOut, bool isPickList, BarcodeFormatModel supplierFmt,
                                      Func<StockModel, BarcodeFormatModel, bool> acceptsLabel)
    {
        string dir = isOut ? "จ่ายออก" : "รับเข้า";
        if (stock.IsLiveView)
            return $"คลัง {stock.Code} ไม่เปิดให้สแกน{dir}ใน CIMS ชั่วคราว\n{StockModel.LiveViewMessage}";
        if (isPickList)
            return (isOut ? stock.OutPickList : stock.InPickList) ? null : $"คลัง {stock.Code} ไม่ได้เปิดให้{dir}ด้วย Pick List QR";
        if (supplierFmt != null)
        {
            if (!(isOut ? stock.OutSupplier : stock.InSupplier))
                return $"คลัง {stock.Code} ไม่ได้เปิดให้{dir}ด้วยป้าย Supplier ({supplierFmt.Name})";
            if (!acceptsLabel(stock, supplierFmt))
                return $"คลัง {stock.Code} ไม่รองรับป้าย Supplier รูปแบบ {supplierFmt.Name}";
            return null;
        }
        return (isOut ? stock.OutSysQr : stock.InSysQr) ? null : $"คลัง {stock.Code} ไม่ได้เปิดให้{dir}ด้วย QR ระบบ";
    }

    private string CheckChannel(StockModel stock, bool isOut, bool isPickList, BarcodeFormatModel supplierFmt) =>
        CheckChannel(stock, isOut, isPickList, supplierFmt, StockAcceptsLabel);

    private ScanItemModel FindPartByCodes(BarcodeFormatModel fmt, List<string> codes)
    {
        var part = _scanService.FindPart(fmt, codes, out string note, PreferStocks(SelectedStock));
        _lookupNote = note;
        return part;
    }

    private List<int> PreferStocks(StockModel stock)
    {
        if (stock != null) return new List<int> { stock.StkId };
        var sources = new HashSet<int>(_allFormats.Where(f => f.SourceStkId.HasValue).Select(f => f.SourceStkId.Value));
        return ScopeStocks.Where(s => !sources.Contains(s.StkId)).Select(s => s.StkId).ToList();
    }

    private BarcodeFormatModel MatchSupplier(string raw, StockModel stock, out List<string> codes, out decimal? qty, bool receiving = false)
    {
        codes = null; qty = null;
        var linked = stock != null ? new HashSet<int>(stock.FormatIds) : new HashSet<int>(ScopeStocks.SelectMany(s => s.FormatIds));
        var ordered = _allFormats.OrderBy(f => linked.Contains(f.FmtId) ? 0 : 1).ToList();
        var hits = new List<(BarcodeFormatModel Fmt, List<string> Codes, decimal? Qty)>();
        foreach (var fmt in ordered)
            if (fmt.TryParse(raw, out List<string> c, out decimal? q)) hits.Add((fmt, c, q));
        _supplierHits = hits;
        if (hits.Count == 0) return null;

        var pick = hits[0];
        if (hits.Count > 1)
        {
            var prefer = PreferStocks(stock);
            var found = hits.Select(h => (Hit: h, Part: _scanService.FindPart(h.Fmt, h.Codes, out _, prefer))).Where(x => x.Part != null).ToList();
            if (found.Count > 0)
            {
                pick = found[0].Hit;
                if (receiving && found.Count > 1)
                {
                    var sources = new HashSet<int>(hits.Where(h => h.Fmt.SourceStkId.HasValue).Select(h => h.Fmt.SourceStkId.Value));
                    var scope = stock != null ? new List<StockModel> { stock } : ScopeStocks;
                    var receiveIds = new HashSet<int>(scope.Where(s => !sources.Contains(s.StkId)).Select(s => s.StkId));
                    foreach (var x in found)
                        if (_scanService.GetPartStockIds(x.Part.PartId).Overlaps(receiveIds)) { pick = x.Hit; break; }
                }
            }
        }
        codes = pick.Codes; qty = pick.Qty;
        return pick.Fmt;
    }

    private void FormatForStock(StockModel stock, ref BarcodeFormatModel fmt, ref List<string> codes, ref decimal? qty)
    {
        if (stock == null || fmt == null || stock.FormatIds.Contains(fmt.FmtId)) return;
        var mine = _supplierHits.Where(h => stock.FormatIds.Contains(h.Fmt.FmtId)).ToList();
        if (mine.Count == 0) return;
        var prefer = new List<int> { stock.StkId };
        var withPart = mine.Select(h => (Hit: h, Part: _scanService.FindPart(h.Fmt, h.Codes, out _, prefer))).Where(x => x.Part != null).ToList();
        var inStock = withPart.FirstOrDefault(x => _scanService.GetPartStockIds(x.Part.PartId).Contains(stock.StkId));
        var pick = inStock.Hit.Fmt != null ? inStock.Hit : withPart.Count > 0 ? withPart[0].Hit : mine[0];
        fmt = pick.Fmt; codes = pick.Codes; qty = pick.Qty;
    }

    private int? DeductSourceFor(BarcodeFormatModel fmt) =>
        fmt?.SourceStkId ?? _supplierHits.Select(h => h.Fmt.SourceStkId).FirstOrDefault(s => s.HasValue);

    private BarcodeFormatModel CoilFormatFor(BarcodeFormatModel fmt) =>
        fmt != null && (fmt.HasCoilNo || fmt.MotherCoilPos > 0) ? fmt
        : _supplierHits.Select(h => h.Fmt).FirstOrDefault(f => f.HasCoilNo || f.MotherCoilPos > 0);

    private bool StockAcceptsLabel(StockModel stock, BarcodeFormatModel fmt) =>
        stock.FormatIds.Contains(fmt.FmtId) || _supplierHits.Any(h => stock.FormatIds.Contains(h.Fmt.FmtId));
}
