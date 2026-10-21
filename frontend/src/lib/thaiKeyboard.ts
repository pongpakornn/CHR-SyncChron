// สแกนเนอร์ส่งบาร์โค้ดเป็น "ปุ่มกด" ถ้าแป้นเป็นภาษาไทย (เกษมณี) จะได้ตัวอักษรไทยแทน -> แปลงกลับเป็นปุ่มภาษาอังกฤษ
// (เหมือน Helpers/ThaiKeyboard.cs ของ WPF)
const THAI = "ๅภถุึคตจขชๆไำพะัีรนยบลฃฟหกดเ้่าสวงผปแอิืทมใฝ" + "๑๒๓๔ู฿๕๖๗๘๙๐ฎฑธํ๊ณฯญฐฅฤฆฏโฌ็๋ษศซฉฮฺ์ฒฬฦ";
const ENG = "14567890-=qwertyuiop[]\\asdfghjkl;'zxcvbnm,./" + "@#$%^&*()_+QERTYUIOP{|ASDFGHJKL:CVBN<>?";

const MAP = new Map<string, string>();
for (let i = 0; i < THAI.length && i < ENG.length; i++) if (!MAP.has(THAI[i])) MAP.set(THAI[i], ENG[i]);

export const hasThai = (s: string) => /[฀-๿]/.test(s);

export function toEnglish(s: string) {
  let out = "";
  for (const c of s) out += MAP.get(c) ?? c;
  return out;
}
