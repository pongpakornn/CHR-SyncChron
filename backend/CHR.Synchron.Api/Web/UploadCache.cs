using Microsoft.Extensions.Caching.Memory;

namespace CHR.Synchron.Api.Web;

// 📥 Import 2 ขั้น (เหมือน WPF: อ่านไฟล์ -> สรุป -> ยืนยัน): อัปโหลดแล้วเก็บไฟล์ไว้ชั่วคราว 30 นาที ผูกกับผู้ใช้คนที่อัปโหลด
public sealed class UploadCache
{
    private readonly IMemoryCache _cache;
    public UploadCache(IMemoryCache cache) => _cache = cache;

    public sealed record Item(string Path, string FileName, string UserId, string Kind, object State);

    public string Put(string path, string fileName, string userId, string kind, object state = null)
    {
        string id = Guid.NewGuid().ToString("N");
        _cache.Set("upload:" + id, new Item(path, fileName, userId, kind, state), new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(30)
        }.RegisterPostEvictionCallback((_, v, _, _) => { try { File.Delete(((Item)v).Path); } catch { } }));
        return id;
    }

    // ใช้ได้เฉพาะคนที่อัปโหลด + ชนิดเดียวกัน
    public Item Get(string id, string userId, string kind) =>
        _cache.TryGetValue("upload:" + id, out Item it) && it.UserId == userId && it.Kind == kind ? it : null;

    public void Remove(string id) => _cache.Remove("upload:" + id);
}
