import { useState, useMemo, useEffect } from "react";
import {
  Scale, Shield, Printer, FileUp, Download, Clock3, AlertTriangle,
  CalendarPlus, Trash2, Plus, CheckCircle2, Building2, X, Stamp,
  ChevronLeft, ChevronRight, ChevronDown, CalendarDays, List, Archive, Timer, User, UserPlus, Lock, History, Search, BarChart3, Inbox
} from "lucide-react";

/* ---------- design tokens ---------- */
const ink = "#1B2A41";
const paper = "#EAE7DC";
const paperCard = "#F4F2E9";
const line = "#C9C2AC";
const brass = "#A8762E";
const brassBg = "#F3E7D2";
const sealRed = "#9C3B2E";
const sealRedBg = "#F3DEDA";
const sealGreen = "#3F6B4C";
const sealGreenBg = "#DFE8DE";
const slate = "#3A5A73";
const slateBg = "#DFE6EA";

const serif = "'Sarabun', sans-serif"; // ตัวอักษรราชการไทยมาตรฐาน (Sarabun) ใช้แทนหัวข้อ
const sans = "'Sarabun', sans-serif";

const STATIONS = [
  "สภ.เมืองอุดรธานี","สภ.กุมภวาปี","สภ.หนองหาน","สภ.เพ็ญ","สภ.บ้านผือ",
  "สภ.บ้านดุง","สภ.ศรีธาตุ","สภ.น้ำโสม","สภ.หนองวัวซอ","สภ.กุดจับ",
  "สภ.โนนสะอาด","สภ.ทุ่งฝน","สภ.วังสามหมอ","สภ.สร้างคอม","สภ.ไชยวาน",
  "สภ.หนองแสง","สภ.กลางใหญ่","สภ.บ้านเทื่อม","สภ.พิบูลย์รักษ์","สภ.ดงเย็น",
  "สภ.นายูง","สภ.กู่แก้ว","สภ.ประจักษ์ศิลปาคม",
];

const THAI_MONTHS = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const PURGE_DAYS = 60; // retain case record/audit detail for this many days after a case closes, then purge
const DEFAULT_POOL_YEAR = 2569; // ปี พ.ศ. เริ่มต้นสำหรับสร้างชุดเลขคำร้องฝากขังครั้งที่ 1 (ยฝ./ฝ.)

// สร้างชุดคดี "ยังไม่มีสถานี/พนักงานผูกอยู่" ล่วงหน้า (จำลองสิ่งที่ createNumberBatch จะสร้างจริง)
// วันที่ครบกำหนด/วันต้องยื่นคำนวณได้ทันทีเพราะมี startDate อยู่แล้วตั้งแต่ตอนสร้าง ไม่ต้องรอใครมาจับคู่/รับเป็นเจ้าของก่อน
// ป้ายกำกับประเภทคดีจากคำนำหน้าเลข — ใช้แสดงผลเท่านั้น ไม่มีผลต่อการคำนวณวันครบกำหนด/เพดาน
// (ยังไม่ยืนยันว่าคดียาเสพติดมีกฎ 12 วัน/ครั้ง หรือเพดาน 48/84 วันต่างจากคดีทั่วไปหรือไม่ — ดู SPEC.md)
function caseTypeLabel(caseNumber) {
  if (!caseNumber) return null;
  if (caseNumber.startsWith("ยฝ.")) return "ยาเสพติด";
  if (caseNumber.startsWith("ฝ.")) return "คดีทั่วไป";
  return null;
}
// นโยบายลบไฟล์ PDF ที่อัพโหลดแล้ว — เดิมกำหนดไว้ 3 วัน แต่ปรับเป็น 12 วัน (ยืนยันแล้ว) ตามข้อเสนอจากพนักงาน
// สอบสวนจริง: คดีที่ยื่นล่วงหน้าไว้หลายวันก่อนวันครบกำหนดจริง 3 วันไม่พอ ไฟล์หมดอายุก่อนศาลจะดาวน์โหลด
const FILE_PURGE_DAYS = 12; // นับต่อไฟล์ ไม่เกี่ยวกับว่าคดีปิดหรือยัง
// เดิมมีบัญชีเจ้าหน้าที่ศาลได้แค่บัญชีเดียว — เปลี่ยนเป็นหลายบัญชีได้แล้ว (สร้าง/ลบ/รีเซ็ตรหัสผ่านได้จากหน้า "บัญชีผู้ใช้")
// เพื่อรองรับกรณีมีเจ้าหน้าที่ศาลมากกว่า 1 คนผลัดกันทำงานจริง
// ไม่ seed บัญชีตัวอย่างไว้เลย (ไม่มีรหัสผ่านตั้งต้นฝังในโค้ดอีกต่อไป) — ถ้ายังไม่มีบัญชีเลย
// หน้า login (CourtLoginScreen) จะสลับไปโชว์ฟอร์ม "ตั้งค่าบัญชีแรกของระบบ" ให้สร้างบัญชีแรกได้เองแทน
const seedCourtAccounts = [];

/* ---------- date helpers ---------- */
// ใช้องค์ประกอบวันที่แบบ local time เสมอ (ไม่ใช้ .toISOString() ซึ่งเป็น UTC เท่านั้น)
// เพราะ .toISOString() จะให้วันที่ผิดไป 1 วันในช่วงเที่ยงคืน-ตี 7 ตามเวลาไทย (UTC+7)
const toISO = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const fromISO = (s) => new Date(s + "T00:00:00");
const addDays = (d, n) => { const c = new Date(d); c.setDate(c.getDate() + n); return c; };
const genDate = (offset) => toISO(addDays(new Date(), offset));
const isWeekend = (d) => { const w = d.getDay(); return w === 0 || w === 6; };
const isHoliday = (iso, holidays) => holidays.some((h) => h.date === iso);
const adjustToBusinessDay = (iso, holidays) => {
  let d = fromISO(iso);
  while (isWeekend(d) || isHoliday(toISO(d), holidays)) d = addDays(d, -1);
  return toISO(d);
};
// ข้อ 5 ระเบียบศาลจังหวัดอุดรธานี: ยื่นคำร้องล่วงหน้า 1 วันทำการ ก่อนวันครบกำหนดฝากขังจริง
// (วันครบกำหนดจริง = วันครบกำหนดดิบ เลื่อนมาวันทำการก่อนหน้าแล้วถ้าตรงวันหยุด — ดู adjustToBusinessDay)
const previousBusinessDay = (iso, holidays) => {
  let d = addDays(fromISO(iso), -1);
  while (isWeekend(d) || isHoliday(toISO(d), holidays)) d = addDays(d, -1);
  return toISO(d);
};
const rawDeadline = (startISO, k) => toISO(addDays(fromISO(startISO), 12 * (k - 1)));
const daysUntil = (iso) => {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((fromISO(iso) - t) / 86400000);
};
const formatThai = (iso) => {
  const d = fromISO(iso);
  return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
};

// ---------- ตัวสร้างไฟล์ปฏิทิน .ics (ตัวอย่างจริงของ "แบบ B: ลิงก์ปฏิทินส่วนตัว" ที่คุยกันไว้) ----------
// เนื้อหานี้คือสิ่งที่ระบบจริงจะส่งออกทาง URL คงที่ต่อคน ให้แอปปฏิทินดึงไปแสดงอัตโนมัติเป็นระยะ
// ในเดโมนี้จำลองด้วยการดาวน์โหลดไฟล์ครั้งเดียวแทน เพราะยังไม่มีเซิร์ฟเวอร์จริงให้ subscribe ต่อเนื่อง
function escapeICSText(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}
function toICSDateTime(isoDate, hour, minute) {
  const [y, m, d] = isoDate.split("-");
  return `${y}${m}${d}T${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}00`;
}
function nowStampUTC(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}T${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}Z`;
}
function generateICS(cases, calendarName) {
  const now = new Date();
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Udon Provincial Court//Remand Tracker//TH",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${escapeICSText(calendarName)}`, "X-WR-TIMEZONE:Asia/Bangkok",
  ];
  cases.filter((c) => !c.closed && c.filingDeadline).forEach((c) => {
    const uid = `case-${c.caseNumber}-k${c.k}@udon-remand-tracker`.replace(/[^a-zA-Z0-9@.\-]/g, "");
    const summary = escapeICSText(`ครบกำหนดยื่นคำร้องฝากขัง เลขคดี ${c.caseNumber} ครั้งที่ ${c.k}`);
    const desc = escapeICSText(`สถานี: ${c.station}\nต้องยื่นภายในเวลา 16.00 น. (ข้อ 6 ระเบียบศาลจังหวัดอุดรธานี)\nครบกำหนดฝากขังจริง: ${c.legalDeadline}`);
    lines.push(
      "BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${nowStampUTC(now)}`,
      `DTSTART:${toICSDateTime(c.filingDeadline, 9, 0)}`, `DTEND:${toICSDateTime(c.filingDeadline, 10, 0)}`,
      `SUMMARY:${summary}`, `DESCRIPTION:${desc}`, `LOCATION:${escapeICSText(c.station)}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-P1D", `DESCRIPTION:${summary}`, "END:VALARM",
      "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT2H", `DESCRIPTION:${summary}`, "END:VALARM",
      "END:VEVENT"
    );
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
function downloadICS(cases, calendarName) {
  const blob = new Blob([generateICS(cases, calendarName)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "คำร้องฝากขัง.ics";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
// ข้อ 6 ระเบียบศาลจังหวัดอุดรธานี: ยื่นคำร้องทางระบบได้ไม่เกิน 16.00 น. ของวันที่ต้องยื่น
// เลยเวลานี้แล้วห้ามยื่นผ่านระบบ ต้องนำคำร้องไปยื่นต่อศาลด้วยตนเองเท่านั้น
const FILING_CUTOFF_HOUR = 16;
const isPastCutoff = (filingDeadlineISO) => {
  const cutoff = fromISO(filingDeadlineISO);
  cutoff.setHours(FILING_CUTOFF_HOUR, 0, 0, 0);
  return new Date() > cutoff;
};

/* ---------- seed data ---------- */
// ที่มา: ฐานข้อมูลวันหยุดราชการ ประจำปี พ.ศ. 2569 ที่ผู้ใช้ให้มา (holiday_database_2569.html)
// รวมทุกประเภท (วันหยุดราชการทั่วไป, หยุดเฉพาะราชการ, วันหยุดชดเชย) เพราะศาลเป็นหน่วยงานราชการ ใช้วันหยุดตามนี้ทั้งหมด
const seedHolidays = [
  { date: "2026-01-01", label: "วันขึ้นปีใหม่" },
  { date: "2026-01-02", label: "วันหยุดราชการเพิ่มเป็นกรณีพิเศษ" },
  { date: "2026-03-03", label: "วันมาฆบูชา" },
  { date: "2026-04-06", label: "วันจักรี" },
  { date: "2026-04-13", label: "วันสงกรานต์" },
  { date: "2026-04-14", label: "วันสงกรานต์" },
  { date: "2026-04-15", label: "วันสงกรานต์" },
  { date: "2026-05-04", label: "วันฉัตรมงคล" },
  { date: "2026-05-13", label: "วันพืชมงคลจรดพระนังคัลแรกนาขวัญ" },
  { date: "2026-05-31", label: "วันวิสาขบูชา" },
  { date: "2026-06-01", label: "หยุดชดเชยวันวิสาขบูชา" },
  { date: "2026-06-03", label: "วันเฉลิมพระชนมพรรษาสมเด็จพระนางเจ้าฯ พระบรมราชินี" },
  { date: "2026-07-28", label: "วันเฉลิมพระชนมพรรษาพระบาทสมเด็จพระเจ้าอยู่หัว" },
  { date: "2026-07-29", label: "วันอาสาฬหบูชา" },
  { date: "2026-07-30", label: "วันเข้าพรรษา" },
  { date: "2026-08-12", label: "วันเฉลิมพระชนมพรรษาสมเด็จพระบรมราชชนนีพันปีหลวง และวันแม่แห่งชาติ" },
  { date: "2026-10-13", label: "วันนวมินทรมหาราช" },
  { date: "2026-10-23", label: "วันปิยมหาราช" },
  { date: "2026-12-05", label: "วันคล้ายวันพระบรมราชสมภพ ร.9, วันชาติ และวันพ่อแห่งชาติ" },
  { date: "2026-12-07", label: "หยุดชดเชยวันพ่อแห่งชาติ" },
  { date: "2026-12-10", label: "วันรัฐธรรมนูญ" },
  { date: "2026-12-31", label: "วันสิ้นปี" },
];

// ไม่มีบัญชีตัวอย่างค้างไว้แล้ว — เจ้าหน้าที่ศาลต้องสร้างบัญชีพนักงานสอบสวนจริงเองจากหน้า "บัญชีผู้ใช้" หลังล็อกอิน
const seedAccounts = () => ([]);

// ไม่มีคดีตัวอย่างค้างไว้แล้ว — เริ่มต้นด้วยฐานข้อมูลว่างเปล่า เจ้าหน้าที่ศาลลงข้อมูลคดีจริงเองผ่านกล่อง "เพิ่มคำร้องฝากขังครั้งที่ 1"
const seedCases = () => ([]);

/* ---------- status stamp (signature element) ---------- */
/* ---------- Thai Buddhist-era date picker (วัน/เดือน/ปี พ.ศ.) ---------- */
function ThaiDateInput({ value, onChange, yearsBack = 3, yearsForward = 1 }) {
  const d = value ? fromISO(value) : new Date();
  const day = d.getDate(), month = d.getMonth(), year = d.getFullYear();
  const thisYear = new Date().getFullYear();
  const years = [];
  for (let y = thisYear + yearsForward; y >= thisYear - yearsBack; y--) years.push(y);

  function emit(nd, nm, ny) {
    const daysInMonth = new Date(ny, nm + 1, 0).getDate();
    const clampedDay = Math.min(nd, daysInMonth);
    const pad = (n) => String(n).padStart(2, "0");
    onChange(`${ny}-${pad(nm + 1)}-${pad(clampedDay)}`);
  }

  const selectStyle = { border: `1px solid ${line}`, backgroundColor: "#fff" };
  return (
    <div className="grid grid-cols-3 gap-1.5">
      <select value={day} onChange={(e) => emit(Number(e.target.value), month, year)} className="rounded-md px-2 py-2.5 text-base" style={selectStyle}>
        {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <select value={month} onChange={(e) => emit(day, Number(e.target.value), year)} className="rounded-md px-2 py-2.5 text-base" style={selectStyle}>
        {THAI_MONTHS_FULL.map((m, i) => <option key={m} value={i}>{m}</option>)}
      </select>
      <select value={year} onChange={(e) => emit(day, month, Number(e.target.value))} className="rounded-md px-2 py-2.5 text-base" style={selectStyle}>
        {years.map((y) => <option key={y} value={y}>{y + 543}</option>)}
      </select>
    </div>
  );
}

const STATUS_META = {
  wait: { label: "รอถึงกำหนด", fg: ink, border: line, bg: "#fff" },
  due: { label: "ใกล้ครบกำหนด", fg: brass, border: brass, bg: brassBg },
  overdue: { label: "เลยกำหนดยื่น", fg: sealRed, border: sealRed, bg: sealRedBg },
  blocked: { label: "เลยเวลายื่นทางระบบ · ต้องยื่นด้วยตนเอง", fg: sealRed, border: sealRed, bg: sealRedBg },
  file_expired: { label: "ไฟล์หมดอายุ (เกิน 12 วัน) · ต้องอัพโหลดใหม่", fg: sealRed, border: sealRed, bg: sealRedBg },
  uploaded: { label: "ยื่นแล้ว · รอศาลดาวน์โหลด", fg: slate, border: slate, bg: slateBg },
  downloaded: { label: "ดาวน์โหลดแล้ว · รอยืนยันรับเรื่อง", fg: slate, border: slate, bg: slateBg },
  closed: { label: "ครบเพดานฝากขัง", fg: sealGreen, border: sealGreen, bg: sealGreenBg },
};

function Stamp_({ status, size = "sm" }) {
  const s = STATUS_META[status];
  const Icon = status === "closed" ? CheckCircle2 : (status === "overdue" || status === "blocked" || status === "file_expired") ? AlertTriangle : status === "due" ? Clock3 : null;

  if (size === "lg") {
    return (
      <div
        className="flex items-center gap-2 rounded-lg px-4 py-2.5 w-full"
        style={{ backgroundColor: s.bg, border: `2px solid ${s.border}`, fontFamily: sans }}
      >
        {Icon && <Icon size={22} color={s.fg} className="shrink-0" />}
        <span className="text-base sm:text-lg font-extrabold tracking-wide" style={{ color: s.fg }}>{s.label}</span>
      </div>
    );
  }
  return (
    <div
      className="inline-flex items-center gap-1 rounded-full border-2 border-dashed px-3 py-1 text-[11px] font-bold tracking-wide -rotate-2"
      style={{ color: s.fg, borderColor: s.border, fontFamily: sans }}
    >
      {status === "closed" && <CheckCircle2 size={12} />}
      {(status === "overdue" || status === "blocked") && <AlertTriangle size={12} />}
      {s.label}
    </div>
  );
}

function deriveStatus(c) {
  if (c.closed) return "closed";
  if (c.fileExpired) return "file_expired";
  if (c.fileName && c.downloaded) return "downloaded";
  if (c.fileName) return "uploaded";
  if (isPastCutoff(c.filingDeadline)) return "blocked";
  const d = daysUntil(c.filingDeadline);
  if (d < 0) return "overdue";
  if (d <= 3) return "due";
  return "wait";
}

// รายการที่โหลดทีละหน้า (แบบ "แสดงเพิ่ม") แทนที่จะเรนเดอร์ทุกรายการรวดเดียว — ใช้ตอนคำร้องกองรวมกันเยอะ
// (เช่น ช่วงชนวันหยุดยาว วันทำการสุดท้ายก่อนหยุดจะมีคำร้องจากหลายคดีถูกเลื่อนมารวมกันเป็นหลักร้อยได้)
// ใส่ key={...} ที่จุดเรียกใช้ทุกครั้งที่ items เปลี่ยนชุด (เช่น เปลี่ยนตัวกรอง/สลับกลุ่ม) เพื่อรีเซ็ต visibleCount กลับเป็นค่าเริ่มต้น
function PaginatedCaseList({ items, pageSize = 20, renderItem, itemsClassName = "space-y-2" }) {
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const visible = items.slice(0, visibleCount);
  const remaining = items.length - visible.length;
  return (
    <>
      <div className={itemsClassName}>{visible.map(renderItem)}</div>
      {remaining > 0 && (
        <button
          onClick={() => setVisibleCount((v) => v + pageSize)}
          className="w-full mt-2 text-xs font-semibold py-2 rounded-md"
          style={{ backgroundColor: slateBg, color: slate }}
        >
          แสดงเพิ่มอีก {Math.min(pageSize, remaining)} รายการ (เหลืออีก {remaining} รายการ)
        </button>
      )}
    </>
  );
}

/* ---------- main app ---------- */
export default function App() {
  // จำลองพฤติกรรม URL แยกกัน (/police, /court) ด้วย query param เพราะ artifact นี้เป็นหน้าเว็บเดียว
  // เปลี่ยน path จริงไม่ได้ — ถ้ามี ?portal=police หรือ ?portal=court ในลิงก์ จะข้ามหน้าเลือกพอร์ทัลไปเลย
  // ตอนสร้าง Next.js จริง ให้เปลี่ยนจุดนี้เป็นอ่านจาก route (`/police/...`, `/court/...`) แทน โครงสร้างโค้ดที่เหลือเหมือนเดิม
  function getPortalFromURL() {
    try {
      const params = new URLSearchParams(window.location.search);
      const p = params.get("portal");
      return p === "police" || p === "court" ? p : null;
    } catch {
      return null; // เผื่อ window ไม่มี (เช่น server-side render) — ไม่มีผล ถือว่ายังไม่เลือกพอร์ทัล
    }
  }
  const [role, setRole] = useState(getPortalFromURL); // null = ยังไม่ได้เลือกพอร์ทัล (แสดงหน้าเลือกก่อน) — เว้นแต่ URL ระบุ portal มาแล้ว

  function goTo(newRole) {
    setRole(newRole); // จำลองการไปคนละ URL — ไม่มีปุ่มสลับใน UI เลย ต้องกลับหน้าเลือกก่อนถึงจะไปอีกฝั่งได้
  }
  const [holidays, setHolidays] = useState(seedHolidays);
  const [cases, setCases] = useState(seedCases);
  const [accounts, setAccounts] = useState(seedAccounts);
  const [courtAccounts, setCourtAccounts] = useState(seedCourtAccounts);
  const [loggedInOfficer, setLoggedInOfficer] = useState(null);
  const [loggedInCourt, setLoggedInCourt] = useState(null); // { name } | null — เปลี่ยนจาก boolean เดี่ยว เพราะตอนนี้มีได้หลายบัญชี ต้องรู้ว่า "ใคร" ล็อกอินอยู่
  const [holidayForm, setHolidayForm] = useState({ date: "", label: "" });

  // dev convenience: remember the court login across reloads so you don't have to log in every time
  // while testing — this is NOT how a real deployment would work (real sessions use server-side auth
  // with proper expiry), it's purely to save time during development of this prototype
  useEffect(() => {
    (async () => {
      try {
        const saved = await window.storage.get("loggedInCourtName");
        if (saved && saved.value) setLoggedInCourt({ name: saved.value });
      } catch {
        // no saved session yet — stay logged out, normal first-run state
      }
    })();
  }, []);

  // ป้องกันข้อมูลหายถ้า artifact โหลดใหม่ระหว่างสาธิต (ยังไม่มีฐานข้อมูลจริง) — โหลดครั้งแรกตอน mount
  // ถ้าค่าที่เคยบันทึกไว้เป็นอาร์เรย์ว่างเปล่า (เช่น จากตอนที่ยังไม่มีข้อมูลตัวอย่าง) ให้ใช้ข้อมูลตัวอย่างแทน
  // ไม่งั้นค่าว่างเก่าจะทับข้อมูลตัวอย่างชุดใหม่ทุกครั้งที่โหลด
  const [dataLoaded, setDataLoaded] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const savedAccounts = await window.storage.get("accounts");
        const parsed = savedAccounts ? JSON.parse(savedAccounts.value) : [];
        if (parsed.length > 0) setAccounts(parsed);
      } catch {}
      try {
        const savedCourtAccounts = await window.storage.get("courtAccounts");
        const parsed = savedCourtAccounts ? JSON.parse(savedCourtAccounts.value) : [];
        if (parsed.length > 0) setCourtAccounts(parsed);
      } catch {}
      try {
        const savedCases = await window.storage.get("cases");
        const parsed = savedCases ? JSON.parse(savedCases.value) : [];
        if (parsed.length > 0) setCases(parsed);
      } catch {}
      setDataLoaded(true);
    })();
  }, []);
  // บันทึกทุกครั้งที่ accounts/courtAccounts/cases เปลี่ยน (หลังจากโหลดค่าเดิมเสร็จแล้วเท่านั้น กันเขียนทับด้วยค่าว่างตอนเริ่ม)
  useEffect(() => {
    if (dataLoaded) window.storage.set("accounts", JSON.stringify(accounts)).catch(() => {});
  }, [accounts, dataLoaded]);
  useEffect(() => {
    if (dataLoaded) window.storage.set("courtAccounts", JSON.stringify(courtAccounts)).catch(() => {});
  }, [courtAccounts, dataLoaded]);
  useEffect(() => {
    if (dataLoaded) window.storage.set("cases", JSON.stringify(cases)).catch(() => {});
  }, [cases, dataLoaded]);

  // เช็คบัญชีเจ้าหน้าที่ศาลจริงตอนล็อกอิน (แทนที่การเช็คกับ COURT_ACCOUNT เดี่ยวๆ แบบเดิม)
  function loginCourt(name, password) {
    const account = courtAccounts.find((a) => a.name === name);
    if (!account) return { ok: false, error: "ไม่พบบัญชีนี้" };
    if (account.password !== password) return { ok: false, error: "รหัสผ่านไม่ถูกต้อง" };
    return { ok: true };
  }
  function handleCourtLogin(name) {
    setLoggedInCourt({ name });
    window.storage.set("loggedInCourtName", name).catch(() => {});
  }
  function handleCourtLogout() {
    setLoggedInCourt(null);
    window.storage.delete("loggedInCourtName").catch(() => {});
    setRole(getPortalFromURL()); // ถ้า URL ระบุ portal ไว้ (เช่น ?portal=court) กลับไปหน้า login ฝั่งนั้นเลย ไม่โผล่หน้าเลือกพอร์ทัลอีกฝั่ง — จำลองพฤติกรรม URL แยกจริง
  }

  // สร้างบัญชีแรกของระบบตอนยังไม่มีบัญชีเจ้าหน้าที่ศาลเลย (ตั้งค่าเริ่มต้นครั้งแรก) — ใช้ได้แค่ตอน
  // courtAccounts ว่างเปล่าเท่านั้น เพื่อกันไม่ให้ใครก็ได้มาสร้างบัญชีแทรกทีหลังผ่านทางนี้ (หลังมีบัญชีแรกแล้ว
  // ต้องสร้างบัญชีถัดไปผ่าน "บัญชีผู้ใช้" ในระบบเท่านั้น ซึ่งต้องล็อกอินก่อน)
  function createFirstCourtAccount(name, password) {
    if (courtAccounts.length > 0) return; // มีบัญชีอยู่แล้ว ทางนี้ใช้ไม่ได้อีก
    if (!name.trim() || !password) return;
    const account = { id: Date.now(), name: name.trim(), password };
    setCourtAccounts([account]);
    handleCourtLogin(account.name); // ล็อกอินให้ทันทีหลังตั้งค่าเสร็จ ไม่ต้องกรอกซ้ำ
  }

  // สร้าง/ลบ/รีเซ็ตรหัสผ่านบัญชีเจ้าหน้าที่ศาล — เจ้าหน้าที่ศาลคนไหนที่ล็อกอินอยู่ก็จัดการได้เท่ากันหมด
  // (ไม่มีระดับสิทธิ์สูงต่ำระหว่างบัญชีศาล เป็นกลุ่มที่เชื่อถือได้เท่ากันทั้งหมดตามที่ระบบออกแบบไว้)
  function createCourtAccount(name, password) {
    if (!name.trim() || !password) return;
    if (courtAccounts.some((a) => a.name === name.trim())) return; // กันชื่อซ้ำ
    setCourtAccounts((prev) => [...prev, { id: Date.now(), name: name.trim(), password }]);
  }
  function deleteCourtAccount(id) {
    setCourtAccounts((prev) => (prev.length <= 1 ? prev : prev.filter((a) => a.id !== id))); // ห้ามลบบัญชีสุดท้าย กันไม่มีใครเข้าระบบศาลได้เลย
  }
  function resetCourtPassword(id, newPassword) {
    if (!newPassword) return;
    setCourtAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, password: newPassword } : a)));
  }

  function resetDemoData() {
    setAccounts(seedAccounts());
    setCases(seedCases());
    window.storage.set("accounts", JSON.stringify(seedAccounts())).catch(() => {});
    window.storage.set("cases", JSON.stringify(seedCases())).catch(() => {});
  }

  function handleOfficerLogout() {
    setLoggedInOfficer(null);
    setRole(getPortalFromURL()); // ถ้า URL ระบุ portal ไว้ (เช่น ?portal=police) กลับไปหน้า login ฝั่งนั้นเลย ไม่โผล่หน้าเลือกพอร์ทัลอีกฝั่ง — จำลองพฤติกรรม URL แยกจริง
  }

  const enriched = useMemo(() => {
    return cases
      .filter((c) => !c.closed || true)
      .map((c) => {
        // จำนวนวันสะสมที่ใช้ไปแล้วจนถึงสิ้นสุดครั้งก่อนหน้า — ถ้าไม่มีค่าเก็บไว้ (คดีเก่า) ให้สมมติว่าทุกครั้งก่อนหน้าได้เต็ม 12 วัน
        // ใช้แค่คำนวณ "วันครบกำหนดครั้งถัดไป" ให้แม่นยำ ไม่ได้มีผลต่อการปิดคดี (ปิดคดีตัดสินจากจำนวนครั้ง 4/7 โดยตรง — ยืนยันกับศาลแล้ว)
        const cumulativeDays = c.cumulativeDays ?? (12 * (c.k - 1));
        const daysAvailable = 12; // ครั้งละไม่เกิน 12 วันเสมอตามกฎหมาย (กฎตายตัว ไม่ลดตามวันที่เหลือในเพดาน)
        const raw = toISO(addDays(fromISO(c.startDate), cumulativeDays));
        const legalDeadline = adjustToBusinessDay(raw, holidays); // วันครบกำหนดฝากขังจริง (เลื่อนถ้าตรงวันหยุด)
        const filingDeadline = previousBusinessDay(legalDeadline, holidays); // วันที่ต้องยื่นคำร้อง — ล่วงหน้า 1 วันทำการ ตามข้อ 5
        // ไฟล์ PDF ถูกลบอัตโนมัติ 12 วันหลังอัพโหลด — ถ้ายังไม่ถูกดาวน์โหลดก่อนหมดอายุ ถือว่าไฟล์หายแล้ว ต้องอัพโหลดใหม่
        const filePurgeDate = c.uploadedAt ? toISO(addDays(fromISO(c.uploadedAt), FILE_PURGE_DAYS)) : null;
        const fileExpired = Boolean(c.fileName && !c.downloaded && filePurgeDate && daysUntil(filePurgeDate) < 0);
        return { ...c, cumulativeDays, daysAvailable, rawDeadline: raw, legalDeadline, filingDeadline, filePurgeDate, fileExpired };
      })
      .map((c) => ({ ...c, status: deriveStatus(c) }));
  }, [cases, holidays]);

  // strict per-individual visibility: an officer sees only cases where they are the recorded owner —
  // not just "same station". No exceptions, even for colleagues at the same สภ.
  const officerCases = loggedInOfficer
    ? enriched
        .filter((c) => c.station === loggedInOfficer.station && c.officer === loggedInOfficer.name && !c.closed)
        .sort((a, b) => (a.filingDeadline < b.filingDeadline ? -1 : 1))
    : [];

  const courtQueue = enriched
    .filter((c) => !c.closed)
    .sort((a, b) => (a.filingDeadline < b.filingDeadline ? -1 : 1));

  // คดีที่ยังไม่มีพนักงานสอบสวนรับเป็นเจ้าของ (อาจมีหรือไม่มีสถานีก็ได้) — ใช้ทั้งฝั่งศาล (จับคู่สถานี/ดูรอรับ)
  // และฝั่งตำรวจ (กล่องจดหมายของสถานีตัวเอง)
  const unclaimedCases = enriched.filter((c) => !c.officer && !c.closed);

  const closedCases = enriched
    .filter((c) => c.closed && c.closedDate)
    .map((c) => {
      const purgeDate = toISO(addDays(fromISO(c.closedDate), PURGE_DAYS));
      return { ...c, purgeDate, daysToPurge: daysUntil(purgeDate) };
    })
    .sort((a, b) => a.daysToPurge - b.daysToPurge);

  // court officer verifies identity (e.g. against an official request from the station) and creates the
  // account with a password directly — no separate activation step; the officer just needs to be told
  // the password (in person / by phone) to log in immediately
  function createAccount(name, station, password) {
    if (!name.trim() || !password) return;
    setAccounts((prev) => [...prev, { id: Date.now(), name: name.trim(), station, password }]);
  }

  // court officer can remove an account outright — e.g. an officer transferred out and the station
  // never got around to asking for it to be deleted. Cases already tied to that name are unaffected;
  // the court can still reassign them to whoever takes over.
  // ลบบัญชีแล้ว คดีที่พนักงานคนนี้เป็นเจ้าของอยู่ (ที่ยังไม่ปิด) จะคืนกลับเป็น "ยังไม่มีเจ้าของ" อัตโนมัติ
  // (กลับไปอยู่ในกล่องจดหมายของสถานีเดิม ให้พนักงานคนอื่นในสถานีเดียวกันมารับต่อได้) — ตัดสินใจแล้วว่าไม่บล็อกการลบ
  // เหตุผล: พนักงานคนใหม่มาแทนต้องขอบัญชีใหม่หรือใช้ของเดิมอยู่แล้วตามขั้นตอนจริง ไม่จำเป็นต้องบังคับโอนย้ายก่อนลบ
  // คดีที่ปิดไปแล้วไม่แตะต้อง (เก็บชื่อเจ้าของเดิมไว้เป็นประวัติตามปกติ)
  function deleteAccount(id) {
    const account = accounts.find((a) => a.id === id);
    setAccounts((prev) => prev.filter((a) => a.id !== id));
    if (account) {
      setCases((prev) =>
        prev.map((c) =>
          !c.closed && c.officer === account.name && c.station === account.station
            ? { ...c, officer: null }
            : c
        )
      );
    }
  }

  // forgotten-password: court officer sets a new password directly and tells the officer, same as account creation
  function resetPassword(id, newPassword) {
    if (!newPassword) return;
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, password: newPassword } : a)));
  }

  // real login check against the password the court officer set
  function loginOfficer(station, name, password) {
    const account = accounts.find((a) => a.station === station && a.name === name);
    if (!account) return { ok: false, error: "ไม่พบบัญชีนี้" };
    if (account.password !== password) return { ok: false, error: "รหัสผ่านไม่ถูกต้อง" };
    return { ok: true };
  }

  // เจ้าหน้าที่ศาลลงข้อมูลฝากขังครั้งแรกสร้างชุดคดีล่วงหน้าทันที (ยังไม่มีสถานี/พนักงานผูกอยู่)
  // ระบบคำนวณวันครบกำหนด/วันต้องยื่นครั้งต่อไปได้ทันทีที่สร้าง โดยไม่ต้องรอตำรวจมาจับคู่หรือรับเป็นเจ้าของก่อน
  function createNumberBatch(type, from, to, year, startDate) {
    const start = Number(from), end = Number(to);
    if (!start || !end || start > end || !type || !startDate) return { ok: false, error: "กรอกข้อมูลให้ครบ (ช่วงเลขและวันที่ฝากขังครั้งแรก)" };
    const proposedNumbers = [];
    for (let n = start; n <= end; n++) proposedNumbers.push(`${type}${n}/${year}`);
    // กันเลขคดีซ้ำ — เช็คกับคดีทั้งหมดที่มีอยู่แล้วในระบบ (ทั้งกำลังดำเนินการและปิดไปแล้ว) ก่อนสร้าง
    // ถ้าเจอซ้ำแม้แต่เลขเดียว ปฏิเสธสร้างทั้งชุดทันที (ไม่สร้างบางส่วน) กันเลขคดีชนกันแบบเงียบๆ
    const existingNumbers = new Set(cases.map((c) => c.caseNumber));
    const duplicates = proposedNumbers.filter((num) => existingNumbers.has(num));
    if (duplicates.length > 0) {
      return { ok: false, error: `เลข ${duplicates.join(", ")} มีอยู่แล้วในระบบ กรุณาแก้ช่วงเลขใหม่` };
    }
    const idBase = Date.now();
    const batchId = idBase;
    const batch = [];
    for (let n = start; n <= end; n++) {
      const caseNumber = `${type}${n}/${year}`;
      batch.push({
        id: idBase + n, batchId, batchCreatedAt: toISO(new Date()),
        station: null, officer: null, caseNumber, startDate, k: 2, cap: 84, cumulativeDays: 12,
        fileName: null, downloaded: false, closed: false, createdAt: toISO(new Date()), history: [],
      });
    }
    setCases((prev) => [...prev, ...batch]);
    return { ok: true, batchId, count: batch.length, from: `${type}${start}/${year}`, to: `${type}${end}/${year}` };
  }

  // เจ้าหน้าที่ศาลจับคู่คดีกับสภ. — ยังไม่ผูกกับพนักงานคนใดคนหนึ่ง แค่ทำให้คดีนี้ไปโผล่เป็น
  // "กล่องจดหมาย" ที่พนักงานทุกคนของสภ.นั้นเห็นร่วมกันได้ จนกว่าจะมีคนมารับเป็นเจ้าของคดี
  function assignCaseStation(caseId, station) {
    setCases((prev) => prev.map((c) => (c.id === caseId ? { ...c, station } : c)));
  }

  // พนักงานสอบสวนคนใดคนหนึ่งของสภ.นั้น "รับเป็นเจ้าของคดี" จากกล่องจดหมายของสถานี
  // วันครบกำหนด/วันต้องยื่นคำนวณไว้ล่วงหน้าอยู่แล้วตั้งแต่ตอนสร้าง ไม่เปลี่ยนแปลงตอนรับ
  function claimForMe(caseId, officerName, officerStation) {
    const target = cases.find((c) => c.id === caseId);
    if (!target) return { ok: false, error: "ไม่พบคดีนี้แล้ว" };
    if (target.officer) return { ok: false, error: "มีคนรับเป็นเจ้าของคดีนี้ไปแล้ว" };
    if (target.station !== officerStation) return { ok: false, error: "คดีนี้ไม่ได้อยู่ในสถานีของท่าน" };
    setCases((prev) => prev.map((c) => (c.id === caseId ? { ...c, officer: officerName } : c)));
    return { ok: true, caseNumber: target.caseNumber };
  }

  // only the court officer can do this — moves ownership/visibility of a case to a different investigating officer
  // (e.g. when the original officer leaves or transfers), without ever letting other officers browse each other's cases
  function reassignOfficer(id, newOfficerName) {
    if (!newOfficerName.trim()) return;
    setCases((prev) => prev.map((c) => (c.id === id ? { ...c, officer: newOfficerName.trim() } : c)));
  }

  function uploadFile(id, fileName) {
    setCases((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const raw = rawDeadline(c.startDate, c.k);
        const legal = adjustToBusinessDay(raw, holidays);
        const filing = previousBusinessDay(legal, holidays);
        if (isPastCutoff(filing)) return c; // เลยเวลายื่นทางระบบแล้วตามข้อ 6 — ไม่มีผลใดๆ
        // อัพโหลดใหม่สำเร็จ -> เคลียร์ courtFlag (ถ้าเคยถูกศาลแจ้งว่าไฟล์ผิด) เพราะถือว่าพนักงานแก้ไขแล้ว
        // ไม่ลบไฟล์เดิม (fileName เก่า) ทันทีตอนศาลกดแจ้ง — ไฟล์เดิมจะถูกแทนที่ตอนนี้เองโดยธรรมชาติ (ตัดสินใจแล้ว)
        return { ...c, fileName, downloaded: false, uploadedAt: toISO(new Date()), courtFlag: null };
      })
    );
  }

  // เจ้าหน้าที่ศาลแจ้งว่าไฟล์ที่อัพโหลดมาไม่ถูกต้อง (เช่น ผิดคดี) หลังตรวจดูแล้ว — ให้พนักงานอัพโหลดใหม่แทน
  // นโยบาย (ยืนยันแล้ว): ไม่ลบไฟล์เดิมทันที เก็บไว้ก่อนเผื่อเทียบหลัง — จะถูกแทนที่ก็ต่อเมื่อพนักงานอัพไฟล์ใหม่สำเร็จ (ดู uploadFile ด้านบน)
  function flagWrongFile(id, reason) {
    if (!reason || !reason.trim()) return;
    setCases((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        if (c.closed || !c.fileName) return c; // คดีปิดแล้ว หรือยังไม่มีไฟล์ให้แจ้งว่าผิด -> ไม่มีผล
        return { ...c, courtFlag: { reason: reason.trim(), flaggedAt: toISO(new Date()) } };
      })
    );
  }

  // ฝั่งตำรวจ "คืนสำนวน" — พนักงานตรวจแล้วพบว่าเจ้าหน้าที่ศาลจับคู่สถานีผิด (ไม่ใช่คดีของสภ.ตัวเอง)
  // เคลียร์ station/officer/fileName กลับเป็นค่าว่างทั้งหมด ส่งคดีกลับไปที่กองจับคู่สถานีของศาลใหม่
  // เก็บ returnedNote ไว้บอกศาลว่าเคยจับคู่ผิดสถานีไหนมาแล้ว — ไม่บังคับกรอกเหตุผล (ตัดสินใจแล้ว) ใช้ข้อความอัตโนมัติแทน
  function returnToPool(id, reason) {
    setCases((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        if (c.closed) return c; // คดีปิดแล้ว -> ไม่มีผล
        return {
          ...c,
          station: null,
          officer: null,
          fileName: null,
          downloaded: false,
          courtFlag: null,
          returnedNote: { reason: (reason && reason.trim()) || "พนักงานสอบสวนแจ้งว่าไม่ใช่คดีของสถานีนี้", returnedFromStation: c.station, returnedAt: toISO(new Date()) },
        };
      })
    );
  }

  function downloadFile(id) {
    const target = cases.find((c) => c.id === id);
    if (!target || !target.fileName) return;
    if (target.uploadedAt && daysUntil(toISO(addDays(fromISO(target.uploadedAt), FILE_PURGE_DAYS))) < 0) return; // ไฟล์หมดอายุแล้ว (เกิน 12 วันหลังอัพโหลด) — ไม่มีผลใดๆ
    // simulate a real file download so "downloaded" reflects an actual browser action
    const blob = new Blob(
      [`ไฟล์จำลอง (prototype)\nเลขคดี: ${target.caseNumber}\nสถานี: ${target.station}\nชื่อไฟล์เดิม: ${target.fileName}`],
      { type: "application/pdf" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = target.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setCases((prev) => prev.map((c) => (c.id === id ? { ...c, downloaded: true } : c)));
  }

  // actualDays: จำนวนวันที่ศาลอนุญาตจริงสำหรับครั้งนี้ — ถ้าไม่ระบุ ใช้ค่า daysAvailable ที่คำนวณไว้ (ปกติ 12 วัน
  // เว้นแต่ใกล้เพดานรวมแล้วจะถูกจำกัดไว้ไม่เกินวันที่เหลือโดยอัตโนมัติอยู่แล้ว) — ใช้เมื่อศาลให้ไม่ครบ 12 วันในบางครั้ง
  function receive(id, actualDays = null) {
    setCases((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        if (!c.fileName || !c.downloaded) return c; // no effect until the file has actually been downloaded
        const cumulativeDays = c.cumulativeDays ?? (12 * (c.k - 1));
        const daysAvailable = 12; // ครั้งละไม่เกิน 12 วันตามกฎหมาย — ไม่ลดตามวันที่เหลือในเพดานอีกต่อไป (ปิดคดีตัดสินจากจำนวนครั้งแทน)
        const grantedDays = actualDays != null ? Math.max(1, Math.min(12, Number(actualDays))) : daysAvailable;
        const raw = toISO(addDays(fromISO(c.startDate), cumulativeDays));
        const legal = adjustToBusinessDay(raw, holidays);
        const filing = previousBusinessDay(legal, holidays);
        const newCumulativeDays = cumulativeDays + grantedDays;
        const historyEntry = { k: c.k, filingDeadline: filing, legalDeadline: legal, fileName: c.fileName, receivedDate: toISO(new Date()), daysGranted: grantedDays };
        const history = [...(c.history || []), historyEntry];
        // ปิดคดีเมื่อครบจำนวนครั้ง (4 หรือ 7) — ไม่ต้องเช็ควันสะสมเพิ่ม เพราะทุกครั้งฝากขังได้ไม่เกิน 12 วันอยู่แล้ว
        // (เป็นกฎตายตัว) ทำให้จำนวนครั้งถึงเพดานเสมอก่อนหรือพร้อมกับวันสะสม ไม่มีทางที่วันสะสมถึงก่อนจำนวนครั้ง
        const capMaxK = c.cap === 48 ? 4 : c.cap === 84 ? 7 : null;
        if (capMaxK && c.k >= capMaxK) return { ...c, closed: true, closedDate: toISO(new Date()), fileName: null, downloaded: false, cumulativeDays: newCumulativeDays, history };
        return { ...c, k: c.k + 1, fileName: null, downloaded: false, cumulativeDays: newCumulativeDays, history };
      })
    );
  }

  // เจ้าหน้าที่ศาลแก้เพดานได้ทุกเมื่อ อิสระจากการรับเรื่อง (ค่าเริ่มต้นของทุกคดีคือ 84 วัน/7 ครั้ง
  // เจ้าหน้าที่ศาลเป็นคนลดเหลือ 48 วัน/4 ครั้งเองถ้าคดีนั้นเข้าเกณฑ์)
  // กันไว้สองชั้น (ไม่ใช่แค่ซ่อนปุ่มฝั่ง UI): ถ้าคดีเลยครั้งที่ 4 ไปแล้ว ห้ามตั้งเพดาน 48 วัน เพราะจะทำให้
  // อยู่ในสถานะขัดแย้งกันเอง (ครั้งปัจจุบันเกินเพดานใหม่ทันที) — ฟังก์ชันนี้ไม่มีผลเงียบๆ ถ้าขัดเงื่อนไข
  function updateCap(id, cap) {
    setCases((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const maxK = cap === 48 ? 4 : cap === 84 ? 7 : null;
        if (maxK && c.k > maxK) return c; // ขัดแย้งกับครั้งปัจจุบัน -> ไม่มีผล
        return { ...c, cap };
      })
    );
  }

  function addHoliday() {
    if (!holidayForm.date || !holidayForm.label.trim()) return;
    setHolidays((prev) => [...prev, { date: holidayForm.date, label: holidayForm.label.trim() }].sort((a, b) => (a.date < b.date ? -1 : 1)));
    setHolidayForm({ date: "", label: "" });
  }
  function removeHoliday(date) {
    setHolidays((prev) => prev.filter((h) => h.date !== date));
  }

  // ยังไม่ได้เลือก/ไม่มี URL hash ที่รู้จัก -> จำลองหน้า "เลือกพอร์ทัล" (เหมือนหน้า landing ก่อนแยกไป URL คนละหน้า)
  if (!role) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ backgroundColor: paper, fontFamily: sans, color: ink }}>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700;800&display=swap');`}</style>
        <div className="max-w-lg w-full text-center space-y-6">
          <div>
            <Scale size={32} className="mx-auto mb-2" color={ink} />
            <h1 className="text-xl font-bold" style={{ fontFamily: serif }}>ระบบติดตามคำร้องขอฝากขัง</h1>
            <p className="text-sm mt-1" style={{ color: "#8A836B" }}>ศาลจังหวัดอุดรธานี — เลือกช่องทางเข้าใช้งานของท่าน</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button
              onClick={() => goTo("police")}
              className="rounded-xl p-6 text-left space-y-2 transition hover:opacity-90"
              style={{ backgroundColor: paperCard, border: `2px solid ${line}` }}
            >
              <Shield size={22} color={slate} />
              <p className="font-bold" style={{ fontFamily: serif }}>พนักงานสอบสวน</p>
              <p className="text-xs" style={{ color: "#8A836B" }}>สำหรับเจ้าหน้าที่ตำรวจ 23 สถานีในจังหวัดอุดรธานี</p>
            </button>
            <button
              onClick={() => goTo("court")}
              className="rounded-xl p-6 text-left space-y-2 transition hover:opacity-90"
              style={{ backgroundColor: paperCard, border: `2px solid ${line}` }}
            >
              <Scale size={22} color={brass} />
              <p className="font-bold" style={{ fontFamily: serif }}>เจ้าหน้าที่ศาล</p>
              <p className="text-xs" style={{ color: "#8A836B" }}>สำหรับเจ้าหน้าที่ศาลจังหวัดอุดรธานี</p>
            </button>
          </div>
          <p className="text-[11px]" style={{ color: "#8A836B" }}>
            ในระบบจริง สองส่วนนี้จะอยู่คนละ URL กันเลย (เช่น /police กับ /court) — ในเดโมนี้จำลองด้วย query param แทน
            เติม <code>?portal=police</code> หรือ <code>?portal=court</code> ท้ายลิงก์หน้านี้ แล้วรีเฟรช จะข้ามหน้าเลือกพอร์ทัลไปเข้าฝั่งนั้นตรงๆ ทันที (ไม่มีทางเห็น/กดสลับไปอีกฝั่งจากในนั้นเลย ต้อง "ออกจากระบบ" ก่อนเสมอ — เหมือนพฤติกรรม URL แยกจริง)
          </p>
          <button onClick={resetDemoData} className="text-[11px] underline" style={{ color: "#8A836B" }}>
            ล้างข้อมูลทั้งหมด เริ่มใหม่ (เผื่อข้อมูลเพี้ยนระหว่างทดสอบ)
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: paper, fontFamily: sans, color: ink }}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700;800&display=swap');`}</style>

      {/* header */}
      <header className="px-4 sm:px-6 py-4 sm:py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3" style={{ backgroundColor: ink }}>
        <div className="flex items-center gap-3">
          <Scale size={24} color={paper} className="shrink-0" />
          <div>
            <h1 className="text-base sm:text-lg leading-tight" style={{ fontFamily: serif, fontWeight: 700, color: paper }}>
              ระบบติดตามคำร้องขอฝากขัง
            </h1>
            <p className="text-xs" style={{ color: "#B9C2CE" }}>ศาลจังหวัดอุดรธานี · ต้นแบบสาธิตการทำงาน</p>
          </div>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto px-3 py-1.5 rounded-full" style={{ backgroundColor: "#26364F" }}>
          {role === "police" ? <Shield size={14} color={paper} /> : <Scale size={14} color={paper} />}
          <span className="text-xs sm:text-sm font-medium" style={{ color: paper }}>
            {role === "police" ? "พอร์ทัลพนักงานสอบสวน" : "พอร์ทัลเจ้าหน้าที่ศาล"}
          </span>
        </div>
      </header>

      {/* disclaimer strip */}
      <div className="px-6 py-2 text-xs flex flex-wrap gap-x-6 gap-y-1" style={{ backgroundColor: brassBg, color: "#6B4A17", borderBottom: `1px solid ${line}` }}>
        <span>✓ ใช้กฎ "ยื่นล่วงหน้า 1 วันทำการ" ตามข้อ 5 ระเบียบศาลจังหวัดอุดรธานี ว่าด้วยการฝากขังทางจอภาพ พ.ศ.2569 แล้ว</span>
        <span>ระบบเป็นเพียงเครื่องมือช่วยเตือน พนักงานสอบสวนต้องตรวจสอบกำหนดเวลาด้วยตนเอง</span>
      </div>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {role === "police" ? (
          <OfficerView
            accounts={accounts} loginOfficer={loginOfficer}
            loggedInOfficer={loggedInOfficer} setLoggedInOfficer={setLoggedInOfficer} onLogout={handleOfficerLogout}
            unclaimedCases={unclaimedCases} claimForMe={claimForMe} returnToPool={returnToPool}
            officerCases={officerCases} uploadFile={uploadFile}
          />
        ) : !loggedInCourt ? (
          <CourtLoginScreen courtAccounts={courtAccounts} loginCourt={loginCourt} onLogin={handleCourtLogin} createFirstCourtAccount={createFirstCourtAccount} />
        ) : (
          <>
            <div className="rounded-lg p-3 flex items-center justify-between mb-4" style={{ backgroundColor: paperCard, border: `1px solid ${line}` }}>
              <p className="text-xs font-semibold flex items-center gap-1"><Scale size={13} /> {loggedInCourt.name}</p>
              <button onClick={handleCourtLogout} className="text-[11px] font-semibold underline" style={{ color: slate }}>ออกจากระบบ</button>
            </div>
            <NumberPoolPanel unclaimedCases={unclaimedCases} createNumberBatch={createNumberBatch} assignCaseStation={assignCaseStation} />
            <CourtView
              courtQueue={courtQueue} closedCases={closedCases} receive={receive} updateCap={updateCap}
              downloadFile={downloadFile} flagWrongFile={flagWrongFile} reassignOfficer={reassignOfficer} assignCaseStation={assignCaseStation}
              accounts={accounts} createAccount={createAccount} deleteAccount={deleteAccount} resetPassword={resetPassword}
              courtAccounts={courtAccounts} createCourtAccount={createCourtAccount} deleteCourtAccount={deleteCourtAccount} resetCourtPassword={resetCourtPassword} currentCourtName={loggedInCourt.name}
              holidays={holidays} holidayForm={holidayForm} setHolidayForm={setHolidayForm}
              addHoliday={addHoliday} removeHoliday={removeHoliday}
            />
          </>
        )}
      </main>
    </div>
  );
}

/* ---------- เพิ่มคำร้องฝากขังครั้งที่ 1 (สร้างชุดเลขรับฝาก ยฝ./ฝ. ล่วงหน้า) ---------- */
function NumberPoolPanel({ unclaimedCases, createNumberBatch, assignCaseStation }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("ยฝ.");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [year, setYear] = useState(DEFAULT_POOL_YEAR);
  const [startDate, setStartDate] = useState(genDate(0));
  const [result, setResult] = useState(null);
  const [openBatchId, setOpenBatchId] = useState(null);
  const [editingStationId, setEditingStationId] = useState(null); // id ของคดีที่กำลังแก้ไขสถานี (ก่อนตำรวจรับจับคู่เท่านั้น)

  const needsStation = unclaimedCases.filter((c) => !c.station);
  const awaitingClaim = unclaimedCases.filter((c) => c.station); // จับคู่สภ.แล้ว แต่ยังไม่มีพนักงานคนไหนมารับเป็นเจ้าของคดี

  // จัดกลุ่มคดีที่ยังรอจับคู่สถานี แยกตาม "ชุด" ที่สร้างแต่ละครั้ง ใหม่สุดอยู่บนสุด
  const batches = useMemo(() => {
    const map = new Map();
    needsStation.forEach((c) => {
      const key = c.batchId || "unknown";
      if (!map.has(key)) map.set(key, { batchId: key, createdAt: c.batchCreatedAt, items: [] });
      map.get(key).items.push(c);
    });
    return Array.from(map.values()).sort((a, b) => (b.batchId || 0) - (a.batchId || 0));
  }, [needsStation]);

  function handleCreate() {
    const r = createNumberBatch(type, from, to, year, startDate);
    if (!r.ok) { setResult({ ok: false, msg: r.error }); return; }
    setResult({ ok: true, msg: `สร้างคดี ${r.from} ถึง ${r.to} แล้ว (${r.count} คดี) — คำนวณวันครบกำหนด/วันต้องยื่นให้แล้วทันที` });
    setFrom(""); setTo("");
    setOpenBatchId(r.batchId); // เปิดโชว์เฉพาะชุดที่เพิ่งสร้างให้จับคู่ทันที ชุดอื่นพับเก็บไว้
  }

  return (
    <div className="rounded-lg mb-4" style={{ backgroundColor: paperCard, border: `1px solid ${line}` }}>
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-4 py-3">
        <span className="text-sm font-bold flex items-center gap-1.5" style={{ fontFamily: serif }}>
          <Plus size={16} /> เพิ่มคำร้องฝากขังครั้งที่ 1
        </span>
        <span className="text-xs flex items-center gap-3" style={{ color: "#8A836B" }}>
          <span>รอจับคู่สภ. {needsStation.length} · รอพนักงานรับ {awaitingClaim.length}</span>
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4" style={{ borderTop: `1px dashed ${line}` }}>
          <div className="space-y-3 pt-3">
            <p className="text-xs" style={{ color: "#8A836B" }}>ลงข้อมูลฝากขังครั้งแรก — ระบบคำนวณวันครบกำหนด/วันต้องยื่นครั้งต่อไปให้ทันที ไม่ต้องรอจับคู่สถานีหรือรอพนักงานมารับก่อน</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <label className="text-xs" style={{ color: "#5B5540" }}>ประเภท</label>
                <select value={type} onChange={(e) => setType(e.target.value)} className="w-full rounded-md px-2 py-2 text-sm mt-1" style={{ border: `1px solid ${line}`, backgroundColor: "#fff" }}>
                  <option value="ยฝ.">ยฝ. (ยาเสพติด)</option>
                  <option value="ฝ.">ฝ. (คดีทั่วไป)</option>
                </select>
              </div>
              <div>
                <label className="text-xs" style={{ color: "#5B5540" }}>เลขเริ่ม</label>
                <input type="number" min="1" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="1" className="w-full rounded-md px-2 py-2 text-sm mt-1" style={{ border: `1px solid ${line}` }} />
              </div>
              <div>
                <label className="text-xs" style={{ color: "#5B5540" }}>ถึงเลข</label>
                <input type="number" min="1" value={to} onChange={(e) => setTo(e.target.value)} placeholder="50" className="w-full rounded-md px-2 py-2 text-sm mt-1" style={{ border: `1px solid ${line}` }} />
              </div>
              <div>
                <label className="text-xs" style={{ color: "#5B5540" }}>ปี พ.ศ.</label>
                <input type="number" value={year} onChange={(e) => setYear(e.target.value)} className="w-full rounded-md px-2 py-2 text-sm mt-1" style={{ border: `1px solid ${line}` }} />
              </div>
            </div>
            <div>
              <label className="text-xs" style={{ color: "#5B5540" }}>วันที่ฝากขังครั้งแรก (ใช้คำนวณวันครบกำหนดครั้งที่ 2)</label>
              <div className="mt-1"><ThaiDateInput value={startDate} onChange={setStartDate} /></div>
            </div>
            {result && <p className="text-xs font-semibold" style={{ color: result.ok ? sealGreen : sealRed }}>{result.msg}</p>}
            <button onClick={handleCreate} disabled={!from || !to || !startDate} className="w-full rounded-md py-2 text-sm font-semibold disabled:opacity-40" style={{ backgroundColor: ink, color: paper }}>
              สร้างชุดคดี
            </button>
          </div>

          <div className="space-y-2" style={{ borderTop: `1px dashed ${line}`, paddingTop: 12 }}>
            <p className="text-xs font-semibold" style={{ color: "#5B5540" }}>จับคู่สถานีแล้ว รอพนักงานสอบสวนมารับเป็นเจ้าของคดี ({awaitingClaim.length} คดี)</p>
            <p className="text-[11px]" style={{ color: "#8A836B" }}>จับคู่ผิดพลาด? แก้ไขได้เองตรงนี้เลย ตราบใดที่ยังไม่มีพนักงานคนไหนรับเป็นเจ้าของคดี — พอมีคนรับไปแล้ว ต้องให้พนักงานคนนั้นกด "คืนสำนวน" แทน</p>
            {awaitingClaim.length === 0 && <p className="text-xs py-2 text-center" style={{ color: "#8A836B" }}>ไม่มีคดีที่รอพนักงานรับตอนนี้</p>}
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {awaitingClaim.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5" style={{ backgroundColor: "#fff", border: `1px solid ${line}` }}>
                  <span className="text-xs font-semibold">{c.caseNumber}</span>
                  {editingStationId === c.id ? (
                    <div className="flex items-center gap-1.5">
                      <select
                        defaultValue={c.station}
                        onChange={(e) => { assignCaseStation(c.id, e.target.value); setEditingStationId(null); }}
                        className="text-xs rounded px-1.5 py-1"
                        style={{ border: `1px solid ${brass}` }}
                      >
                        {STATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <button onClick={() => setEditingStationId(null)} className="text-[11px]" style={{ color: "#8A836B" }}>ยกเลิก</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-xs" style={{ color: "#8A836B" }}>{c.station}</span>
                      <button onClick={() => setEditingStationId(c.id)} className="text-[11px] underline" style={{ color: slate }}>แก้ไข</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2" style={{ borderTop: `1px dashed ${line}`, paddingTop: 12 }}>
            <p className="text-xs font-semibold" style={{ color: "#5B5540" }}>จับคู่คดีกับสถานี — แยกเป็นชุดตามที่สร้างแต่ละครั้ง ({needsStation.length} คดีรอจับคู่ทั้งหมด)</p>
            {batches.length === 0 && <p className="text-xs py-2 text-center" style={{ color: "#8A836B" }}>ไม่มีเลขที่รอจับคู่สถานี</p>}
            <div className="space-y-2">
              {batches.map((b) => {
                const isOpen = openBatchId === b.batchId;
                return (
                  <div key={b.batchId} className="rounded-md overflow-hidden" style={{ border: `1px solid ${line}` }}>
                    <button
                      onClick={() => setOpenBatchId(isOpen ? null : b.batchId)}
                      className="w-full flex items-center justify-between px-3 py-2"
                      style={{ backgroundColor: isOpen ? slateBg : "#fff" }}
                    >
                      <span className="text-xs font-semibold flex items-center gap-1.5">
                        {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        ชุดสร้างเมื่อ {formatThai(b.createdAt)}
                      </span>
                      <span className="text-[11px] font-bold" style={{ color: brass }}>{b.items.length} คดีรอจับคู่</span>
                    </button>
                    {isOpen && (
                      <div className="p-2 space-y-1.5" style={{ backgroundColor: paper }}>
                        {b.items.map((c) => (
                          <div key={c.id} className="rounded-md px-2.5 py-1.5" style={{ backgroundColor: "#fff", border: `1px solid ${c.returnedNote ? sealRed : line}` }}>
                            {c.returnedNote && (
                              <p className="text-[10px] mb-1 flex items-start gap-1" style={{ color: sealRed }}>
                                <AlertTriangle size={10} className="shrink-0 mt-0.5" />
                                คืนสำนวนจาก {c.returnedNote.returnedFromStation || "สถานีเดิม"}: "{c.returnedNote.reason}" ({formatThai(c.returnedNote.returnedAt)}) — โปรดเลือกสถานีใหม่ให้ถูกต้อง
                              </p>
                            )}
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold">{c.caseNumber}</span>
                              <select
                                defaultValue=""
                                onChange={(e) => e.target.value && assignCaseStation(c.id, e.target.value)}
                                className="text-xs rounded px-2 py-1"
                                style={{ border: `1px solid ${line}`, backgroundColor: "#fff" }}
                              >
                                <option value="">— เลือกสภ. —</option>
                                {STATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


/* ---------- court officer login (multiple privileged accounts, provisioned outside this app) ---------- */
function CourtLoginScreen({ courtAccounts, loginCourt, onLogin, createFirstCourtAccount }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  // ตั้งค่าครั้งแรก: ฟอร์มแยกต่างหาก ใช้ตอนยังไม่มีบัญชีเจ้าหน้าที่ศาลเลยในระบบ
  const [setupName, setSetupName] = useState("");
  const [setupPassword, setSetupPassword] = useState("");
  const [setupConfirm, setSetupConfirm] = useState("");

  function handleSubmit() {
    const result = loginCourt(username.trim(), password);
    if (result.ok) {
      setError("");
      onLogin(username.trim());
    } else {
      setError(result.error);
    }
  }

  // ยังไม่มีบัญชีเจ้าหน้าที่ศาลเลยในระบบ -> โชว์ฟอร์ม "ตั้งค่าบัญชีแรก" แทนฟอร์ม login ปกติ
  // ใช้ได้ครั้งเดียวตอนระบบว่างเปล่าจริงๆ เท่านั้น พอมีบัญชีแรกแล้วจะไม่เห็นฟอร์มนี้อีก (กลับไปเป็นฟอร์ม login ปกติ)
  if (courtAccounts.length === 0) {
    const passwordsMatch = setupPassword && setupPassword === setupConfirm;
    return (
      <div className="max-w-md mx-auto rounded-lg p-5 space-y-3" style={{ backgroundColor: paperCard, border: `2px solid ${brass}` }}>
        <h3 className="text-sm font-bold flex items-center gap-1.5" style={{ fontFamily: serif, color: brass }}><UserPlus size={15} /> ตั้งค่าบัญชีแรกของระบบ</h3>
        <p className="text-[11px]" style={{ color: "#8A836B" }}>
          ยังไม่มีบัญชีเจ้าหน้าที่ศาลเลยในระบบนี้ — สร้างบัญชีแรกเพื่อเริ่มใช้งานได้เลย (หลังจากนี้จะสร้างบัญชีเพิ่มได้จากหน้า "บัญชีผู้ใช้" หลังล็อกอินเท่านั้น ฟอร์มนี้จะไม่โผล่มาอีก)
        </p>
        <div>
          <label className="text-xs font-semibold" style={{ color: "#5B5540" }}>ชื่อ-ตำแหน่ง เจ้าหน้าที่ศาล</label>
          <input value={setupName} onChange={(e) => setSetupName(e.target.value)} placeholder="เช่น จนท.ศาลจังหวัดอุดรธานี" className="w-full rounded-md px-3 py-2 text-sm mt-1" style={{ border: `1px solid ${line}` }} />
        </div>
        <div>
          <label className="text-xs font-semibold" style={{ color: "#5B5540" }}>ตั้งรหัสผ่าน</label>
          <input type="password" value={setupPassword} onChange={(e) => setSetupPassword(e.target.value)} className="w-full rounded-md px-3 py-2 text-sm mt-1" style={{ border: `1px solid ${line}` }} />
        </div>
        <div>
          <label className="text-xs font-semibold" style={{ color: "#5B5540" }}>ยืนยันรหัสผ่าน</label>
          <input type="password" value={setupConfirm} onChange={(e) => setSetupConfirm(e.target.value)} className="w-full rounded-md px-3 py-2 text-sm mt-1" style={{ border: `1px solid ${line}` }} />
          {setupConfirm && !passwordsMatch && <p className="text-[11px] mt-1" style={{ color: sealRed }}>รหัสผ่านทั้งสองช่องไม่ตรงกัน</p>}
        </div>
        <p className="text-[11px]" style={{ color: brass }}>
          แนะนำให้สร้างบัญชีเจ้าหน้าที่ศาลไว้อย่างน้อย 2 บัญชีตั้งแต่ต้น (สร้างเพิ่มได้ทีหลังจากหน้า "บัญชีผู้ใช้") เผื่อกรณีลืมรหัสผ่าน — ระบบยังไม่มีอีเมล/SMS กู้คืนรหัสผ่าน ถ้ามีบัญชีเดียวแล้วลืมรหัส จะไม่มีใครช่วยรีเซ็ตให้ได้เลย
        </p>
        <button
          onClick={() => createFirstCourtAccount(setupName, setupPassword)}
          disabled={!setupName.trim() || !passwordsMatch}
          className="w-full rounded-md py-2 text-sm font-semibold disabled:opacity-40"
          style={{ backgroundColor: brass, color: "#fff" }}
        >
          สร้างบัญชีแรกและเข้าสู่ระบบ
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto rounded-lg p-5 space-y-3" style={{ backgroundColor: paperCard, border: `1px solid ${line}` }}>
      <h3 className="text-sm font-bold flex items-center gap-1.5" style={{ fontFamily: serif }}><Scale size={15} /> เข้าสู่ระบบเจ้าหน้าที่ศาล</h3>
      <p className="text-[11px]" style={{ color: "#8A836B" }}>บัญชีกลุ่มนี้แยกต่างหากจากบัญชีพนักงานสอบสวนโดยสิ้นเชิง — จัดทำโดยฝ่ายไอทีของศาลตั้งแต่ตั้งระบบ ไม่ได้เปิดให้สมัคร/เปิดใช้งานเองแบบฝั่งตำรวจ (รองรับได้หลายบัญชีถ้ามีเจ้าหน้าที่ศาลมากกว่า 1 คน สร้างเพิ่มได้จากหน้า "บัญชีผู้ใช้" หลังล็อกอิน)</p>
      <div>
        <label className="text-xs font-semibold" style={{ color: "#5B5540" }}>ชื่อผู้ใช้</label>
        <input
          list="court-name-suggestions"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full rounded-md px-3 py-2 text-sm mt-1"
          style={{ border: `1px solid ${line}` }}
        />
        <datalist id="court-name-suggestions">
          {courtAccounts.map((a) => <option key={a.id} value={a.name} />)}
        </datalist>
      </div>
      <div>
        <label className="text-xs font-semibold" style={{ color: "#5B5540" }}>รหัสผ่าน</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-md px-3 py-2 text-sm mt-1" style={{ border: `1px solid ${line}` }} />
      </div>
      {error && <p className="text-[11px]" style={{ color: sealRed }}>{error}</p>}
      <button onClick={handleSubmit} disabled={!username || !password} className="w-full rounded-md py-2 text-sm font-semibold disabled:opacity-40" style={{ backgroundColor: ink, color: paper }}>
        เข้าสู่ระบบ
      </button>
      <ForgotCourtPasswordNote />
    </div>
  );
}

/* ---------- forgot-password help note (court login) ---------- */
// ระบบยังไม่มีระบบกู้คืนรหัสผ่านผ่านอีเมล/SMS จริง (ตาม TODO ที่ยังค้างอยู่) — จุดนี้อธิบายทางออกที่มีอยู่ตอนนี้ให้ชัดเจน
// แทนที่จะปล่อยให้คนลืมรหัสผ่านแล้วงงว่าต้องทำยังไง
function ForgotCourtPasswordNote() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} className="text-[11px] underline w-full text-center" style={{ color: slate }}>
        ลืมรหัสผ่าน?
      </button>
      {open && (
        <div className="mt-2 p-2.5 rounded-md text-[11px] space-y-1.5" style={{ backgroundColor: brassBg, color: "#5B5540" }}>
          <p><strong>ถ้ามีเจ้าหน้าที่ศาลบัญชีอื่นที่ยังเข้าระบบได้อยู่:</strong> ให้เพื่อนร่วมงานล็อกอิน แล้วไปที่หน้า "บัญชีผู้ใช้" กด "ตั้งรหัสผ่านใหม่" ให้บัญชีที่ลืมรหัสผ่านได้เลย</p>
          <p><strong>ถ้าไม่มีบัญชีอื่นเข้าระบบได้เลย:</strong> ระบบนี้ยังไม่มีระบบกู้คืนรหัสผ่านผ่านอีเมล/SMS อัตโนมัติ ต้องติดต่อฝ่ายไอทีของศาลให้ช่วยรีเซ็ตให้จากฐานข้อมูลโดยตรง — เพื่อป้องกันปัญหานี้ในอนาคต แนะนำให้สร้างบัญชีเจ้าหน้าที่ศาลไว้อย่างน้อย 2 บัญชีเสมอ</p>
        </div>
      )}
    </div>
  );
}

/* ---------- officer view ---------- */
function OfficerView({ accounts, loginOfficer, loggedInOfficer, setLoggedInOfficer, onLogout, unclaimedCases, claimForMe, returnToPool, officerCases, uploadFile }) {
  const [loginStation, setLoginStation] = useState(STATIONS[0]);
  const [loginName, setLoginName] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [officerSearch, setOfficerSearch] = useState("");
  const [claimError, setClaimError] = useState("");
  const [claimSuccess, setClaimSuccess] = useState("");
  const [returningId, setReturningId] = useState(null);

  function submitReturn(id) {
    returnToPool(id);
    setReturningId(null);
  }

  const accountsAtStation = accounts.filter((a) => a.station === loginStation);

  function handleLogin() {
    const result = loginOfficer(loginStation, loginName, loginPassword);
    if (!result.ok) { setLoginError(result.error); return; }
    setLoginError("");
    setLoggedInOfficer({ name: loginName, station: loginStation });
  }

  function handleClaim(poolId) {
    const result = claimForMe(poolId, loggedInOfficer.name, loggedInOfficer.station);
    if (!result.ok) { setClaimError(result.error); setClaimSuccess(""); return; }
    setClaimError("");
    setClaimSuccess(`รับเป็นเจ้าของคดี ${result.caseNumber} แล้ว — เพิ่มเข้าทะเบียนคดีของท่านแล้ว`);
    setTimeout(() => setClaimSuccess(""), 4000);
  }

  // logged-out state: single login form — accounts are created directly by the court officer,
  // who tells the officer their password in person/by phone (no self-registration step at all)
  if (!loggedInOfficer) {
    return (
      <div className="max-w-md mx-auto rounded-lg p-5 space-y-3" style={{ backgroundColor: paperCard, border: `1px solid ${line}` }}>
        <h3 className="text-sm font-bold flex items-center gap-1.5" style={{ fontFamily: serif }}><Shield size={15} /> เข้าสู่ระบบพนักงานสอบสวน</h3>
        <div>
          <label className="text-xs font-semibold flex items-center gap-1 mb-1" style={{ color: "#5B5540" }}><Building2 size={13} /> สถานี</label>
          <select
            value={loginStation}
            onChange={(e) => { setLoginStation(e.target.value); setLoginName(""); }}
            className="w-full rounded-md px-3 py-2 text-sm"
            style={{ border: `1px solid ${line}`, backgroundColor: "#fff" }}
          >
            {STATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold flex items-center gap-1 mb-1" style={{ color: "#5B5540" }}><User size={13} /> ชื่อ</label>
          <input
            list="officer-name-suggestions"
            value={loginName}
            onChange={(e) => setLoginName(e.target.value)}
            placeholder="พิมพ์ชื่อ-ยศของท่าน"
            className="w-full rounded-md px-3 py-2 text-sm"
            style={{ border: `1px solid ${line}`, backgroundColor: "#fff" }}
          />
          <datalist id="officer-name-suggestions">
            {accountsAtStation.map((a) => <option key={a.id} value={a.name} />)}
          </datalist>
          {accountsAtStation.length === 0 && (
            <p className="text-[11px] mt-1" style={{ color: brass }}>ยังไม่มีบัญชีในสถานีนี้ — ติดต่อเจ้าหน้าที่ศาลจังหวัดอุดรธานีให้สร้างบัญชีให้</p>
          )}
        </div>
        <div>
          <label className="text-xs font-semibold flex items-center gap-1 mb-1" style={{ color: "#5B5540" }}><Lock size={13} /> รหัสผ่าน</label>
          <input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} className="w-full rounded-md px-3 py-2 text-sm" style={{ border: `1px solid ${line}` }} />
          <p className="text-[10px] mt-1" style={{ color: "#8A836B" }}>รับบัญชี/รหัสผ่านจากเจ้าหน้าที่ศาลจังหวัดอุดรธานี — ลืมรหัสผ่านก็ติดต่อให้ตั้งใหม่ให้ได้เช่นกัน</p>
        </div>
        {loginError && <p className="text-[11px]" style={{ color: sealRed }}>{loginError}</p>}
        <button
          disabled={!loginName || !loginPassword}
          onClick={handleLogin}
          className="w-full rounded-md py-2 text-sm font-semibold disabled:opacity-40"
          style={{ backgroundColor: ink, color: paper }}
        >
          เข้าสู่ระบบ
        </button>
      </div>
    );
  }

  const officerName = loggedInOfficer.name, officerStation = loggedInOfficer.station;
  return (
    <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6">
      <div className="space-y-4">
        <div className="rounded-lg p-4 flex items-center justify-between" style={{ backgroundColor: paperCard, border: `1px solid ${line}` }}>
          <div className="text-base">
            <p className="font-bold flex items-center gap-1.5" style={{ fontFamily: serif }}><User size={16} /> {officerName}</p>
            <p className="text-sm" style={{ color: "#8A836B" }}>{officerStation}</p>
          </div>
          <button onClick={onLogout} className="text-sm font-semibold underline" style={{ color: slate }}>ออกจากระบบ</button>
        </div>

        <div className="rounded-lg p-4 space-y-3" style={{ backgroundColor: paperCard, border: `1px solid ${line}` }}>
          <h3 className="text-lg font-bold flex items-center gap-1.5" style={{ fontFamily: serif }}>
            <Inbox size={18} /> คดีที่รอรับเป็นเจ้าของ ({officerStation})
          </h3>
          <p className="text-xs" style={{ color: "#8A836B" }}>เจ้าหน้าที่ศาลจับคู่คำร้องฝากขังครั้งที่ 1 (ยฝ./ฝ.) กับสถานีของท่านไว้แล้ว — วันครบกำหนดคำนวณไว้ล่วงหน้าแล้ว พนักงานคนใดคนหนึ่งของสถานีนี้กด "รับเป็นเจ้าของคดี" เพื่อเริ่มติดตามต่อ</p>
          {claimError && <p className="text-xs font-semibold" style={{ color: sealRed }}>{claimError}</p>}
          {claimSuccess && <p className="text-xs font-semibold" style={{ color: sealGreen }}>{claimSuccess}</p>}
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {unclaimedCases.filter((c) => c.station === officerStation).map((c) => (
              <div key={c.id} className="rounded-md px-3 py-2" style={{ backgroundColor: "#fff", border: `1px solid ${line}` }}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-sm">{c.caseNumber}</span>
                    <span className="text-[11px] ml-2" style={{ color: "#8A836B" }}>{caseTypeLabel(c.caseNumber)}</span>
                    <p className="text-[11px]" style={{ color: c.status === "overdue" || c.status === "blocked" ? sealRed : "#8A836B" }}>ต้องยื่นครั้งที่ 2 ภายใน {formatThai(c.filingDeadline)}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => handleClaim(c.id)} className="text-xs font-semibold px-3 py-1.5 rounded-md" style={{ backgroundColor: ink, color: paper }}>
                      รับเป็นเจ้าของคดี
                    </button>
                    {returningId !== c.id && (
                      <button onClick={() => setReturningId(c.id)} className="text-[11px] underline" style={{ color: sealRed }}>
                        คืนสำนวน
                      </button>
                    )}
                  </div>
                </div>
                {returningId === c.id && (
                  <div className="mt-2 p-2 rounded-md flex items-center justify-between gap-2" style={{ backgroundColor: sealRedBg, border: `1px solid ${sealRed}` }}>
                    <p className="text-[11px] font-semibold" style={{ color: sealRed }}>ยืนยันคืนสำนวนคดีนี้? (ไม่ใช่คดีของสภ.นี้ — จะส่งกลับไปให้ศาลจับคู่สถานีใหม่)</p>
                    <div className="flex gap-1.5 shrink-0">
                      <button onClick={() => submitReturn(c.id)} className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md" style={{ backgroundColor: sealRed, color: "#fff" }}>
                        ยืนยัน
                      </button>
                      <button onClick={() => setReturningId(null)} className="text-[11px]" style={{ color: "#8A836B" }}>ยกเลิก</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {unclaimedCases.filter((c) => c.station === officerStation).length === 0 && (
              <p className="text-xs py-3 text-center" style={{ color: "#8A836B" }}>ยังไม่มีคดีรอรับในสถานีนี้ — ติดต่อเจ้าหน้าที่ศาลให้จับคู่คดีกับสถานีท่านก่อน</p>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-bold" style={{ fontFamily: serif }}>ทะเบียนคดีของ {officerName} ({officerStation}) — {officerCases.length} คดี</h2>
          {officerCases.length > 0 && (
            <button
              onClick={() => downloadICS(officerCases, `คำร้องฝากขัง - ${officerName}`)}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md"
              style={{ backgroundColor: slate, color: "#fff" }}
            >
              <CalendarPlus size={13} /> ดาวน์โหลดปฏิทิน (.ics)
            </button>
          )}
        </div>
        {officerCases.length > 0 && (
          <p className="text-[11px] -mt-2" style={{ color: "#8A836B" }}>
            เปิดไฟล์นี้เพื่อนำเข้า Google Calendar / Apple Calendar / Outlook — ในระบบจริงจะเป็นลิงก์สมัครรับที่อัพเดตอัตโนมัติแทนการดาวน์โหลดครั้งเดียวแบบนี้
          </p>
        )}
        {officerCases.length > 3 && (
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" color="#8A836B" />
            <input
              value={officerSearch}
              onChange={(e) => setOfficerSearch(e.target.value)}
              placeholder="ค้นหาเลขคดี"
              className="w-full rounded-md pl-8 pr-3 py-2 text-sm"
              style={{ border: `1px solid ${line}` }}
            />
          </div>
        )}
        {officerCases.length === 0 && (
          <p className="text-sm py-8 text-center" style={{ color: "#8A836B" }}>ยังไม่มีคดีในสถานีนี้ — เพิ่มคดีใหม่ทางด้านซ้าย</p>
        )}
        {officerCases.filter((c) => c.caseNumber.toLowerCase().includes(officerSearch.trim().toLowerCase())).map((c) => {
          const urgent = c.status === "due" || c.status === "overdue" || c.status === "blocked" || c.status === "file_expired" || c.courtFlag;
          return (
          <div key={c.id} className="rounded-lg p-4 space-y-3" style={{ backgroundColor: paperCard, border: `1px solid ${urgent ? (c.courtFlag ? sealRed : c.status === "due" ? brass : sealRed) : line}` }}>
            {urgent && <Stamp_ status={c.status} size="lg" />}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
            <div className="flex-1 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg sm:text-xl font-bold" style={{ fontFamily: serif }}>เลขคดี {c.caseNumber}</span>
                {caseTypeLabel(c.caseNumber) && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: caseTypeLabel(c.caseNumber) === "ยาเสพติด" ? sealRedBg : slateBg, color: caseTypeLabel(c.caseNumber) === "ยาเสพติด" ? sealRed : slate }}>
                    {caseTypeLabel(c.caseNumber)}
                  </span>
                )}
                {!urgent && <Stamp_ status={c.status} />}
              </div>
              <p className="text-base sm:text-lg font-semibold" style={{ color: "#5B5540" }}>
                ยื่นคำร้องฝากขังครั้งที่ {c.k}
              </p>
              <p style={{ color: (c.status === "overdue" || c.status === "blocked") ? sealRed : ink }}>
                <strong className="text-lg sm:text-xl" style={{ fontFamily: serif }}>ต้องยื่นภายใน {formatThai(c.filingDeadline)}</strong>
                <span className="text-base sm:text-lg font-semibold"> เวลา 16.00 น.</span>
              </p>
              <p style={{ color: (c.status === "overdue" || c.status === "blocked") ? sealRed : ink }}>
                <strong className="text-lg sm:text-xl" style={{ fontFamily: serif }}>
                  {daysUntil(c.filingDeadline) >= 0 ? `เหลืออีก ${daysUntil(c.filingDeadline)} วัน` : `เลยกำหนดมาแล้ว ${-daysUntil(c.filingDeadline)} วัน`}
                </strong>
              </p>
              <p className="text-sm sm:text-base" style={{ color: "#8A836B" }}>
                (ครบ {c.daysAvailable || 12} วัน วันที่ {formatThai(c.legalDeadline)})
              </p>
            </div>
            <div>
              {c.courtFlag ? (
                <div className="text-right max-w-[240px]">
                  <p className="text-[11px] font-semibold flex items-center justify-end gap-1 mb-1" style={{ color: sealRed }}>
                    <AlertTriangle size={12} /> เจ้าหน้าที่ศาลแจ้งว่าไฟล์ผิด
                  </p>
                  <p className="text-[11px] mb-1.5" style={{ color: sealRed }}>{c.courtFlag.reason}</p>
                  <p className="text-[10px] mb-1.5" style={{ color: "#8A836B" }}>แจ้งเมื่อ {formatThai(c.courtFlag.flaggedAt)} · ไฟล์เดิมยังอยู่จนกว่าจะอัพโหลดใหม่</p>
                  <label className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-md cursor-pointer justify-center" style={{ backgroundColor: sealRed, color: "#fff" }}>
                    <FileUp size={13} /> อัพโหลดไฟล์ที่ถูกต้อง
                    <input type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files[0] && uploadFile(c.id, e.target.files[0].name)} />
                  </label>
                </div>
              ) : c.status === "file_expired" ? (
                <div className="text-right max-w-[220px]">
                  <p className="text-[11px] font-semibold flex items-center justify-end gap-1 mb-1.5" style={{ color: sealRed }}>
                    <AlertTriangle size={12} /> ไฟล์เดิมถูกลบแล้ว (เกิน 12 วัน)
                  </p>
                  <label className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-md cursor-pointer justify-center" style={{ backgroundColor: brass, color: "#fff" }}>
                    <FileUp size={13} /> อัพโหลดใหม่
                    <input type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files[0] && uploadFile(c.id, e.target.files[0].name)} />
                  </label>
                </div>
              ) : c.fileName ? (
                <span className="text-xs flex items-center gap-1" style={{ color: slate }}><FileUp size={13} /> {c.fileName}</span>
              ) : c.status === "blocked" ? (
                <div className="text-[11px] text-right max-w-[220px]" style={{ color: sealRed }}>
                  <p className="font-semibold flex items-center justify-end gap-1"><AlertTriangle size={12} /> เลยเวลายื่นทางระบบแล้ว</p>
                  <p style={{ color: "#8A836B" }}>ต้องนำคำร้องไปยื่นต่อศาลด้วยตนเอง และอยู่รอจนกว่าศาลจะมีคำสั่ง (ข้อ 6)</p>
                </div>
              ) : (
                <label className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-md cursor-pointer" style={{ backgroundColor: brass, color: "#fff" }}>
                  <FileUp size={13} /> อัพโหลด PDF
                  <input type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files[0] && uploadFile(c.id, e.target.files[0].name)} />
                </label>
              )}
            </div>
            </div>
            {(!c.history || c.history.length === 0) && (
              returningId === c.id ? (
                <div className="p-2.5 rounded-md flex items-center justify-between gap-2 flex-wrap" style={{ backgroundColor: sealRedBg, border: `1px solid ${sealRed}` }}>
                  <p className="text-[11px] font-semibold" style={{ color: sealRed }}>ยืนยันคืนสำนวนคดีนี้? (คดีจะหลุดจากทะเบียนของท่านทันที ส่งกลับไปให้ศาลจับคู่สถานีใหม่)</p>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => submitReturn(c.id)} className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md" style={{ backgroundColor: sealRed, color: "#fff" }}>
                      ยืนยัน
                    </button>
                    <button onClick={() => setReturningId(null)} className="text-[11px]" style={{ color: "#8A836B" }}>ยกเลิก</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setReturningId(c.id)} className="text-[11px] underline flex items-center gap-1" style={{ color: sealRed }}>
                  <AlertTriangle size={11} /> คดีนี้ไม่ใช่ของสภ.นี้ — คืนสำนวน
                </button>
              )
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- reusable case card (used in list view + calendar detail) ---------- */
function QueueCard({ c, receive, updateCap, downloadFile, flagWrongFile, reassignOfficer, assignCaseStation, accounts }) {
  const [reassigning, setReassigning] = useState(false);
  const [newOfficer, setNewOfficer] = useState(c.officer || "");
  const [showHistory, setShowHistory] = useState(false);
  const [editingCap, setEditingCap] = useState(false);
  const [enteringShortDays, setEnteringShortDays] = useState(false);
  const [shortDays, setShortDays] = useState(c.daysAvailable || 12);
  const [flagging, setFlagging] = useState(false);
  const [flagReason, setFlagReason] = useState("");
  return (
    <div className="rounded-lg p-4" style={{ backgroundColor: paperCard, border: `1px solid ${line}` }}>
      {c.courtFlag && (
        <div className="flex items-start gap-2 rounded-md px-3 py-2 mb-3" style={{ backgroundColor: sealRedBg, border: `1px solid ${sealRed}` }}>
          <AlertTriangle size={14} color={sealRed} className="shrink-0 mt-0.5" />
          <p className="text-xs" style={{ color: sealRed }}>
            <strong>แจ้งไฟล์ผิดแล้ว</strong> ({formatThai(c.courtFlag.flaggedAt)}) — {c.courtFlag.reason} · รอพนักงานสอบสวนอัพโหลดไฟล์ใหม่ (ไฟล์เดิมยังเก็บไว้ให้เทียบได้)
          </p>
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {c.station || !assignCaseStation ? (
              <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ backgroundColor: c.station ? slateBg : brassBg, color: c.station ? slate : brass }}>{c.station || "ยังไม่ระบุสถานี"}</span>
            ) : (
              <select
                defaultValue=""
                onChange={(e) => e.target.value && assignCaseStation(c.id, e.target.value)}
                className="text-xs font-semibold rounded px-2 py-1"
                style={{ backgroundColor: brassBg, color: brass, border: `1px solid ${brass}` }}
              >
                <option value="">— จับคู่สถานี —</option>
                {STATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            <span className="font-bold" style={{ fontFamily: serif }}>เลขคดี {c.caseNumber}</span>
            {caseTypeLabel(c.caseNumber) && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: caseTypeLabel(c.caseNumber) === "ยาเสพติด" ? sealRedBg : slateBg, color: caseTypeLabel(c.caseNumber) === "ยาเสพติด" ? sealRed : slate }}>
                {caseTypeLabel(c.caseNumber)}
              </span>
            )}
            <Stamp_ status={c.status} />
            {!editingCap && (
              <span className="text-[11px] flex items-center gap-1" style={{ color: "#8A836B" }}>
                เพดาน {c.cap} วัน ({c.cap === 48 ? 4 : 7} ครั้ง)
                <button onClick={() => setEditingCap(true)} className="underline" style={{ color: slate }}>แก้ไข</button>
              </span>
            )}
            {c.history && c.history.length > 0 && (
              <button onClick={() => setShowHistory((s) => !s)} className="flex items-center gap-1 text-[11px] underline" style={{ color: slate }}>
                <History size={11} /> ประวัติ ({c.history.length})
              </button>
            )}
          </div>
          {editingCap && (
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="text-[11px] font-semibold" style={{ color: brass }}>ตั้งเพดาน:</span>
              {c.k <= 4 && (
                <button onClick={() => { updateCap(c.id, 48); setEditingCap(false); }} className="text-[11px] font-semibold px-2.5 py-1 rounded-md" style={c.cap === 48 ? { backgroundColor: ink, color: paper } : { backgroundColor: "#fff", border: `1px solid ${line}` }}>4 ครั้ง (48 วัน)</button>
              )}
              <button onClick={() => { updateCap(c.id, 84); setEditingCap(false); }} className="text-[11px] font-semibold px-2.5 py-1 rounded-md" style={c.cap === 84 ? { backgroundColor: ink, color: paper } : { backgroundColor: "#fff", border: `1px solid ${line}` }}>7 ครั้ง (84 วัน)</button>
              <button onClick={() => setEditingCap(false)} className="text-[11px]" style={{ color: "#8A836B" }}>ปิด</button>
              {c.k > 4 && (
                <p className="text-[10px] w-full" style={{ color: "#8A836B" }}>คดีนี้อยู่ที่ครั้งที่ {c.k} แล้ว (เกินครั้งที่ 4) จึงเลือกเพดาน 48 วันไม่ได้อีก</p>
              )}
            </div>
          )}
          <p className="text-xs mt-1 flex items-center gap-1 flex-wrap" style={{ color: "#5B5540" }}>
            ครั้งที่ {c.k} · <strong>ต้องยื่นภายใน {formatThai(c.filingDeadline)} 16.00 น.</strong> (ครบกำหนดจริง {formatThai(c.legalDeadline)})
          </p>
          <p className="text-xs mt-0.5 flex items-center gap-1.5" style={{ color: "#8A836B" }}>
            <User size={11} /> ผู้รับผิดชอบ: {c.officer || "—"}
            {reassignOfficer && !reassigning && (
              <button onClick={() => setReassigning(true)} className="underline text-[11px]" style={{ color: slate }}>โอนย้าย</button>
            )}
          </p>
          {reassigning && (
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {(() => {
                const stationAccounts = accounts.filter((a) => a.station === c.station);
                if (stationAccounts.length === 0) {
                  return <p className="text-[11px]" style={{ color: brass }}>สถานีนี้ยังไม่มีบัญชีเลย — ไปสร้างบัญชีที่หน้า "บัญชีผู้ใช้" ก่อน</p>;
                }
                return (
                  <>
                    <select
                      value={newOfficer}
                      onChange={(e) => setNewOfficer(e.target.value)}
                      className="text-xs rounded px-2 py-1"
                      style={{ border: `1px solid ${line}` }}
                    >
                      <option value="">— เลือกพนักงาน —</option>
                      {stationAccounts.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
                    </select>
                    <button
                      onClick={() => { if (newOfficer) { reassignOfficer(c.id, newOfficer); setReassigning(false); } }}
                      disabled={!newOfficer}
                      className="text-[11px] font-semibold px-2 py-1 rounded disabled:opacity-40"
                      style={{ backgroundColor: ink, color: paper }}
                    >
                      บันทึก
                    </button>
                  </>
                );
              })()}
              <button onClick={() => setReassigning(false)} className="text-[11px]" style={{ color: "#8A836B" }}>ยกเลิก</button>
            </div>
          )}
        </div>
        <div>
          {!c.fileName && <span className="text-xs" style={{ color: "#8A836B" }}>รอพนักงานสอบสวนยื่นคำร้อง</span>}
          {c.status === "file_expired" && (
            <span className="text-xs font-semibold flex items-center gap-1" style={{ color: sealRed }}><AlertTriangle size={13} /> ไฟล์หมดอายุแล้ว รอพนักงานอัพโหลดใหม่</span>
          )}
          {c.fileName && !c.downloaded && c.status !== "file_expired" && (
            <button onClick={() => downloadFile(c.id)} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-md" style={{ backgroundColor: slate, color: "#fff" }}>
              <Download size={13} /> ดาวน์โหลดไฟล์
            </button>
          )}
          {c.fileName && c.downloaded && !c.courtFlag && !enteringShortDays && (
            <div className="text-right">
              <button onClick={() => receive(c.id)} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-md" style={{ backgroundColor: sealGreen, color: "#fff" }}>
                <CheckCircle2 size={13} /> ยืนยันรับเรื่อง ({c.daysAvailable || 12} วัน)
              </button>
              <button onClick={() => setEnteringShortDays(true)} className="block mt-1 text-[11px] underline" style={{ color: slate }}>
                ศาลให้ไม่ครบ 12 วัน?
              </button>
            </div>
          )}
          {c.fileName && c.downloaded && enteringShortDays && (
            <div className="text-right space-y-1">
              <div className="flex items-center gap-1.5 justify-end">
                <input
                  type="number" min="1" max="12" value={shortDays}
                  onChange={(e) => setShortDays(e.target.value)}
                  className="w-16 text-xs rounded px-2 py-1.5"
                  style={{ border: `1px solid ${line}` }}
                />
                <span className="text-[11px]" style={{ color: "#8A836B" }}>วัน</span>
              </div>
              <div className="flex gap-1.5 justify-end">
                <button onClick={() => { receive(c.id, shortDays); setEnteringShortDays(false); }} className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md" style={{ backgroundColor: sealGreen, color: "#fff" }}>
                  ยืนยัน
                </button>
                <button onClick={() => setEnteringShortDays(false)} className="text-[11px]" style={{ color: "#8A836B" }}>ยกเลิก</button>
              </div>
            </div>
          )}
          {c.fileName && c.courtFlag && (
            <span className="text-xs font-semibold flex items-center gap-1" style={{ color: sealRed }}><AlertTriangle size={13} /> รอพนักงานอัพโหลดไฟล์ใหม่</span>
          )}
        </div>
      </div>
      {c.fileName && !c.downloaded && c.status !== "file_expired" && (
        <p className="text-[11px] mt-2 flex items-center gap-1" style={{ color: "#8A836B" }}>
          ต้องดาวน์โหลดไฟล์ก่อน ปุ่ม "รับเรื่อง" จะยังไม่ทำงานจนกว่าจะดาวน์โหลด
        </p>
      )}
      {c.fileName && !c.courtFlag && !flagging && (
        <button onClick={() => setFlagging(true)} className="text-[11px] underline mt-2 flex items-center gap-1" style={{ color: sealRed }}>
          <AlertTriangle size={11} /> แจ้งไฟล์ผิด/ให้อัพโหลดใหม่
        </button>
      )}
      {flagging && (
        <div className="mt-2 p-2.5 rounded-md" style={{ backgroundColor: sealRedBg, border: `1px solid ${sealRed}` }}>
          <p className="text-[11px] font-semibold mb-1.5" style={{ color: sealRed }}>ระบุเหตุผลที่แจ้งว่าไฟล์ผิด (พนักงานสอบสวนเจ้าของคดีนี้จะเห็นข้อความนี้)</p>
          <textarea
            value={flagReason}
            onChange={(e) => setFlagReason(e.target.value)}
            rows={2}
            className="w-full text-xs rounded px-2 py-1.5 mb-1.5"
            style={{ border: `1px solid ${sealRed}` }}
            placeholder="เช่น ไฟล์นี้เป็นคำร้องของคดีเลข ยฝ.5/2569 ไม่ใช่คดีนี้"
          />
          <div className="flex gap-1.5">
            <button
              onClick={() => { if (flagReason.trim()) { flagWrongFile(c.id, flagReason); setFlagging(false); setFlagReason(""); } }}
              disabled={!flagReason.trim()}
              className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md disabled:opacity-40"
              style={{ backgroundColor: sealRed, color: "#fff" }}
            >
              ยืนยันแจ้ง
            </button>
            <button onClick={() => { setFlagging(false); setFlagReason(""); }} className="text-[11px]" style={{ color: "#8A836B" }}>ยกเลิก</button>
          </div>
        </div>
      )}
      {showHistory && c.history && c.history.length > 0 && (
        <div className="mt-3 pt-3" style={{ borderTop: `1px dashed ${line}` }}>
          <p className="text-[11px] font-semibold mb-2" style={{ color: "#5B5540" }}>ประวัติการยื่นคำร้องแต่ละครั้ง</p>
          <div className="space-y-1.5">
            {c.history.map((h, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px] rounded px-2 py-1.5" style={{ backgroundColor: "#fff", border: `1px solid ${line}` }}>
                <span className="font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: slateBg, color: slate }}>ครั้งที่ {h.k}</span>
                <span style={{ color: "#5B5540" }}>ยื่นภายใน {formatThai(h.filingDeadline)}</span>
                <span style={{ color: sealGreen }}>· ศาลรับเรื่อง {formatThai(h.receivedDate)}</span>
                {h.daysGranted && h.daysGranted < 12 && (
                  <span className="font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: brassBg, color: brass }}>ศาลให้ {h.daysGranted} วัน</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- overview dashboard ---------- */
function DashboardPanel({ courtQueue, closedCases }) {
  const [openDay, setOpenDay] = useState(null);
  const [openType, setOpenType] = useState(null); // "ยฝ." | "ฝ." | null — สำหรับขยายดูรายการยื่นสะสมของประเภทนั้น
  const allCases = [...courtQueue, ...closedCases];
  const todayISO = toISO(new Date());

  // ยื่นคำร้องสะสมทั้งหมด แยกตามประเภทคดี (ยฝ./ฝ.) — นับจากจำนวนครั้งที่เคยยื่นจริงสะสม
  // (history.length ของแต่ละคดี รวมทั้งคดีที่ยังดำเนินการอยู่และปิดไปแล้ว) ไม่ใช่แค่จำนวนคดี
  const cumulativeFilingsByPrefix = (prefix) =>
    allCases
      .filter((c) => (c.caseNumber || "").startsWith(prefix))
      .reduce((sum, c) => sum + (c.history?.length || 0), 0);

  // รายการยื่นแต่ละครั้ง (แตกจาก history ของทุกคดีที่ตรงประเภท) ใช้ตอนกดขยายการ์ด — รวมคดีปิดแล้วด้วย
  // เพราะประวัติการยื่นของคดีที่ปิดไปแล้วก็ยังนับอยู่ในยอดสะสมของการ์ดนี้เช่นกัน
  const filingsByPrefix = (prefix) =>
    allCases
      .filter((c) => (c.caseNumber || "").startsWith(prefix))
      .flatMap((c) => (c.history || []).map((h) => ({ ...h, caseNumber: c.caseNumber, station: c.station, closed: c.closed })))
      .sort((a, b) => (a.receivedDate < b.receivedDate ? 1 : -1));

  // คดียื่นใหม่วันนี้ = วันที่ลงข้อมูลคำร้องฝากขังครั้งแรกเข้าระบบ (createdAt ตรงกับวันนี้)
  // ไม่ใช่วันที่ยื่นครั้งถัดๆ ไปของคดีเดิม
  const newToday = allCases.filter((c) => c.createdAt === todayISO).length;

  const cards = [
    { id: "ยฝ.", label: "ยื่นคำร้องสะสม (ยฝ. คดียาเสพติด)", value: cumulativeFilingsByPrefix("ยฝ."), color: sealRed, icon: FileUp, clickable: true },
    { id: "ฝ.", label: "ยื่นคำร้องสะสม (ฝ. คดีทั่วไป)", value: cumulativeFilingsByPrefix("ฝ."), color: slate, icon: FileUp, clickable: true },
    { id: "new", label: "คดียื่นใหม่วันนี้ (ลงข้อมูลคำร้องฝากแรก)", value: newToday, color: brass, icon: Plus, clickable: false },
  ];

  const openList = openType ? filingsByPrefix(openType) : [];

  // สรุปรายวัน: แต่ละวันที่มีคดีต้องยื่นคำร้องต่อ — ยื่นแล้วกี่คดี (อัพโหลดแล้ว) ยังไม่ยื่นกี่คดี
  const dailyGroups = useMemo(() => {
    const map = new Map();
    courtQueue.forEach((c) => {
      const key = c.filingDeadline;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(c);
    });
    return Array.from(map.entries())
      .map(([date, items]) => ({
        date,
        total: items.length,
        filed: items.filter((c) => c.status === "uploaded" || c.status === "downloaded").length,
        pending: items.filter((c) => c.status !== "uploaded" && c.status !== "downloaded").length,
        items: items.sort((a, b) => (a.station < b.station ? -1 : 1)),
      }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [courtQueue]);

  // แถวสำหรับตารางรายงานสรุปที่พิมพ์ออกมา — เฉพาะคดีที่ยังดำเนินการอยู่ (ปิดแล้วไม่ต้องติดตามต่อ) เรียงตามวันที่ต้องยื่นใกล้สุดก่อน
  const printRows = [...courtQueue].sort((a, b) => (a.filingDeadline < b.filingDeadline ? -1 : 1));
  const generatedAt = new Date();
  const generatedLabel = `${formatThai(toISO(generatedAt))} เวลา ${String(generatedAt.getHours()).padStart(2, "0")}:${String(generatedAt.getMinutes()).padStart(2, "0")} น.`;

  return (
    <div className="space-y-6">
      {/* กด print แล้วเบราว์เซอร์จะซ่อนทุกอย่างในหน้าเว็บ เหลือแค่ .print-report — ทำให้พิมพ์ได้แค่รายงานสะอาดๆ
          ไม่ติดเมนู/ปุ่ม/แถบสีของหน้าจอปกติออกมาด้วย */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print-report, .print-report * { visibility: visible; }
          .print-report { display: block !important; position: absolute; left: 0; top: 0; width: 100%; padding: 24px; }
        }
        .print-report { display: none; }
      `}</style>

      <div className="flex items-center justify-end">
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md"
          style={{ backgroundColor: slate, color: "#fff" }}
        >
          <Printer size={13} /> พิมพ์รายงานสรุป
        </button>
      </div>

      <div className="print-report">
        <h1 className="text-lg font-bold" style={{ fontFamily: serif }}>รายงานสรุปคำร้องขอฝากขัง — ศาลจังหวัดอุดรธานี</h1>
        <p className="text-xs mb-4" style={{ color: "#8A836B" }}>ออกรายงานเมื่อ {generatedLabel} · ระบบติดตามคำร้องขอฝากขังทางจอภาพ</p>

        <table className="w-full text-xs mb-4" style={{ borderCollapse: "collapse" }}>
          <tbody>
            <tr><td style={{ padding: "2px 8px 2px 0", fontWeight: 700 }}>ยื่นคำร้องสะสม (ยฝ. คดียาเสพติด)</td><td>{cumulativeFilingsByPrefix("ยฝ.")} รายการ</td></tr>
            <tr><td style={{ padding: "2px 8px 2px 0", fontWeight: 700 }}>ยื่นคำร้องสะสม (ฝ. คดีทั่วไป)</td><td>{cumulativeFilingsByPrefix("ฝ.")} รายการ</td></tr>
            <tr><td style={{ padding: "2px 8px 2px 0", fontWeight: 700 }}>คดียื่นใหม่วันนี้</td><td>{newToday} คดี</td></tr>
            <tr><td style={{ padding: "2px 8px 2px 0", fontWeight: 700 }}>คดีที่กำลังดำเนินการทั้งหมด</td><td>{courtQueue.length} คดี</td></tr>
            <tr><td style={{ padding: "2px 8px 2px 0", fontWeight: 700 }}>คดีที่ปิดแล้วสะสม</td><td>{closedCases.length} คดี</td></tr>
          </tbody>
        </table>

        <h2 className="text-sm font-bold mb-1" style={{ fontFamily: serif }}>รายการคดีที่กำลังดำเนินการ ({printRows.length} คดี)</h2>
        <table className="w-full text-[11px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1.5px solid #000" }}>
              <th style={{ textAlign: "left", padding: "4px 6px" }}>สถานี</th>
              <th style={{ textAlign: "left", padding: "4px 6px" }}>เลขคดี</th>
              <th style={{ textAlign: "center", padding: "4px 6px" }}>ครั้งที่</th>
              <th style={{ textAlign: "left", padding: "4px 6px" }}>วันครบกำหนดฝากขัง</th>
              <th style={{ textAlign: "left", padding: "4px 6px" }}>วันที่ต้องยื่น</th>
              <th style={{ textAlign: "left", padding: "4px 6px" }}>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {printRows.map((c) => (
              <tr key={c.id} style={{ borderBottom: "0.5px solid #999" }}>
                <td style={{ padding: "4px 6px" }}>{c.station}</td>
                <td style={{ padding: "4px 6px" }}>{c.caseNumber}</td>
                <td style={{ padding: "4px 6px", textAlign: "center" }}>{c.k}</td>
                <td style={{ padding: "4px 6px" }}>{formatThai(c.legalDeadline)}</td>
                <td style={{ padding: "4px 6px" }}>{formatThai(c.filingDeadline)}</td>
                <td style={{ padding: "4px 6px" }}>{STATUS_META[c.status]?.label || c.status}</td>
              </tr>
            ))}
            {printRows.length === 0 && (
              <tr><td colSpan={6} style={{ padding: "10px 6px", textAlign: "center" }}>ไม่มีคดีที่กำลังดำเนินการ</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {cards.map((card) => (
          <button
            key={card.label}
            onClick={() => card.clickable && setOpenType(openType === card.id ? null : card.id)}
            disabled={!card.clickable}
            className="rounded-lg p-3 text-left transition"
            style={{
              backgroundColor: openType === card.id ? slateBg : paperCard,
              border: `1px solid ${openType === card.id ? slate : line}`,
              cursor: card.clickable ? "pointer" : "default",
            }}
          >
            <div className="flex items-center justify-between">
              <card.icon size={16} color={card.color} />
              {card.clickable && (openType === card.id ? <ChevronDown size={14} color={slate} /> : <ChevronRight size={14} color="#8A836B" />)}
            </div>
            <p className="text-2xl font-extrabold mt-1" style={{ fontFamily: serif, color: card.color }}>{card.value}</p>
            <p className="text-[11px]" style={{ color: "#8A836B" }}>{card.label}</p>
          </button>
        ))}
      </div>

      {openType && (
        <div className="rounded-lg p-4" style={{ backgroundColor: paperCard, border: `1px solid ${line}` }}>
          <h3 className="text-sm font-bold mb-1" style={{ fontFamily: serif }}>
            รายการยื่นคำร้องสะสม — {openType === "ยฝ." ? "ยฝ. คดียาเสพติด" : "ฝ. คดีทั่วไป"} ({openList.length} รายการ)
          </h3>
          <p className="text-[11px] mb-3" style={{ color: "#8A836B" }}>เรียงล่าสุดขึ้นก่อน · รวมทั้งคดีที่ยังดำเนินการอยู่และปิดไปแล้ว</p>
          <div className="max-h-80 overflow-y-auto">
            <PaginatedCaseList
              key={openType}
              items={openList}
              itemsClassName="space-y-1"
              renderItem={(h, i) => (
                <div key={`${h.caseNumber}-${h.k}-${i}`} className="flex items-center justify-between text-[11px] rounded px-2 py-1.5" style={{ backgroundColor: "#fff", border: `1px solid ${line}` }}>
                  <span>{h.station} · เลขคดี {h.caseNumber} · ครั้งที่ {h.k} · ยื่นเมื่อ {h.receivedDate ? formatThai(h.receivedDate) : "-"}</span>
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ml-2"
                    style={h.closed ? { backgroundColor: sealGreenBg, color: sealGreen } : { backgroundColor: slateBg, color: slate }}
                  >
                    {h.closed ? "คดีปิดแล้ว" : "กำลังดำเนินการ"}
                  </span>
                </div>
              )}
            />
          </div>
          {openList.length === 0 && <p className="text-sm py-4 text-center" style={{ color: "#8A836B" }}>ยังไม่มีรายการยื่นคำร้องของประเภทนี้</p>}
        </div>
      )}

      <div className="rounded-lg p-4" style={{ backgroundColor: paperCard, border: `1px solid ${line}` }}>
        <h3 className="text-sm font-bold mb-1" style={{ fontFamily: serif }}>สรุปรายวัน</h3>
        <p className="text-[11px] mb-3" style={{ color: "#8A836B" }}>แยกตามวันที่ต้องยื่นคำร้อง — คลิกวันที่ดูรายชื่อคดี</p>
        <div className="space-y-1.5">
          {dailyGroups.map((g) => {
            const isOpen = openDay === g.date;
            const late = daysUntil(g.date) < 0;
            return (
              <div key={g.date} className="rounded-md overflow-hidden" style={{ border: `1px solid ${late ? sealRed : line}` }}>
                <button onClick={() => setOpenDay(isOpen ? null : g.date)} className="w-full flex items-center justify-between px-3 py-2" style={{ backgroundColor: isOpen ? slateBg : "#fff" }}>
                  <span className="text-xs font-semibold flex items-center gap-1.5">
                    {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    {formatThai(g.date)}
                  </span>
                  <span className="text-[11px] flex items-center gap-2">
                    <span style={{ color: "#8A836B" }}>ทั้งหมด {g.total}</span>
                    <span style={{ color: sealGreen, fontWeight: 700 }}>ยื่นแล้ว {g.filed}</span>
                    <span style={{ color: g.pending > 0 ? brass : "#8A836B", fontWeight: 700 }}>ยังไม่ยื่น {g.pending}</span>
                  </span>
                </button>
                {isOpen && (
                  <div className="p-2" style={{ backgroundColor: paper }}>
                    <PaginatedCaseList
                      key={g.date}
                      items={g.items}
                      itemsClassName="space-y-1"
                      renderItem={(c) => (
                        <div key={c.id} className="flex items-center justify-between text-[11px] rounded px-2 py-1.5" style={{ backgroundColor: "#fff", border: `1px solid ${line}` }}>
                          <span>{c.station} · เลขคดี {c.caseNumber} · ครั้งที่ {c.k}</span>
                          <Stamp_ status={c.status} />
                        </div>
                      )}
                    />
                  </div>
                )}
              </div>
            );
          })}
          {dailyGroups.length === 0 && <p className="text-sm py-4 text-center" style={{ color: "#8A836B" }}>ยังไม่มีคดีที่ต้องยื่นคำร้อง</p>}
        </div>
      </div>
    </div>
  );
}


/* ---------- list view grouped by category, then by date within each category ---------- */
function GroupedQueueList({ courtQueue, receive, updateCap, downloadFile, flagWrongFile, reassignOfficer, assignCaseStation, accounts }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const GROUPS = [
    { key: "filed", label: "ยื่นแล้ว", statuses: ["uploaded", "downloaded"], color: slate },
    { key: "due", label: "ใกล้ครบกำหนด", statuses: ["due"], color: brass },
    { key: "overdue", label: "เลยเวลา", statuses: ["overdue", "blocked", "file_expired"], color: sealRed },
    { key: "wait", label: "รอถึงกำหนด", statuses: ["wait"], color: ink },
  ];

  const q = search.trim().toLowerCase();
  const filtered = courtQueue.filter((c) => {
    const matchesSearch = !q || c.caseNumber.toLowerCase().includes(q) || c.station.toLowerCase().includes(q) || (c.officer || "").toLowerCase().includes(q);
    const matchesStatus = statusFilter === "all" || c.status === statusFilter || (statusFilter === "filed" && (c.status === "uploaded" || c.status === "downloaded")) || (statusFilter === "overdue" && (c.status === "overdue" || c.status === "blocked" || c.status === "file_expired"));
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      <div className="rounded-lg p-3 flex flex-col sm:flex-row gap-2" style={{ backgroundColor: paperCard, border: `1px solid ${line}` }}>
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" color="#8A836B" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาเลขคดี / สถานี / ชื่อพนักงาน"
            className="w-full rounded-md pl-8 pr-3 py-2 text-sm"
            style={{ border: `1px solid ${line}` }}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md px-3 py-2 text-sm"
          style={{ border: `1px solid ${line}`, backgroundColor: "#fff" }}
        >
          <option value="all">ทุกสถานะ</option>
          <option value="filed">ยื่นแล้ว</option>
          <option value="due">ใกล้ครบกำหนด</option>
          <option value="overdue">เลยเวลา</option>
          <option value="wait">รอถึงกำหนด</option>
        </select>
      </div>

      {filtered.length === 0 && (
        <p className="text-sm py-8 text-center" style={{ color: "#8A836B" }}>ไม่พบคำร้องที่ตรงกับเงื่อนไขค้นหา</p>
      )}

      {GROUPS.map((g) => {
        let items = filtered.filter((c) => g.statuses.includes(c.status));
        if (g.key === "overdue") {
          items = items.sort((a, b) => {
            const stationDiff = STATIONS.indexOf(a.station) - STATIONS.indexOf(b.station);
            if (stationDiff !== 0) return stationDiff;
            return a.filingDeadline < b.filingDeadline ? 1 : -1; // most recent (latest) date first within each station
          });
        } else {
          items = items.sort((a, b) => (a.filingDeadline < b.filingDeadline ? -1 : 1));
        }
        if (items.length === 0) return null;
        return (
          <div key={g.key} className="space-y-2">
            <h3 className="text-xs font-bold flex items-center gap-1.5" style={{ color: g.color, fontFamily: serif }}>
              {g.label} ({items.length})
            </h3>
            <PaginatedCaseList
              key={`${g.key}-${q}-${statusFilter}`}
              items={items}
              itemsClassName="space-y-3"
              renderItem={(c) => (
                <QueueCard key={c.id} c={c} receive={receive} updateCap={updateCap} downloadFile={downloadFile} flagWrongFile={flagWrongFile} reassignOfficer={reassignOfficer} assignCaseStation={assignCaseStation} accounts={accounts} />
              )}
            />
          </div>
        );
      })}
    </div>
  );
}

function CourtView({ courtQueue, closedCases, receive, updateCap, downloadFile, flagWrongFile, reassignOfficer, assignCaseStation, accounts, createAccount, deleteAccount, resetPassword, courtAccounts, createCourtAccount, deleteCourtAccount, resetCourtPassword, currentCourtName, holidays, holidayForm, setHolidayForm, addHoliday, removeHoliday }) {
  const [viewMode, setViewMode] = useState("calendar");
  const [selectedDate, setSelectedDate] = useState(null);

  return (
    <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-bold" style={{ fontFamily: serif }}>คำร้องจากทุกสถานี ({courtQueue.length})</h2>
          <div className="flex gap-1 p-1 rounded-full flex-wrap" style={{ backgroundColor: "#E1DDCC" }}>
            {[
              { id: "calendar", label: "ปฏิทิน", icon: CalendarDays },
              { id: "list", label: "รายการ", icon: List },
              { id: "dashboard", label: "สรุปภาพรวม", icon: BarChart3 },
              { id: "accounts", label: `บัญชีผู้ใช้ (${accounts.length + courtAccounts.length})`, icon: UserPlus },
            ].map((v) => (
              <button
                key={v.id}
                onClick={() => { setViewMode(v.id); if (v.id !== "calendar") setSelectedDate(null); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition whitespace-nowrap"
                style={viewMode === v.id ? { backgroundColor: ink, color: paper } : { color: "#5B5540" }}
              >
                <v.icon size={13} /> {v.label}
              </button>
            ))}
          </div>
        </div>

        {viewMode === "list" && <GroupedQueueList courtQueue={courtQueue} receive={receive} updateCap={updateCap} downloadFile={downloadFile} flagWrongFile={flagWrongFile} reassignOfficer={reassignOfficer} assignCaseStation={assignCaseStation} accounts={accounts} />}

        {viewMode === "dashboard" && <DashboardPanel courtQueue={courtQueue} closedCases={closedCases} />}

        {viewMode === "accounts" && (
          <AccountsPanel
            accounts={accounts} courtQueue={courtQueue} createAccount={createAccount} deleteAccount={deleteAccount} resetPassword={resetPassword}
            courtAccounts={courtAccounts} createCourtAccount={createCourtAccount} deleteCourtAccount={deleteCourtAccount} resetCourtPassword={resetCourtPassword} currentCourtName={currentCourtName}
            holidays={holidays} holidayForm={holidayForm} setHolidayForm={setHolidayForm} addHoliday={addHoliday} removeHoliday={removeHoliday}
          />
        )}

        {viewMode === "calendar" && (
          <>
            <CourtCalendar cases={courtQueue} holidays={holidays} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
            {selectedDate && (
              <StationSummaryTable date={selectedDate} cases={courtQueue} receive={receive} updateCap={updateCap} downloadFile={downloadFile} flagWrongFile={flagWrongFile} reassignOfficer={reassignOfficer} assignCaseStation={assignCaseStation} accounts={accounts} />
            )}
            {!selectedDate && (
              <p className="text-sm py-6 text-center" style={{ color: "#8A836B" }}>คลิกวันที่ในปฏิทินเพื่อดูจำนวนคำร้องแยกตามสถานี</p>
            )}
          </>
        )}
    </div>
  );
}

/* ---------- court calendar ---------- */
const WEEKDAYS_TH = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

function CourtCalendar({ cases, holidays, selectedDate, onSelectDate }) {
  const todayISO = toISO(new Date());
  const [cursor, setCursor] = useState(() => { const t = new Date(); return { year: t.getFullYear(), month: t.getMonth() }; });

  const casesByDate = useMemo(() => {
    const map = {};
    cases.forEach((c) => {
      (map[c.filingDeadline] ||= []).push(c);
    });
    return map;
  }, [cases]);

  const holidayMap = useMemo(() => {
    const map = {};
    holidays.forEach((h) => { map[h.date] = h.label; });
    return map;
  }, [holidays]);

  const { year, month } = cursor;
  const pad = (n) => String(n).padStart(2, "0");
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  function shiftMonth(delta) {
    let m = month + delta, y = year;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setCursor({ year: y, month: m });
  }

  return (
    <div className="rounded-lg p-4" style={{ backgroundColor: paperCard, border: `1px solid ${line}` }}>
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => shiftMonth(-1)} className="p-1.5 rounded-md" style={{ border: `1px solid ${line}` }}><ChevronLeft size={15} /></button>
        <span className="text-sm font-bold" style={{ fontFamily: serif }}>{THAI_MONTHS_FULL[month]} {year + 543}</span>
        <button onClick={() => shiftMonth(1)} className="p-1.5 rounded-md" style={{ border: `1px solid ${line}` }}><ChevronRight size={15} /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold mb-1" style={{ color: "#8A836B" }}>
        {WEEKDAYS_TH.map((w) => <div key={w}>{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />;
          const iso = `${year}-${pad(month + 1)}-${pad(d)}`;
          const dayCases = casesByDate[iso] || [];
          const pendingCases = dayCases.filter((c) => c.status !== "downloaded");
          const count = pendingCases.length;
          const worst = pendingCases.some((c) => c.status === "overdue" || c.status === "blocked" || c.status === "file_expired") ? "overdue" : pendingCases.some((c) => c.status === "due") ? "due" : count ? "wait" : null;
          const colors = { overdue: { bg: sealRedBg, fg: sealRed }, due: { bg: brassBg, fg: brass }, wait: { bg: slateBg, fg: slate } };
          const isToday = iso === todayISO;
          const holidayName = holidayMap[iso];
          const isHol = Boolean(holidayName) || new Date(year, month, d).getDay() % 6 === 0;
          const isSelected = iso === selectedDate;
          return (
            <button
              key={i}
              onClick={() => count && onSelectDate(iso)}
              className="rounded-md p-1.5 text-left flex flex-col justify-between h-20 sm:h-24 transition"
              style={{
                backgroundColor: isSelected ? "#fff" : count ? colors[worst].bg : isHol ? "#E1DDCC" : "transparent",
                border: isSelected ? `2px solid ${ink}` : isToday ? `2px solid ${brass}` : `1px solid ${line}`,
                cursor: count ? "pointer" : "default",
              }}
            >
              <span className="text-[11px]" style={{ color: isHol ? "#8A836B" : ink, fontWeight: isToday ? 700 : 400 }}>{d}</span>
              {count > 0 && (
                <span className="text-sm font-bold leading-tight self-center" style={{ color: colors[worst].fg }}>
                  {count}
                </span>
              )}
              {holidayName && (
                <span
                  className="text-[8px] sm:text-[9px] leading-tight"
                  style={{ color: "#6B4A17", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}
                  title={holidayName}
                >
                  {holidayName}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-3 mt-3 text-[10px] flex-wrap" style={{ color: "#8A836B" }}>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: sealRedBg }} /> เลยกำหนด</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: brassBg }} /> ใกล้ครบกำหนด</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: slateBg }} /> รอถึงกำหนด</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: "#E1DDCC" }} /> วันหยุด/เสาร์-อาทิตย์</span>
      </div>
    </div>
  );
}

const THAI_MONTHS_FULL = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];

/* ---------- closed-case retention / purge countdown ---------- */
function ClosedCasesPanel({ cases }) {
  if (cases.length === 0) {
    return <p className="text-sm py-6 text-center" style={{ color: "#8A836B" }}>ยังไม่มีคดีที่ปิดแล้ว</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-[11px]" style={{ color: "#8A836B" }}>
        ไฟล์ PDF แต่ละไฟล์ถูกลบไปแล้วตั้งแต่ 12 วันหลังอัพโหลด (ไม่เกี่ยวกับคดีปิดหรือยัง) — รายละเอียด/ประวัติคดีนี้จะถูกลบอัตโนมัติ {PURGE_DAYS} วัน หลังคดีปิด (เหลือไว้เฉพาะทะเบียนหลักฐานสรุป)
      </p>
      {cases.map((c) => {
        const urgent = c.daysToPurge <= 7;
        const soon = c.daysToPurge <= 30;
        const barColor = c.daysToPurge < 0 ? "#8A836B" : urgent ? sealRed : soon ? brass : sealGreen;
        const pct = Math.max(0, Math.min(100, (1 - c.daysToPurge / PURGE_DAYS) * 100));
        return (
          <div key={c.id} className="rounded-lg p-4" style={{ backgroundColor: paperCard, border: `1px solid ${line}` }}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ backgroundColor: c.station ? slateBg : brassBg, color: c.station ? slate : brass }}>{c.station || "ยังไม่ระบุสถานี"}</span>
                <span className="font-bold" style={{ fontFamily: serif }}>เลขคดี {c.caseNumber}</span>
                <span className="text-[11px]" style={{ color: "#8A836B" }}>ปิดคดีเมื่อ {formatThai(c.closedDate)}</span>
              </div>
              <span className="flex items-center gap-1 text-xs font-bold" style={{ color: barColor }}>
                <Timer size={13} />
                {c.daysToPurge >= 0 ? `เหลืออีก ${c.daysToPurge} วันจะลบไฟล์` : "เลยกำหนดลบแล้ว"}
              </span>
            </div>
            <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "#E1DDCC" }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: barColor }} />
            </div>
            <p className="text-[11px] mt-1" style={{ color: "#8A836B" }}>กำหนดลบไฟล์: {formatThai(c.purgeDate)}</p>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- per-station summary table for a selected date (expandable) ---------- */
function StationSummaryTable({ date, cases, receive, updateCap, downloadFile, flagWrongFile, reassignOfficer, assignCaseStation, accounts }) {
  const [expanded, setExpanded] = useState(() => new Set());

  const groups = useMemo(() => {
    const byStation = {};
    cases.filter((c) => c.filingDeadline === date).forEach((c) => {
      (byStation[c.station] ||= []).push(c);
    });
    return STATIONS
      .map((s) => ({ station: s, items: byStation[s] || [] }))
      .filter((g) => g.items.length > 0 || true)
      .sort((a, b) => b.items.length - a.items.length || a.station.localeCompare(b.station, "th"));
  }, [date, cases]);

  const total = groups.reduce((s, g) => s + g.items.length, 0);

  function readyToDownloadFor(station) {
    return cases.filter((c) => c.filingDeadline === date && c.station === station && c.fileName && !c.downloaded);
  }

  function handleDownloadStation(station) {
    const ready = readyToDownloadFor(station);
    ready.forEach((c, i) => setTimeout(() => downloadFile(c.id), i * 300));
  }

  function toggle(station) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(station) ? next.delete(station) : next.add(station);
      return next;
    });
  }

  return (
    <div className="rounded-lg p-4" style={{ backgroundColor: paperCard, border: `1px solid ${line}` }}>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h3 className="text-xs font-bold" style={{ fontFamily: serif }}>สรุปยอดยื่นคำร้องแยกตามสถานี · {formatThai(date)}</h3>
        <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ backgroundColor: ink, color: paper }}>รวม {total} คดี</span>
      </div>
      <p className="text-[11px] mb-3" style={{ color: "#8A836B" }}>ดาวน์โหลดแยกเป็นชุดตามสถานี — กดปุ่มดาวน์โหลดในแถวของแต่ละสภ. เพื่อโหลดเฉพาะไฟล์ของสถานีนั้น</p>
      <div className="space-y-1.5">
        {groups.map((g) => {
          const isOpen = expanded.has(g.station) && g.items.length > 0;
          const ready = readyToDownloadFor(g.station);
          return (
            <div key={g.station} className="rounded-md overflow-hidden" style={{ border: `1px solid ${g.items.length ? line : "transparent"}`, opacity: g.items.length ? 1 : 0.45 }}>
              <div
                className="w-full flex items-center justify-between px-3 py-2 text-xs gap-2"
                style={{ backgroundColor: isOpen ? slateBg : "#fff" }}
              >
                <button
                  onClick={() => g.items.length && toggle(g.station)}
                  className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
                  style={{ cursor: g.items.length ? "pointer" : "default" }}
                >
                  {g.items.length > 0 && (isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
                  <span className="truncate">{g.station}</span>
                  <span className="font-bold shrink-0" style={{ color: g.items.length ? sealGreen : "#8A836B" }}>{g.items.length} คำร้อง</span>
                </button>
                <button
                  onClick={() => handleDownloadStation(g.station)}
                  disabled={ready.length === 0}
                  className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded shrink-0 disabled:opacity-30"
                  style={{ backgroundColor: ready.length > 0 ? sealGreen : "#8A836B", color: "#fff" }}
                  title={ready.length > 0 ? `ดาวน์โหลดไฟล์ของ ${g.station} ทั้งหมด (${ready.length} ไฟล์)` : "ยังไม่มีไฟล์พร้อมดาวน์โหลดของสถานีนี้"}
                >
                  <Download size={12} /> {ready.length > 0 ? ready.length : "-"}
                </button>
              </div>
              {isOpen && (
                <div className="p-2" style={{ backgroundColor: paper }}>
                  <PaginatedCaseList
                    key={`${g.station}-${date}`}
                    items={g.items}
                    itemsClassName="space-y-2"
                    renderItem={(c) => (
                      <QueueCard key={c.id} c={c} receive={receive} updateCap={updateCap} downloadFile={downloadFile} flagWrongFile={flagWrongFile} reassignOfficer={reassignOfficer} assignCaseStation={assignCaseStation} accounts={accounts} />
                    )}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- pending officer-registration approval queue (court officer only) ---------- */
function AccountsPanel({ accounts, courtQueue, createAccount, deleteAccount, resetPassword, courtAccounts, createCourtAccount, deleteCourtAccount, resetCourtPassword, currentCourtName, holidays, holidayForm, setHolidayForm, addHoliday, removeHoliday }) {
  const [holidaysOpen, setHolidaysOpen] = useState(false); // พับเก็บไว้เป็นค่าเริ่มต้น — ใช้นานๆ ครั้ง ไม่ต้องกางค้างไว้ทุกหน้าจอเหมือนก่อน
  const [form, setForm] = useState({ name: "", station: STATIONS[0], password: "" });
  const [justCreated, setJustCreated] = useState(false);
  const [resettingId, setResettingId] = useState(null);
  const [resetValue, setResetValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const [courtForm, setCourtForm] = useState({ name: "", password: "" });
  const [courtJustCreated, setCourtJustCreated] = useState(false);
  const [courtResettingId, setCourtResettingId] = useState(null);
  const [courtResetValue, setCourtResetValue] = useState("");
  const [courtConfirmDeleteId, setCourtConfirmDeleteId] = useState(null);

  function activeCaseCountFor(account) {
    return courtQueue.filter((c) => c.officer === account.name && c.station === account.station).length;
  }

  function handleCreate() {
    createAccount(form.name, form.station, form.password);
    setForm((p) => ({ ...p, name: "", password: "" }));
    setJustCreated(true);
    setTimeout(() => setJustCreated(false), 2500);
  }

  function handleCreateCourt() {
    createCourtAccount(courtForm.name, courtForm.password);
    setCourtForm({ name: "", password: "" });
    setCourtJustCreated(true);
    setTimeout(() => setCourtJustCreated(false), 2500);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg p-4 space-y-3" style={{ backgroundColor: paperCard, border: `1px solid ${line}` }}>
        <h3 className="text-sm font-bold flex items-center gap-1.5" style={{ fontFamily: serif }}><UserPlus size={15} /> สร้างบัญชีให้พนักงานสอบสวน</h3>
        <p className="text-[11px]" style={{ color: "#8A836B" }}>ตรวจสอบตัวตนก่อนสร้าง (เช่น จากหนังสือราชการที่สถานีส่งมา) ตั้งรหัสผ่านให้เลย แล้วแจ้งพนักงานด้วยวาจา/โทรศัพท์ — ใช้งานได้ทันที ไม่ต้องมีขั้นตอนเปิดใช้งานเพิ่ม</p>
        <div>
          <label className="text-xs" style={{ color: "#5B5540" }}>ชื่อ-ยศ พนักงานสอบสวน</label>
          <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="เช่น ร.ต.ท.สมหญิง ใจงาม" className="w-full rounded-md px-3 py-2 text-sm mt-1" style={{ border: `1px solid ${line}` }} />
        </div>
        <div>
          <label className="text-xs" style={{ color: "#5B5540" }}>สถานี</label>
          <select value={form.station} onChange={(e) => setForm((p) => ({ ...p, station: e.target.value }))} className="w-full rounded-md px-3 py-2 text-sm mt-1" style={{ border: `1px solid ${line}`, backgroundColor: "#fff" }}>
            {STATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs" style={{ color: "#5B5540" }}>ตั้งรหัสผ่าน</label>
          <input type="text" value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} placeholder="เช่น udon1234" className="w-full rounded-md px-3 py-2 text-sm mt-1" style={{ border: `1px solid ${line}` }} />
        </div>
        <button
          onClick={handleCreate}
          disabled={!form.name.trim() || !form.password}
          className="w-full rounded-md py-2 text-sm font-semibold disabled:opacity-40"
          style={{ backgroundColor: ink, color: paper }}
        >
          สร้างบัญชี
        </button>
        {justCreated && <p className="text-[11px] text-center" style={{ color: sealGreen }}>สร้างบัญชีแล้ว — แจ้งชื่อบัญชี/รหัสผ่านให้พนักงานเข้าสู่ระบบได้ทันที</p>}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-bold flex items-center gap-1.5" style={{ fontFamily: serif }}><User size={15} /> บัญชีทั้งหมด ({accounts.length})</h3>
        <p className="text-[11px]" style={{ color: "#8A836B" }}>
          หากพนักงานย้ายหน่วย/ลาออก และสถานีลืมแจ้งให้ลบบัญชี เจ้าหน้าที่ศาลลบออกได้จากที่นี่ — คดีที่เคยผูกกับชื่อนี้จะไม่หายไป และยังโอนย้ายให้ผู้รับผิดชอบคนใหม่ได้ตามปกติ
        </p>
        {accounts.map((a) => {
          const activeCount = activeCaseCountFor(a);
          return (
          <div key={a.id} className="rounded-lg p-3 flex items-center justify-between flex-wrap gap-2" style={{ backgroundColor: paperCard, border: `1px solid ${line}` }}>
            <div className="text-xs">
              <p className="font-semibold">{a.name}</p>
              <p style={{ color: "#8A836B" }}>{a.station}</p>
              {activeCount > 0 && (
                <p className="text-[11px] mt-0.5" style={{ color: brass }}>เป็นเจ้าของคดีที่กำลังดำเนินการอยู่ {activeCount} คดี</p>
              )}
            </div>
            {resettingId === a.id ? (
              <div className="flex items-center gap-1.5">
                <input value={resetValue} onChange={(e) => setResetValue(e.target.value)} placeholder="รหัสผ่านใหม่" className="text-xs rounded px-2 py-1" style={{ border: `1px solid ${line}` }} />
                <button
                  onClick={() => { resetPassword(a.id, resetValue); setResettingId(null); setResetValue(""); }}
                  className="text-[11px] font-semibold px-2 py-1 rounded"
                  style={{ backgroundColor: ink, color: paper }}
                >
                  บันทึก
                </button>
                <button onClick={() => setResettingId(null)} className="text-[11px]" style={{ color: "#8A836B" }}>ยกเลิก</button>
              </div>
            ) : confirmDeleteId === a.id ? (
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-[11px] font-semibold" style={{ color: sealRed }}>
                  {activeCount > 0
                    ? `ยืนยันลบ? คดีทั้ง ${activeCount} คดีจะคืนเป็น "ยังไม่มีเจ้าของ" ในกล่องจดหมายของ ${a.station} ทันที`
                    : "ยืนยันลบบัญชีนี้?"}
                </p>
                <button onClick={() => { deleteAccount(a.id); setConfirmDeleteId(null); }} className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md" style={{ backgroundColor: sealRed, color: "#fff" }}>
                  ยืนยันลบ
                </button>
                <button onClick={() => setConfirmDeleteId(null)} className="text-[11px]" style={{ color: "#8A836B" }}>ยกเลิก</button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => { setResettingId(a.id); setResetValue(""); }} className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-md" style={{ backgroundColor: "#fff", color: slate, border: `1px solid ${slate}` }}>
                  <Lock size={12} /> ตั้งรหัสผ่านใหม่
                </button>
                <button onClick={() => setConfirmDeleteId(a.id)} className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-md" style={{ backgroundColor: "#fff", color: sealRed, border: `1px solid ${sealRed}` }}>
                  <Trash2 size={12} /> ลบบัญชี
                </button>
              </div>
            )}
          </div>
          );
        })}
      </div>

      <div className="rounded-lg p-4 space-y-3" style={{ backgroundColor: paperCard, border: `1px solid ${line}` }}>
        <h3 className="text-sm font-bold flex items-center gap-1.5" style={{ fontFamily: serif }}><Scale size={15} /> สร้างบัญชีเจ้าหน้าที่ศาลเพิ่ม</h3>
        <p className="text-[11px]" style={{ color: "#8A836B" }}>ใช้กรณีมีเจ้าหน้าที่ศาลมากกว่า 1 คนผลัดกันดูแลระบบ — บัญชีกลุ่มนี้แยกต่างหากจากบัญชีพนักงานสอบสวนโดยสิ้นเชิง ทุกบัญชีมีสิทธิ์เท่ากันหมด ไม่มีระดับสูง-ต่ำ</p>
        <div>
          <label className="text-xs" style={{ color: "#5B5540" }}>ชื่อ-ตำแหน่ง เจ้าหน้าที่ศาล</label>
          <input value={courtForm.name} onChange={(e) => setCourtForm((p) => ({ ...p, name: e.target.value }))} placeholder="เช่น จนท.ศาลจังหวัดอุดรธานี (กะบ่าย)" className="w-full rounded-md px-3 py-2 text-sm mt-1" style={{ border: `1px solid ${line}` }} />
        </div>
        <div>
          <label className="text-xs" style={{ color: "#5B5540" }}>ตั้งรหัสผ่าน</label>
          <input type="text" value={courtForm.password} onChange={(e) => setCourtForm((p) => ({ ...p, password: e.target.value }))} placeholder="เช่น udoncourt1234" className="w-full rounded-md px-3 py-2 text-sm mt-1" style={{ border: `1px solid ${line}` }} />
        </div>
        <button
          onClick={handleCreateCourt}
          disabled={!courtForm.name.trim() || !courtForm.password}
          className="w-full rounded-md py-2 text-sm font-semibold disabled:opacity-40"
          style={{ backgroundColor: ink, color: paper }}
        >
          สร้างบัญชีเจ้าหน้าที่ศาล
        </button>
        {courtJustCreated && <p className="text-[11px] text-center" style={{ color: sealGreen }}>สร้างบัญชีแล้ว — แจ้งชื่อบัญชี/รหัสผ่านให้เจ้าหน้าที่ศาลคนนั้นเข้าสู่ระบบได้ทันที</p>}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-bold flex items-center gap-1.5" style={{ fontFamily: serif }}><Scale size={15} /> บัญชีเจ้าหน้าที่ศาลทั้งหมด ({courtAccounts.length})</h3>
        {courtAccounts.length === 1 && (
          <p className="text-[11px] flex items-center gap-1.5" style={{ color: brass }}>
            <AlertTriangle size={12} /> มีบัญชีเดียว — ถ้าลืมรหัสผ่านจะไม่มีใครช่วยรีเซ็ตให้ได้ (ระบบยังไม่มีกู้คืนรหัสผ่านผ่านอีเมล) แนะนำให้สร้างบัญชีสำรองเพิ่มอย่างน้อย 1 บัญชี
          </p>
        )}
        {courtAccounts.map((a) => (
          <div key={a.id} className="rounded-lg p-3 flex items-center justify-between flex-wrap gap-2" style={{ backgroundColor: paperCard, border: `1px solid ${line}` }}>
            <div className="text-xs">
              <p className="font-semibold flex items-center gap-1.5">
                {a.name}
                {a.name === currentCourtName && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: slateBg, color: slate }}>คุณ</span>}
              </p>
              {courtAccounts.length <= 1 && <p className="text-[11px] mt-0.5" style={{ color: brass }}>บัญชีเดียวที่เหลืออยู่ — ลบไม่ได้ (ต้องมีอย่างน้อย 1 บัญชีเสมอ)</p>}
            </div>
            {courtResettingId === a.id ? (
              <div className="flex items-center gap-1.5">
                <input value={courtResetValue} onChange={(e) => setCourtResetValue(e.target.value)} placeholder="รหัสผ่านใหม่" className="text-xs rounded px-2 py-1" style={{ border: `1px solid ${line}` }} />
                <button
                  onClick={() => { resetCourtPassword(a.id, courtResetValue); setCourtResettingId(null); setCourtResetValue(""); }}
                  className="text-[11px] font-semibold px-2 py-1 rounded"
                  style={{ backgroundColor: ink, color: paper }}
                >
                  บันทึก
                </button>
                <button onClick={() => setCourtResettingId(null)} className="text-[11px]" style={{ color: "#8A836B" }}>ยกเลิก</button>
              </div>
            ) : courtConfirmDeleteId === a.id ? (
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-[11px] font-semibold" style={{ color: sealRed }}>ยืนยันลบบัญชีนี้?</p>
                <button onClick={() => { deleteCourtAccount(a.id); setCourtConfirmDeleteId(null); }} className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md" style={{ backgroundColor: sealRed, color: "#fff" }}>
                  ยืนยันลบ
                </button>
                <button onClick={() => setCourtConfirmDeleteId(null)} className="text-[11px]" style={{ color: "#8A836B" }}>ยกเลิก</button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => { setCourtResettingId(a.id); setCourtResetValue(""); }} className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-md" style={{ backgroundColor: "#fff", color: slate, border: `1px solid ${slate}` }}>
                  <Lock size={12} /> ตั้งรหัสผ่านใหม่
                </button>
                <button
                  onClick={() => setCourtConfirmDeleteId(a.id)}
                  disabled={courtAccounts.length <= 1}
                  className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-md disabled:opacity-30"
                  style={{ backgroundColor: "#fff", color: sealRed, border: `1px solid ${sealRed}` }}
                >
                  <Trash2 size={12} /> ลบบัญชี
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ปฏิทินวันหยุดศาล — ย้ายมาซ่อนไว้ที่นี่ (พับเก็บเป็นค่าเริ่มต้น) เพราะเดิมโชว์ค้างอยู่ทุกหน้าจอตลอดเวลา
          ทั้งที่เป็นงานที่ทำนานๆ ครั้ง (เพิ่ม/แก้วันหยุดตามประกาศจริงที่เปลี่ยนแปลง) ไม่ใช่งานประจำวัน */}
      <div className="rounded-lg overflow-hidden" style={{ backgroundColor: paperCard, border: `1px solid ${line}` }}>
        <button onClick={() => setHolidaysOpen((o) => !o)} className="w-full flex items-center justify-between px-4 py-3">
          <span className="text-sm font-bold flex items-center gap-1.5" style={{ fontFamily: serif }}>
            <CalendarPlus size={15} /> ปฏิทินวันหยุดศาล
          </span>
          <span className="text-xs flex items-center gap-2" style={{ color: "#8A836B" }}>
            {holidays.length} รายการ
            {holidaysOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </span>
        </button>
        {holidaysOpen && (
          <div className="px-4 pb-4 space-y-3" style={{ borderTop: `1px dashed ${line}` }}>
            <p className="text-[11px] pt-3" style={{ color: "#8A836B" }}>ข้อมูลจากฐานข้อมูลวันหยุดราชการ พ.ศ. 2569 ที่ได้รับมา — แก้ไข/เพิ่มเติมได้ตามประกาศจริงที่เปลี่ยนแปลง</p>
            <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
              {holidays.map((h) => (
                <div key={h.date} className="flex items-center justify-between text-xs rounded px-2 py-1.5" style={{ backgroundColor: "#fff", border: `1px solid ${line}` }}>
                  <span>{formatThai(h.date)} — {h.label}</span>
                  <button onClick={() => removeHoliday(h.date)}><Trash2 size={13} color={sealRed} /></button>
                </div>
              ))}
            </div>
            <div className="pt-2 space-y-2" style={{ borderTop: `1px dashed ${line}` }}>
              <ThaiDateInput value={holidayForm.date || genDate(0)} onChange={(iso) => setHolidayForm((p) => ({ ...p, date: iso }))} yearsBack={1} yearsForward={2} />
              <input placeholder="ชื่อวันหยุด" value={holidayForm.label} onChange={(e) => setHolidayForm((p) => ({ ...p, label: e.target.value }))} className="w-full rounded-md px-2 py-1.5 text-xs" style={{ border: `1px solid ${line}` }} />
              <button onClick={addHoliday} className="w-full flex items-center justify-center gap-1 text-xs font-semibold py-1.5 rounded-md" style={{ backgroundColor: ink, color: paper }}>
                <Plus size={13} /> เพิ่มวันหยุด
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
