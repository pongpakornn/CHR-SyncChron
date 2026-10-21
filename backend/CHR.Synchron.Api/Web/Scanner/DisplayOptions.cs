using CIMS.Helpers;
using CIMS.Models;

namespace CHR.Synchron.Api.Web.Scanner;

// 🏷️ ตัวเลือก DISPLAY ของคลัง (ScanDisplayWindow.OptionsFor): คอลัมน์ของสินค้า + ช่องที่ n ของป้าย Supplier ที่คลังนี้รับ (ไม่ได้ผูกไว้ = ทุกรูปแบบ)
public static class DisplayOptions
{
    public sealed record Option(string Key, string Label);

    public static List<Option> For(StockModel s, List<BarcodeFormatModel> formats, string current)
    {
        var opts = ScanDisplay.Columns.Select(c => new Option(c.Key, c.Label)).ToList();
        var fmts = s.FormatIds != null && s.FormatIds.Count > 0 ? formats.Where(f => s.FormatIds.Contains(f.FmtId)).ToList() : formats;
        foreach (var f in fmts)
        {
            string[] sample = string.IsNullOrWhiteSpace(f.SampleText) ? Array.Empty<string>() : f.SplitFields(f.SampleText);
            int count = Math.Max(sample.Length, new[] { f.MinFields, f.CodePos, f.AltCodePos ?? 0, f.QtyPos ?? 0 }.Max());
            for (int n = 1; n <= count; n++)
            {
                string ex = n <= sample.Length ? sample[n - 1].Trim() : "";
                opts.Add(new Option(ScanDisplay.FieldKey(f.FmtId, n), $"BARCODE {f.Name} #{n}" + (ex.Length > 0 ? $"   ({ex})" : "")));
            }
        }
        if (!string.IsNullOrEmpty(current) && !opts.Any(o => o.Key == current)) opts.Add(new Option(current, current + "  (format removed)"));
        return opts;
    }
}
