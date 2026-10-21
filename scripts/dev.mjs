// ▶ npm run dev (จากโฟลเดอร์ไหนก็ได้ในโปรเจค) = เปิด API (ASP.NET :5080) + Web (Next.js :3000) พร้อมกัน
//   - API เปิดอยู่แล้ว (เช่นรันใน Visual Studio) -> ใช้ตัวนั้น ไม่เปิดซ้ำ
//   - ยังไม่ได้ npm install ที่ frontend -> ติดตั้งให้ก่อน
//   - Web เปิดให้เครื่องอื่นในวง LAN เข้าได้ (http://<IP เครื่องนี้>:3000)
//   - Ctrl+C = ปิดทั้งสองตัว
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "frontend");
const API = join(ROOT, "backend", "CHR.Synchron.Api");
const API_URL = process.env.API_URL ?? "http://localhost:5080";
const WEB_PORT = process.env.PORT ?? "3000";
const isWin = process.platform === "win32";
const children = [];

const tag = (name, color) => (line) => process.stdout.write(`\x1b[${color}m[${name}]\x1b[0m ${line}\n`);
const logApi = tag("api", 35);
const logWeb = tag("web", 36);
const log = tag("dev", 33);

// คำสั่งเป็นข้อความเดียว (ไม่มีค่าจากผู้ใช้) - Windows ต้องเปิดผ่าน shell เพื่อหา npm.cmd
function run(command, cwd, out) {
  const p = spawn(command, { cwd, shell: true, env: { ...process.env, API_URL } });
  const pipe = (s) => {
    let buf = "";
    s.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      lines.forEach((l) => l && out(l));
    });
  };
  pipe(p.stdout);
  pipe(p.stderr);
  children.push(p);
  return p;
}

async function apiUp() {
  try {
    const r = await fetch(`${API_URL}/api/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

function lanUrls() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => `http://${i.address}:${WEB_PORT}`);
}

function stopAll() {
  for (const p of children) {
    if (p.exitCode !== null || !p.pid) continue;
    // Windows: ปิดทั้งต้นไม้ของ Process (dotnet / next ที่ถูกเปิดผ่าน shell)
    if (isWin) spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" });
    else p.kill("SIGTERM");
  }
}
process.on("SIGINT", () => (stopAll(), process.exit(0)));
process.on("SIGTERM", () => (stopAll(), process.exit(0)));
process.on("exit", stopAll);

// 1) Frontend ยังไม่ได้ติดตั้ง -> npm install
if (!existsSync(join(WEB, "node_modules"))) {
  log("ติดตั้ง frontend (npm install) ครั้งแรก...");
  const r = spawnSync("npm install", { cwd: WEB, stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// 2) API
if (await apiUp()) {
  log(`API เปิดอยู่แล้วที่ ${API_URL} - ใช้ตัวนั้น`);
} else {
  const hasDotnet = spawnSync("dotnet --version", { shell: true, stdio: "ignore" }).status === 0;
  if (!hasDotnet) {
    log("⚠ ไม่พบ .NET SDK - เปิดเฉพาะ Web (ติดตั้ง .NET 10 SDK หรือชี้ API_URL ไปที่ API ที่เปิดอยู่)");
  } else {
    log("เปิด API (dotnet run)...");
    const api = run("dotnet run --launch-profile http", API, logApi);
    api.on("exit", (code) => {
      if (code && code !== 0)
        log(`⚠ API หยุดทำงาน (code ${code}) - เครื่องใหม่ต้องตั้ง ConnectionStrings:Main + Jwt:Key ก่อน (ดู README.md)`);
    });
  }
}

// 3) Web
const web = run(`npm run dev:web -- --port ${Number(WEB_PORT) || 3000}`, WEB, logWeb);
web.on("exit", (code) => (stopAll(), process.exit(code ?? 0)));

setTimeout(() => {
  log(`เปิดใช้งาน:  http://localhost:${WEB_PORT}`);
  for (const u of lanUrls()) log(`เครื่องอื่นในวง LAN:  ${u}`);
}, 4000);
