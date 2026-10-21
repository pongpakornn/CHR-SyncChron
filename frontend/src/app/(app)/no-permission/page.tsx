export default function NoPermission() {
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="max-w-md rounded-2xl bg-surface p-8 text-center shadow">
        <div className="text-lg font-extrabold text-danger">NO PERMISSION</div>
        <p className="mt-2 text-sm font-semibold text-ink-soft">บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งานระบบใดเลย กรุณาติดต่อ Admin (Level 1)</p>
      </div>
    </div>
  );
}
