using System;
using System.Collections.Concurrent;
using System.IO;

namespace CIMS.Helpers
{
    // 🖼 Web: เหลือแค่เช็กว่ามีไฟล์รูป (จำผลไว้ ไม่ถาม Network share ซ้ำทุกแถว) - ตัวรูปส่งผ่าน /api/images
    public static class ImageCacheHelper
    {
        private static readonly TimeSpan MissingTtl = TimeSpan.FromMinutes(2);
        private static readonly ConcurrentDictionary<string, DateTime> _missing = new(StringComparer.OrdinalIgnoreCase);
        private static readonly ConcurrentDictionary<string, DateTime> _found = new(StringComparer.OrdinalIgnoreCase);

        private static bool KnownMissing(string path) => _missing.TryGetValue(path, out var t) && DateTime.Now - t < MissingTtl;

        public static bool Exists(string path)
        {
            if (string.IsNullOrWhiteSpace(path) || KnownMissing(path)) return false;
            if (_found.TryGetValue(path, out var t) && DateTime.Now - t < MissingTtl) return true;
            if (File.Exists(path)) { _missing.TryRemove(path, out _); _found[path] = DateTime.Now; return true; }
            _missing[path] = DateTime.Now;
            return false;
        }

        // รูปใหม่ถูกบันทึกทับ -> ลืมผลเดิม
        public static void Forget(string path)
        {
            if (string.IsNullOrWhiteSpace(path)) return;
            _missing.TryRemove(path, out _);
            _found.TryRemove(path, out _);
        }
    }
}
