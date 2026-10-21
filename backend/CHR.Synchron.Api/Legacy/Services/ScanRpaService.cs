using ClosedXML.Excel;
using CIMS.Core;
using CIMS.Helpers;
using Microsoft.Data.SqlClient;
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace CIMS.Services
{
    // 🤖 EXPORT RPA ของ Multi-Scanner (HISTORY > EXPORT > EXPORT RPA) - ตั้งที่ User Management > SETUP > EXCEL SETUP > MULTI-SCANNER
    //   CIMS.ScanRpaLayouts (Update_20261020b.sql) ต่อคลัง: ไฟล์ Excel + ช่องที่ลงข้อมูล (รูปแบบเดียวกับ PR: H = เซลล์เดียว / T = คอลัมน์ตาราง)
    //   WriteMode APPEND = ต่อท้ายแถวสุดท้ายของชีท / SHEET = คัดลอกชีท Template เป็นชีทใหม่ (ชื่อตาม SheetName) แล้วลงข้อมูลในชีทใหม่
    //   DateMode  PICK = กด EXPORT RPA แล้วเลือกวัน / TODAY = วันนี้เสมอ / FILTER = ช่วงวันที่ของหน้าต่าง HISTORY
    public class ScanRpaLayout
    {
        public int StockId { get; set; }
        public string Path { get; set; }
        public int StartRow { get; set; } = 2;
        public List<PRExcelEntry> Entries { get; set; } = new List<PRExcelEntry>();
        public string WriteMode { get; set; } = "APPEND";
        public string TemplateSheet { get; set; }
        public string SheetName { get; set; } = "RPA {DATE}";
        public string DateMode { get; set; } = "PICK";
        public string TxTypes { get; set; } = "OUT";
        public bool HasPath => !string.IsNullOrWhiteSpace(Path);
        public bool IsSheetMode => string.Equals(WriteMode, "SHEET", StringComparison.OrdinalIgnoreCase);

        public string MapText => string.Join(";", Entries.Where(e => !string.IsNullOrWhiteSpace(e.Field) && !string.IsNullOrWhiteSpace(e.Target))
                                                          .Select(e => $"{(e.IsTable ? "T" : "H")}:{e.Field}={e.Target.Trim().ToUpperInvariant()}"));

        public HashSet<string> Types => new HashSet<string>((TxTypes ?? "").Split(',').Select(t => t.Trim().ToUpperInvariant()).Where(t => t.Length > 0));

        // แบบเริ่มต้น: ตารางเริ่มแถว 2 (แถว 1 = หัวตารางของไฟล์)
        public static List<PRExcelEntry> DefaultEntries() =>
            PRExcelLayout.Parse("T:NO=A;T:SCANDATE=B;T:CODE=C;T:NAME=D;T:QTY=E;T:EMPLOYEE=F;T:DEPARTMENT=G;T:USERID=H");

        // ชื่อชีทใหม่: {DATE} = วันที่ส่งออก (dd-MM-yyyy) · {STOCK} = รหัสคลัง · {N} หรือ +1 = เลขรันอัตโนมัติ (1, 2, 3 ... ต่อชื่อเดียวกัน)
        //   ตัดอักษรที่ Excel ไม่รับ / ยาวไม่เกิน 31
        private const string RunMark = "\u0001";
        public bool HasRunning => (SheetName ?? "").Contains("{N}") || (SheetName ?? "").Contains("+1");

        private (string Prefix, string Suffix) NameParts(DateTime from, DateTime to, string stockCode)
        {
            string d = from.Date == to.Date ? from.ToString("dd-MM-yyyy", CultureInfo.InvariantCulture)
                                            : $"{from.ToString("dd-MM", CultureInfo.InvariantCulture)} to {to.ToString("dd-MM-yyyy", CultureInfo.InvariantCulture)}";
            string pattern = string.IsNullOrWhiteSpace(SheetName) ? "RPA {DATE}" : SheetName.Trim();
            // "+1" = ต่อท้ายด้วย -เลขรัน (RPA-{DATE}+1 -> RPA-20-10-2026-1) / {N} = วางเลขรันตรงนั้นเลย
            pattern = pattern.Replace("{N}", RunMark).Replace("+1", "-" + RunMark).Replace("--" + RunMark, "-" + RunMark).Replace(" -" + RunMark, " " + RunMark);
            string n = Regex.Replace(pattern.Replace("{DATE}", d).Replace("{STOCK}", stockCode ?? ""), @"[\[\]\:\*\?\/\\]", "-").Trim().Trim('\'');
            if (n.Replace(RunMark, "").Trim().Length == 0) n = "RPA " + d + (n.Contains(RunMark) ? "-" + RunMark : "");
            int i = n.IndexOf(RunMark, StringComparison.Ordinal);
            return i < 0 ? (n, null) : (n.Substring(0, i), n.Substring(i + 1).Replace(RunMark, ""));
        }

        // no = เลขรัน (ไม่มี {N} / +1 = ไม่ใช้)
        public string SheetNameFor(DateTime from, DateTime to, string stockCode, int no = 1)
        {
            var (pre, suf) = NameParts(from, to, stockCode);
            if (suf == null) return pre.Length > 31 ? pre.Substring(0, 31) : pre;
            string num = no.ToString(CultureInfo.InvariantCulture);
            int room = 31 - num.Length - suf.Length;
            if (room < 0) { suf = suf.Substring(0, Math.Max(0, suf.Length + room)); room = 0; }
            return (pre.Length > room ? pre.Substring(0, room) : pre) + num + suf;
        }

        // เลขรันถัดไป = เลขที่มากที่สุดของชีทชื่อแบบเดียวกันในไฟล์ + 1 (ยังไม่มี = 1)
        public int NextRunning(IEnumerable<string> sheetNames, DateTime from, DateTime to, string stockCode)
        {
            string a = SheetNameFor(from, to, stockCode, 7), b = SheetNameFor(from, to, stockCode, 8);
            int at = 0; while (at < a.Length && at < b.Length && a[at] == b[at]) at++;
            string pre = a.Substring(0, at), suf = a.Substring(at + 1);
            var rx = new Regex("^" + Regex.Escape(pre) + @"(\d+)" + Regex.Escape(suf) + "$", RegexOptions.IgnoreCase);
            int max = 0;
            foreach (var s in sheetNames ?? Enumerable.Empty<string>())
            {
                var m = rx.Match(s);
                if (m.Success && int.TryParse(m.Groups[1].Value, out int n) && n > max) max = n;
            }
            return max + 1;
        }

        // ช่องตาราง: "B" = คอลัมน์ B เริ่มแถว TABLE START ROW / "B3" = คอลัมน์ B เริ่มแถว 3 (ตรงกับไฟล์ Template)
        public static bool ValidTableTarget(string t) => Regex.IsMatch((t ?? "").Trim(), @"^[A-Za-z]{1,3}([1-9][0-9]{0,6})?$");
        public static string ColumnOf(string t) => Regex.Match((t ?? "").Trim().ToUpperInvariant(), @"^[A-Z]+").Value;
        public static int? RowOf(string t) { var m = Regex.Match((t ?? "").Trim(), @"[0-9]+$"); return m.Success ? int.Parse(m.Value, CultureInfo.InvariantCulture) : (int?)null; }

        // แถวแรกของตาราง: ช่องตารางที่ระบุแถว (B3) ใช้แถวนั้น / ไม่ระบุ = TABLE START ROW
        public int TableStart => Entries.Where(e => e.IsTable && ValidTableTarget(e.Target)).Select(e => RowOf(e.Target)).Where(r => r.HasValue).Select(r => r.Value)
                                        .DefaultIfEmpty(Math.Max(1, StartRow)).Max();
    }

    // ช่องข้อมูลของรายการสแกนที่ลง Excel ได้ (เพิ่มช่องใหม่ = เพิ่มบรรทัดที่นี่ + Value)
    public static class ScanRpaFields
    {
        public static readonly (string Key, string Label)[] All =
        {
            ("DATE", "DATE (export day)"), ("NO", "NO (running)"), ("SCANDATE", "SCAN DATE"), ("SCANTIME", "SCAN TIME"), ("SCANDATETIME", "SCAN DATE TIME"),
            ("STOCK", "STOCK"), ("TYPE", "TYPE (IN / OUT)"), ("CODE", "PRODUCT CODE"), ("DISPLAY", "CODE AS DISPLAYED"), ("NAME", "PRODUCT NAME"), ("QTY", "QTY"),
            ("EMPLOYEE", "EMPLOYEE ID"), ("DEPARTMENT", "DEPARTMENT"), ("USERID", "USER ID"), ("USERNAME", "USER NAME"),
            ("BIN", "BIN"), ("PARTA", "PART A"), ("PARTB", "PART B"), ("PARTNO", "PART NO"), ("MODEL", "MODEL"),
            ("SUPPLIER", "SUPPLIER"), ("CUSTOMER", "CUSTOMER"), ("CATEGORY", "CATEGORY"), ("BARCODE", "BARCODE (scanned)")
        };

        public static string Label(string key) => All.FirstOrDefault(f => f.Key == key).Label ?? key;

        public static object Value(string key, ScanHistoryRow x, int no, DateTime day)
        {
            switch (key)
            {
                case "DATE": return day.Date;
                case "NO": return no;
                case "SCANDATE": return x.TxDate.Date;
                case "SCANTIME": return x.TxDate.ToString("HH:mm:ss", CultureInfo.InvariantCulture);
                case "SCANDATETIME": return x.TxDate.ToString("dd/MM/yyyy HH:mm:ss", CultureInfo.InvariantCulture);
                case "STOCK": return x.StockCode ?? "";
                case "TYPE": return x.TxType ?? "";
                case "CODE": return x.PartCode ?? "";
                case "DISPLAY": return x.CodeText ?? "";
                case "NAME": return x.PartName ?? "";
                case "QTY": return x.Qty;
                case "EMPLOYEE": return x.EmployeeId ?? "";
                case "DEPARTMENT": return x.Department ?? "";
                case "USERID": return x.UserId ?? "";
                case "USERNAME": return x.UserName ?? "";
                case "BIN": return x.Bin ?? "";
                case "PARTA": return x.PartA ?? "";
                case "PARTB": return x.PartB ?? "";
                case "PARTNO": return x.PartNumber ?? "";
                case "MODEL": return x.Model ?? "";
                case "SUPPLIER": return x.Supplier ?? "";
                case "CUSTOMER": return x.Customer ?? "";
                case "CATEGORY": return x.Category ?? "";
                case "BARCODE": return x.RefNo ?? "";
                default: return "";
            }
        }

        // ช่องเซลล์เดียวจากหลายรายการ: DATE = วันที่ส่งออก / NO = จำนวนรายการ / QTY = รวม / อื่น ๆ = ค่าที่ใช้มากที่สุด
        public static object HeaderValue(string key, IList<ScanHistoryRow> rows, DateTime day)
        {
            if (key == "DATE") return day.Date;
            if (key == "NO") return rows.Count;
            if (key == "QTY") return rows.Sum(r => r.Qty);
            var vals = rows.Select((x, i) => Value(key, x, i + 1, day)).Where(v => v != null && !(v is string s && s.Trim().Length == 0)).ToList();
            return vals.GroupBy(v => Convert.ToString(v, CultureInfo.InvariantCulture)).OrderByDescending(g => g.Count()).Select(g => g.First()).FirstOrDefault() ?? "";
        }
    }

    // ชีทชื่อนี้มีอยู่แล้วในไฟล์ (โหมด ADD SHEET) - ให้หน้าจอถามก่อนว่าจะเขียนทับไหม
    public class RpaSheetExistsException : Exception
    {
        public string SheetName { get; }
        public RpaSheetExistsException(string name) : base($"ชีท \"{name}\" มีอยู่แล้วในไฟล์") { SheetName = name; }
    }

    public class ScanRpaService
    {
        private readonly string _cs = GlobalConfig.ConnStr;

        public Dictionary<int, ScanRpaLayout> GetLayouts()
        {
            var map = new Dictionary<int, ScanRpaLayout>();
            if (!DbSchema.HasScanRpa) return map;
            using (var conn = new SqlConnection(_cs))
            using (var cmd = new SqlCommand("SELECT StockID, ExportPath, ExcelMap, StartRow, WriteMode, TemplateSheet, SheetName, DateMode, TxTypes FROM CIMS.ScanRpaLayouts", conn))
            {
                conn.Open();
                using (var r = cmd.ExecuteReader())
                    while (r.Read())
                    {
                        int id = Convert.ToInt32(r["StockID"]);
                        map[id] = new ScanRpaLayout
                        {
                            StockId = id,
                            Path = r["ExportPath"]?.ToString(),
                            Entries = PRExcelLayout.Parse(r["ExcelMap"]?.ToString()),
                            StartRow = Math.Max(1, Convert.ToInt32(r["StartRow"])),
                            WriteMode = r["WriteMode"]?.ToString() ?? "APPEND",
                            TemplateSheet = r["TemplateSheet"]?.ToString(),
                            SheetName = r["SheetName"] == DBNull.Value ? "RPA {DATE}" : r["SheetName"].ToString(),
                            DateMode = r["DateMode"]?.ToString() ?? "PICK",
                            TxTypes = r["TxTypes"] == DBNull.Value ? "" : r["TxTypes"].ToString()
                        };
                    }
            }
            return map;
        }

        public void SaveLayout(ScanRpaLayout l, string userId)
        {
            using (var conn = new SqlConnection(_cs))
            using (var cmd = new SqlCommand(@"
                MERGE CIMS.ScanRpaLayouts AS t
                USING (SELECT @s AS StockID) AS src ON t.StockID = src.StockID
                WHEN MATCHED THEN UPDATE SET ExportPath = @p, ExcelMap = @m, StartRow = @r, WriteMode = @w, TemplateSheet = @tp, SheetName = @sn,
                                             DateMode = @d, TxTypes = @tx, UpdatedBy = @u, UpdatedDate = GETDATE()
                WHEN NOT MATCHED THEN INSERT (StockID, ExportPath, ExcelMap, StartRow, WriteMode, TemplateSheet, SheetName, DateMode, TxTypes, UpdatedBy)
                                      VALUES (@s, @p, @m, @r, @w, @tp, @sn, @d, @tx, @u);", conn))
            {
                cmd.Parameters.AddWithValue("@s", l.StockId);
                cmd.Parameters.AddWithValue("@p", l.HasPath ? (object)l.Path.Trim() : DBNull.Value);
                cmd.Parameters.AddWithValue("@m", l.MapText);
                cmd.Parameters.AddWithValue("@r", Math.Max(1, l.StartRow));
                cmd.Parameters.AddWithValue("@w", l.IsSheetMode ? "SHEET" : "APPEND");
                cmd.Parameters.AddWithValue("@tp", string.IsNullOrWhiteSpace(l.TemplateSheet) ? DBNull.Value : (object)l.TemplateSheet.Trim());
                cmd.Parameters.AddWithValue("@sn", string.IsNullOrWhiteSpace(l.SheetName) ? DBNull.Value : (object)l.SheetName.Trim());
                cmd.Parameters.AddWithValue("@d", (l.DateMode ?? "PICK").ToUpperInvariant());
                cmd.Parameters.AddWithValue("@tx", l.TxTypes ?? "");
                cmd.Parameters.AddWithValue("@u", (object)userId ?? DBNull.Value);
                conn.Open();
                cmd.ExecuteNonQuery();
            }
        }

        // รายการที่ลงไฟล์: ไม่รวมรายการที่ถูกยกเลิก + เฉพาะ TYPE ที่ตั้งไว้ (ว่าง = ทุกประเภท)
        public static List<ScanHistoryRow> RowsFor(ScanRpaLayout l, IEnumerable<ScanHistoryRow> rows)
        {
            var types = l.Types;
            return rows.Where(r => !r.IsCancelled && (types.Count == 0 || types.Contains((r.TxType ?? "").Trim().ToUpperInvariant()))).ToList();
        }

        // ชีทที่ใช้เป็น Template / ชีทที่ต่อท้าย: ชื่อที่ตั้งไว้ (ไม่ตั้ง = ชีทแรกของไฟล์)
        private static IXLWorksheet BaseSheet(XLWorkbook wb, ScanRpaLayout l)
        {
            if (string.IsNullOrWhiteSpace(l.TemplateSheet)) return wb.Worksheet(1);
            if (wb.TryGetWorksheet(l.TemplateSheet.Trim(), out var ws)) return ws;
            throw new InvalidOperationException($"ไม่พบชีท \"{l.TemplateSheet.Trim()}\" ในไฟล์\n{l.Path}\n\nชีทที่มี: {string.Join(", ", wb.Worksheets.Select(w => w.Name))}");
        }

        public static List<string> SheetNames(string path)
        {
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            using (var wb = new XLWorkbook(fs))
                return wb.Worksheets.Select(w => w.Name).ToList();
        }

        // ✍ ลงข้อมูลในไฟล์ตามที่ตั้งไว้ - คืนชื่อชีท + แถวแรก / แถวสุดท้ายที่เขียน
        //   replaceSheet = ชีทชื่อเดียวกันมีอยู่แล้ว (โหมด ADD SHEET) ให้ลบแล้วสร้างใหม่จาก Template
        public (string Sheet, int First, int Last) Export(IList<ScanHistoryRow> rows, ScanRpaLayout l, DateTime from, DateTime to, string stockCode, bool replaceSheet = false)
        {
            string path = CIMS.Core.Storage.MapExternal(l?.Path?.Trim());   // Web: ไฟล์ใน storage/excel เท่านั้น
            if (string.IsNullOrWhiteSpace(path) || !File.Exists(path)) throw new FileNotFoundException($"ไม่พบไฟล์ Excel ที่ตั้งไว้:\n{path}");
            try { using (new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) { } }
            catch (IOException) { throw new IOException("ไฟล์ Excel ถูกเปิดค้างอยู่ กรุณาปิดไฟล์ก่อน Export"); }
            var heads = l.Entries.Where(e => !e.IsTable && PRExcelLayout.ValidCell(e.Target)).ToList();
            var cols = l.Entries.Where(e => e.IsTable && ScanRpaLayout.ValidTableTarget(e.Target)).ToList();
            if (heads.Count == 0 && cols.Count == 0) throw new InvalidOperationException("ยังไม่ได้กำหนดช่องที่ลงข้อมูล (User Management -> SETUP -> EXCEL SETUP -> MULTI-SCANNER)");

            using (var wb = new XLWorkbook(path))
            {
                var baseWs = BaseSheet(wb, l);
                IXLWorksheet ws = baseWs;
                if (l.IsSheetMode)
                {
                    // เลขรัน ({N} / +1): ชุดถัดไปของวันนั้น เช่น RPA-20-10-2026-1, -2, -3 ... (ไม่ชนชีทเดิม)
                    string name = l.HasRunning ? l.SheetNameFor(from, to, stockCode, l.NextRunning(wb.Worksheets.Select(w => w.Name), from, to, stockCode))
                                               : l.SheetNameFor(from, to, stockCode);
                    if (wb.TryGetWorksheet(name, out var old))
                    {
                        if (old == baseWs) throw new InvalidOperationException($"ชื่อชีทใหม่ \"{name}\" ซ้ำกับชีท Template - แก้ SHEET NAME ที่ SETUP");
                        if (!replaceSheet) throw new RpaSheetExistsException(name);
                        old.Delete();
                    }
                    ws = baseWs.CopyTo(name);
                    // เปิดไฟล์มาเจอชีทใหม่ (เลือกชีทเดียว ไม่ให้ Excel จับกลุ่มชีท)
                    foreach (var w in wb.Worksheets) { w.TabSelected = false; w.TabActive = false; }
                    ws.TabSelected = true; ws.TabActive = true;
                }

                // ใส่ค่าอย่างเดียว (คงรูปแบบ / สี / ฟอนต์ของไฟล์ Template ไว้) - ตัวเลข / วันที่ใส่รูปแบบให้
                void Put(IXLCell c, object v)
                {
                    if (v is DateTime d) { c.Value = d; c.Style.DateFormat.Format = "dd/MM/yyyy"; }
                    else if (v is int i) c.Value = i;
                    else if (v is decimal m) { c.Value = m; c.Style.NumberFormat.Format = m % 1 == 0 ? "#,##0" : "#,##0.00#"; }
                    else c.Value = Convert.ToString(v) ?? "";
                }
                bool NoBorder(IXLCell c) { var b = c.Style.Border; return b.LeftBorder == XLBorderStyleValues.None && b.RightBorder == XLBorderStyleValues.None && b.TopBorder == XLBorderStyleValues.None && b.BottomBorder == XLBorderStyleValues.None; }

                foreach (var h in heads) Put(ws.Cell(h.Target.ToUpperInvariant()), ScanRpaFields.HeaderValue(h.Field, rows, from));

                int first = 0, row = 0;
                if (cols.Count > 0)
                {
                    int start = l.TableStart;
                    int Col(PRExcelEntry e) => XLHelper.GetColumnNumberFromLetter(ScanRpaLayout.ColumnOf(e.Target));
                    var colNos = cols.Select(Col).ToList();
                    var dataCols = cols.Where(c => c.Field != "NO").Select(Col).ToList();
                    if (dataCols.Count == 0) dataCols = colNos;
                    // ค้นหาแถวว่างถัดไป: ต่อจากแถวสุดท้ายที่มีข้อมูล (ไม่นับคอลัมน์ NO ที่ Template ใส่เลขไว้ก่อน) / ชีทใหม่ = เริ่มแถวแรกของตาราง
                    int last = start - 1;
                    int bottom = ws.RangeUsed()?.LastRow().RowNumber() ?? start;
                    for (int r = bottom; r >= start; r--)
                        if (dataCols.Any(c => !ws.Cell(r, c).IsEmpty())) { last = r; break; }

                    first = last + 1; row = first;
                    int minCol = colNos.Min(), maxCol = colNos.Max();
                    double tplHeight = ws.Row(start).Height;
                    foreach (var x in rows)
                    {
                        int no = row - start + 1;
                        // เกินกรอบของ Template: ใช้รูปแบบแถวแรกของตาราง (เส้นกรอบ / ฟอนต์ / จัดวาง / ความสูง) ให้เหมือนกัน
                        if (row > start)
                        {
                            bool outside = Enumerable.Range(minCol, maxCol - minCol + 1).All(c => NoBorder(ws.Cell(row, c)));
                            if (outside)
                            {
                                for (int c = minCol; c <= maxCol; c++) ws.Cell(row, c).Style = ws.Cell(start, c).Style;
                                ws.Row(row).Height = tplHeight;
                                var rg = ws.Range(row, minCol, row, maxCol);
                                if (NoBorder(ws.Cell(start, minCol))) { rg.Style.Border.OutsideBorder = XLBorderStyleValues.Thin; rg.Style.Border.InsideBorder = XLBorderStyleValues.Thin; }
                            }
                        }
                        foreach (var c in cols) Put(ws.Cell(row, Col(c)), ScanRpaFields.Value(c.Field, x, no, from));
                        row++;
                    }
                }
                wb.Save();
                return (ws.Name, first, row - 1);
            }
        }
    }
}
