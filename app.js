/* ==========================================================================
   e-REDT System - Pure JavaScript Application Engine (Web App Version)
 * ศาลจังหวัดอุดรธานี — ระบบผัดฟ้องฝากขังออนไลน์
   ========================================================================== */

// Configure PDF.js Worker if available
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// Configure DataTables global error mode
if (typeof jQuery !== 'undefined' && typeof jQuery.fn.DataTable !== 'undefined') {
  jQuery.fn.dataTable.ext.errMode = 'none';
}

const SPREADSHEET_ID = '1yoznW_FWEf5BLKOdqn110oTZj5zJg4KbsKsogoh-6g4';
const DEFAULT_GOOGLE_SHEET_CSV = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/pub?output=csv`;
const DEFAULT_GOOGLE_SCRIPT_WEBAPP = '';
const DEFAULT_DRIVE_FOLDER_ID = '1l5ZDlXI14lgFc6WGqmZ3kQ9qB-ci-ArM';

// --------------------------------------------------------------------------
// 1. LEGAL LOGIC ENGINE (ตรรกะกฎหมาย และระเบียบศาลจังหวัดอุดรธานี พ.ศ. 2569)
// --------------------------------------------------------------------------

const DAYS_PER_OCCASION = 12; // ป.วิ.อาญา ม.87: ฝากขังได้ครั้งละไม่เกิน 12 วัน
const FILING_CUTOFF_HOUR = 16; // ข้อ 6: ยื่นทางระบบได้ไม่เกิน 16.00 น.
const PURGE_DAYS = 60;
const FILE_PURGE_DAYS = 12; // ไฟล์ PDF ถูกลบอัตโนมัติ 12 วันหลังอัพโหลด (SPEC ข้อ 6)
const CAP_MAX_K = { 12: 1, 48: 4, 84: 7 };
const MAX_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
const ALLOWED_UPLOAD_EXTENSION = ".pdf";

// รายชื่อ 23 สถานีตำรวจในจังหวัดอุดรธานี
const UDON_STATIONS = [
  "สภ.เมืองอุดรธานี",
  "สภ.กุมภวาปี",
  "สภ.บ้านดุง",
  "สภ.เพ็ญ",
  "สภ.หนองหาน",
  "สภ.กุดจับ",
  "สภ.น้ำโสม",
  "สภ.ศรีธาตุ",
  "สภ.วังสามหมอ",
  "สภ.โนนสะอาด",
  "สภ.ไชยวาน",
  "สภ.หนองวัวซอ",
  "สภ.สร้างคอม",
  "สภ.ทุ่งฝน",
  "สภ.พิบูลย์รักษ์",
  "สภ.นายูง",
  "สภ.ประจักษ์ศิลปาคม",
  "สภ.กุมภวาปี (สาขา)",
  "สภ.ห้วยเกิ้ง",
  "สภ.ดงเย็น",
  "สภ.นาข่า",
  "สภ.เมืองเพีย",
  "สภ.ย่อยสามพร้าว"
];

// เดือนภาษาไทย
const THAI_MONTHS_SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."
];

const THAI_MONTHS_FULL = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
];

// ใช้องค์ประกอบวันที่แบบ local time เสมอ ไม่ใช้ .toISOString()
// พร้อมระบบป้องกันข้อผิดพลาด ป้องกันการเกิด "NaN-NaN-NaN"
function toISO(date) {
  if (!date) return toISO(new Date());
  let d = date instanceof Date ? date : null;
  if (!d) {
    if (typeof date === 'string') {
      const str = date.trim();
      if (str.includes('-')) {
        const parts = str.split('-');
        if (parts.length === 3) {
          let y = parseInt(parts[0], 10);
          let m = parseInt(parts[1], 10) - 1;
          let day = parseInt(parts[2], 10);
          if (y > 2400) y -= 543;
          if (!isNaN(y) && !isNaN(m) && !isNaN(day)) {
            d = new Date(y, m, day);
          }
        }
      } else if (str.includes('/')) {
        const parts = str.split('/');
        if (parts.length === 3) {
          let p1 = parseInt(parts[0], 10);
          let p2 = parseInt(parts[1], 10);
          let p3 = parseInt(parts[2], 10);
          if (p1 > 2400) p1 -= 543;
          if (p3 > 2400) p3 -= 543;
          if (p1 > 31) {
            d = new Date(p1, p2 - 1, p3);
          } else {
            d = new Date(p3, p2 - 1, p1);
          }
        }
      }
    }
    if (!d || isNaN(d.getTime())) {
      d = new Date(date);
    }
  }
  if (isNaN(d.getTime())) d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fromISO(iso) {
  if (!iso || typeof iso !== 'string' || iso.includes('NaN')) {
    iso = toISO(new Date());
  }
  const parts = iso.split('-');
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      return new Date(y, m, d);
    }
  }
  return new Date();
}

function formatThaiDate(iso, isLong = false) {
  if (!iso || typeof iso !== "string" || iso.includes("NaN")) return "-";
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);

  if (isNaN(y) || isNaN(m) || isNaN(d) || m < 0 || m > 11) return "-";

  const thaiYear = y < 2400 ? y + 543 : y;
  const monthName = isLong ? THAI_MONTHS_FULL[m] : THAI_MONTHS_SHORT[m];
  return `${d} ${monthName} ${thaiYear}`;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function isHoliday(iso, holidays) {
  return (holidays || []).some((h) => h.date === iso);
}

function adjustToBusinessDay(iso, holidays) {
  let d = fromISO(iso);
  while (isWeekend(d) || isHoliday(toISO(d), holidays)) {
    d = addDays(d, -1);
  }
  return toISO(d);
}

function previousBusinessDay(iso, holidays) {
  let d = addDays(fromISO(iso), -1);
  while (isWeekend(d) || isHoliday(toISO(d), holidays)) {
    d = addDays(d, -1);
  }
  return toISO(d);
}

function computeOccasionDeadlines(startISO, cumulativeDays, holidays) {
  const daysAvailable = DAYS_PER_OCCASION;
  const raw = toISO(addDays(fromISO(startISO), cumulativeDays));
  const legalDeadline = adjustToBusinessDay(raw, holidays);
  const filingDeadline = previousBusinessDay(legalDeadline, holidays);
  return { rawDeadline: raw, legalDeadline, filingDeadline, daysAvailable };
}

function isPastCutoff(filingDeadlineISO, now = new Date()) {
  const cutoff = fromISO(filingDeadlineISO);
  cutoff.setHours(FILING_CUTOFF_HOUR, 0, 0, 0);
  return now > cutoff;
}

function checkSubmissionWindow(now = new Date()) {
  const holidays = (typeof getHolidays === 'function') ? getHolidays() : DEFAULT_HOLIDAYS;
  const nowISO = toISO(now);
  const isWknd = isWeekend(now);
  const isHoli = isHoliday(nowISO, holidays);
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} น.`;

  if (isWknd) {
    return { isOpen: false, reason: 'weekend', message: 'วันหยุดเสาร์-อาทิตย์ (ปิดรับยื่น)', timeStr };
  }
  if (isHoli) {
    const holiObj = (holidays || []).find(h => h.date === nowISO);
    return { isOpen: false, reason: 'holiday', message: `วันหยุดราชการ (${holiObj ? holiObj.name : 'วันหยุด'})`, timeStr };
  }
  if (hours >= FILING_CUTOFF_HOUR) {
    return { isOpen: false, reason: 'past_16', message: `เลยเวลา 16.00 น. แล้ว (${timeStr}) — ปิดรับยื่นทางอิเล็กทรอนิกส์`, timeStr };
  }
  return { isOpen: true, reason: 'open', message: `เปิดรับยื่นคำร้องอิเล็กทรอนิกส์ (ยื่นได้ถึง 16.00 น.)`, timeStr };
}

function capMaxK(cap) {
  return CAP_MAX_K[cap] || null;
}

function canFileNextOccasion(currentK, cap) {
  const maxK = capMaxK(cap);
  if (!maxK) return true;
  return currentK < maxK;
}

function validateUploadFile(file) {
  if (!file || !file.name) {
    return { valid: false, reason: "ไม่พบไฟล์ที่จะอัพโหลด" };
  }
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    return { valid: false, reason: "รองรับเฉพาะไฟล์เอกสาร PDF (.pdf) เท่านั้น" };
  }
  if (typeof file.sizeBytes !== "number" || !Number.isFinite(file.sizeBytes) || file.sizeBytes <= 0) {
    return { valid: false, reason: "ไม่สามารถอ่านขนาดไฟล์ได้ กรุณาลองใหม่" };
  }
  if (file.sizeBytes > MAX_UPLOAD_SIZE_BYTES) {
    return { valid: false, reason: "ไฟล์จะต้องมีขนาดไม่เกิน 20 MB เท่านั้น" };
  }
  return { valid: true, reason: null };
}

// --------------------------------------------------------------------------
// 2. CASE ENGINE (ชั้นตรรกะระดับคดี)
// --------------------------------------------------------------------------

function daysUntil(iso, now = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const target = fromISO(iso);
  return Math.round((target - today) / 86400000);
}

function enrichCase(rawCase, holidays, now = new Date()) {
  if (!rawCase.startDate || typeof rawCase.startDate !== 'string' || rawCase.startDate.includes('NaN')) {
    rawCase.startDate = toISO(new Date());
  }
  const cumulativeDays = rawCase.cumulativeDays ?? (12 * ((rawCase.k || 2) - 1));
  const { rawDeadline, legalDeadline, filingDeadline, daysAvailable } = computeOccasionDeadlines(rawCase.startDate, cumulativeDays, holidays);
  // ไฟล์ PDF ที่อัพโหลดแล้วถูกลบอัตโนมัติ FILE_PURGE_DAYS วันหลังอัพโหลด (SPEC ข้อ 6)
  const filePurgeDate = rawCase.uploadedAt ? toISO(addDays(fromISO(rawCase.uploadedAt), FILE_PURGE_DAYS)) : null;
  const fileExpired = Boolean(rawCase.fileName && !rawCase.downloaded && filePurgeDate && daysUntil(filePurgeDate, now) < 0);
  const status = deriveStatus({ ...rawCase, filingDeadline, fileExpired }, now);
  return { ...rawCase, cumulativeDays, daysAvailable, rawDeadline, legalDeadline, filingDeadline, filePurgeDate, fileExpired, status };
}

function deriveStatus(enrichedCase, now = new Date()) {
  if (enrichedCase.closed) return "closed";
  if (enrichedCase.fileExpired) return "file_expired";
  if (enrichedCase.fileName && enrichedCase.downloaded) return "downloaded";
  if (enrichedCase.fileName) return "uploaded";
  if (isPastCutoff(enrichedCase.filingDeadline, now)) return "blocked";
  const d = daysUntil(enrichedCase.filingDeadline, now);
  if (d < 0) return "overdue";
  if (d <= 3) return "due";
  return "wait";
}

function canUploadFile(rawCase, holidays, now = new Date()) {
  if (rawCase.closed) return false;
  const cumulativeDays = rawCase.cumulativeDays ?? (12 * ((rawCase.k || 2) - 1));
  const { filingDeadline } = computeOccasionDeadlines(rawCase.startDate, cumulativeDays, holidays);
  return !isPastCutoff(filingDeadline, now);
}

function uploadFile(rawCase, file, holidays, now = new Date()) {
  const fileCheck = validateUploadFile(file);
  if (!fileCheck.valid) {
    return { case: rawCase, ok: false, reason: fileCheck.reason };
  }
  if (rawCase.closed) {
    return { case: rawCase, ok: false, reason: "คดีนี้ปิดแล้ว ไม่สามารถอัพโหลดไฟล์เพิ่มได้" };
  }
  if (!canUploadFile(rawCase, holidays, now)) {
    return { case: rawCase, ok: false, reason: "เลยเวลา 16.00 น. ของวันที่ต้องยื่นแล้ว กรุณานำคำร้องไปยื่นต่อศาลด้วยตนเอง" };
  }
  return { case: { ...rawCase, fileName: file.name, fileUrl: file.fileUrl || '', downloaded: false, courtFlag: null, uploadedAt: toISO(now) }, ok: true, reason: null };
}

function flagWrongFile(rawCase, reason, now = new Date()) {
  if (rawCase.closed) {
    return { case: rawCase, ok: false, reason: "คดีนี้ปิดสำนวนเสร็จสิ้นแล้ว ไม่สามารถส่งคืนคำร้องได้" };
  }
  if (!rawCase.fileName) {
    return { case: rawCase, ok: false, reason: "คดีนี้ยังไม่มีไฟล์ที่อัพโหลดไว้ให้ส่งคืน" };
  }
  if (!reason || !reason.trim()) {
    return { case: rawCase, ok: false, reason: "กรุณาระบุเหตุผลการส่งคืนคำร้อง" };
  }
  const courtFlag = { reason: reason.trim(), flaggedAt: toISO(now) };
  const courtReturn = { reason: reason.trim(), returnedAt: toISO(now), by: (typeof currentUser !== 'undefined' && currentUser) ? (currentUser.name || currentUser.username) : 'ศาล' };
  
  const history = rawCase.history ? [...rawCase.history] : [];
  history.push({
    type: 'court_returned',
    title: 'ศาลส่งคืนคำร้องให้แก้ไข',
    note: reason.trim(),
    timestamp: toISO(now),
    by: (typeof currentUser !== 'undefined' && currentUser) ? (currentUser.name || currentUser.username) : 'ศาล'
  });

  return { 
    case: { 
      ...rawCase, 
      courtFlag, 
      courtReturn, 
      downloaded: false, 
      downloadedAt: '', 
      history 
    }, 
    ok: true, 
    reason: null 
  };
}

function receiveOccasion(rawCase, holidays, newCap = null, actualDays = null, now = new Date()) {
  if (!rawCase.fileName || !rawCase.downloaded) {
    return rawCase;
  }
  if (rawCase.courtFlag) {
    return rawCase;
  }
  const cap = newCap !== null ? Number(newCap) : (rawCase.cap || 84);
  const cumulativeDays = rawCase.cumulativeDays ?? (12 * ((rawCase.k || 2) - 1));
  const { legalDeadline, filingDeadline, daysAvailable } = computeOccasionDeadlines(rawCase.startDate, cumulativeDays, holidays);
  const grantedDays = actualDays != null ? Math.max(1, Math.min(12, Number(actualDays))) : daysAvailable;
  const newCumulativeDays = cumulativeDays + grantedDays;

  const historyEntry = {
    k: rawCase.k,
    filingDeadline,
    legalDeadline,
    fileName: rawCase.fileName,
    receivedDate: toISO(now),
    daysGranted: grantedDays,
  };
  const history = [...(rawCase.history || []), historyEntry];

  const maxK = cap === 12 ? 1 : (cap === 48 ? 4 : (cap === 84 ? 7 : 7));
  if (rawCase.k >= maxK) {
    return { ...rawCase, cap, cumulativeDays: newCumulativeDays, closed: true, closedDate: toISO(now), fileName: null, downloaded: false, courtFlag: null, uploadedAt: null, history };
  }
  return { ...rawCase, cap, cumulativeDays: newCumulativeDays, k: rawCase.k + 1, fileName: null, downloaded: false, courtFlag: null, uploadedAt: null, history };
}

function updateCap(rawCase, newCap, holidays = null, now = new Date()) {
  const cap = Number(newCap);
  if (cap !== 12 && cap !== 48 && cap !== 84) {
    return { case: rawCase, ok: false, reason: "ค่าเพดานฝากขังต้องเป็น 12 วัน, 48 วัน หรือ 84 วันเท่านั้น" };
  }

  const hList = holidays || getHolidays();
  const maxK = cap === 12 ? 1 : (cap === 48 ? 4 : 7);

  // Recalculate cumulative days based on the updated cap and current remand k
  let cumulativeDays = rawCase.cumulativeDays ?? (12 * ((rawCase.k || 2) - 1));
  
  // If the new cap is reached or exceeded, mark case closed
  let isClosed = rawCase.closed || false;
  let closedDate = rawCase.closedDate || null;
  if (rawCase.k >= maxK) {
    isClosed = true;
    if (!closedDate) closedDate = toISO(now);
  } else {
    // If cap was increased (e.g. from 12 to 48 or 48 to 84) on a closed case, reopen if k < maxK
    if (rawCase.k < maxK && rawCase.closed) {
      isClosed = false;
      closedDate = null;
    }
  }

  // Recalculate occasion deadlines based on updated cap and cumulative days
  const { rawDeadline, legalDeadline, filingDeadline, daysAvailable } = computeOccasionDeadlines(rawCase.startDate, cumulativeDays, hList);

  const updatedCase = {
    ...rawCase,
    cap,
    cumulativeDays,
    closed: isClosed,
    closedDate: closedDate,
    legalDeadline,
    filingDeadline,
    rawDeadline,
    daysAvailable
  };

  return { case: updatedCase, ok: true, reason: null };
}

function returnToPool(rawCase, reason, now = new Date()) {
  if (rawCase.closed) {
    return { case: rawCase, ok: false, reason: "คดีนี้ปิดแล้ว ไม่สามารถคืนสำนวนได้" };
  }
  if (rawCase.history && rawCase.history.length > 0) {
    return { case: rawCase, ok: false, reason: "คดีนี้เคยถูกศาลรับเรื่องไปแล้วอย่างน้อยหนึ่งครั้ง ไม่สามารถคืนสำนวนผ่านระบบได้ กรุณาติดต่อเจ้าหน้าที่ศาลโดยตรง" };
  }
  const finalReason = (reason && reason.trim()) || "พนักงานสอบสวนแจ้งว่าไม่ใช่คดีของสถานีนี้";
  const returnedNote = { reason: finalReason, returnedFromStation: rawCase.station, returnedAt: toISO(now) };
  return {
    case: { ...rawCase, station: null, officer: null, fileName: null, downloaded: false, courtFlag: null, returnedNote },
    ok: true,
    reason: null,
  };
}

// --------------------------------------------------------------------------
// 3. ICALENDAR FEED ENGINE (RFC 5545)
// --------------------------------------------------------------------------

function escapeICSText(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function foldLine(line) {
  if (line.length <= 75) return line;
  const parts = [];
  let rest = line;
  while (rest.length > 75) {
    parts.push(rest.slice(0, 75));
    rest = " " + rest.slice(75);
  }
  parts.push(rest);
  return parts.join("\r\n");
}

function toICSDateTime(isoDate, hour, minute) {
  const safeIso = toISO(isoDate);
  const [y, m, d] = safeIso.split("-");
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return `${y}${m}${d}T${hh}${mm}00`;
}

function nowStampUTC(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
}

function buildEvent(caseItem, now) {
  const uid = `case-${caseItem.caseNumber}-k${caseItem.k}@udon-remand-tracker`.replace(/[^a-zA-Z0-9@.\-]/g, "");
  const dtStart = toICSDateTime(caseItem.filingDeadline, 9, 0);
  const dtEnd = toICSDateTime(caseItem.filingDeadline, 10, 0);
  const summary = escapeICSText(`ครบกำหนดยื่นคำร้องฝากขัง เลขคดี ${caseItem.caseNumber} ครั้งที่ ${caseItem.k}`);
  const description = escapeICSText(
    `สถานี: ${caseItem.station || 'ไม่ระบุ'}\nต้องยื่นภายในเวลา 16.00 น. ของวันนี้ (ข้อ 6 ระเบียบศาลจังหวัดอุดรธานี)\nครบกำหนดฝากขังจริง: ${formatThaiDate(caseItem.legalDeadline)}`
  );

  const lines = [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${nowStampUTC(now)}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${escapeICSText(caseItem.station || 'ศาลจังหวัดอุดรธานี')}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "TRIGGER:-P1D",
    `DESCRIPTION:${summary}`,
    "END:VALARM",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "TRIGGER:-PT2H",
    `DESCRIPTION:${summary}`,
    "END:VALARM",
    "END:VEVENT",
  ];
  return lines.map(foldLine).join("\r\n");
}

function generateICS(cases, calendarName, now = new Date()) {
  const header = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Udon Provincial Court//Remand Tracker//TH",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeICSText(calendarName)}`,
    "X-WR-TIMEZONE:Asia/Bangkok",
  ];
  const events = (cases || [])
    .filter((c) => !c.closed && c.filingDeadline)
    .map((c) => buildEvent(c, now));
  const footer = ["END:VCALENDAR"];

  return [...header, ...events, ...footer].join("\r\n") + "\r\n";
}

// --------------------------------------------------------------------------
// 4. DATA PERSISTENCE & LOCAL STORAGE ENGINE
// --------------------------------------------------------------------------

const DEFAULT_USERS = [
  { username: 'admin', password: 'caogikojt02', role: 'admin', station: '', name: 'ผู้ดูแลระบบสูงสุด (System Admin)', status: 'approved' },
  { username: 'officer01', password: '123456', role: 'officer', station: '', name: 'เจ้าหน้าที่ศาลจังหวัดอุดรธานี', status: 'approved' },
  { username: 'head-office01', password: '123456', role: 'officer', station: '', name: 'นายณัฐพงศ์ กุบแก้ว', status: 'approved' }
];

const DEFAULT_HOLIDAYS = [
  { date: "2026-01-01", name: "วันขึ้นปีใหม่" },
  { date: "2026-04-13", name: "วันสงกรานต์" },
  { date: "2026-04-14", name: "วันสงกรานต์" },
  { date: "2026-04-15", name: "วันสงกรานต์" },
  { date: "2026-05-04", name: "วันฉัตรมงคล" },
  { date: "2026-07-28", name: "วันเฉลิมพระชนมพรรษา" },
  { date: "2026-08-12", name: "วันแม่แห่งชาติ" },
  { date: "2026-10-13", name: "วันคล้ายวันสวรรคต ร.9" },
  { date: "2026-10-23", name: "วันปิยมหาราช" },
  { date: "2026-12-05", name: "วันพ่อแห่งชาติ" },
  { date: "2026-12-10", name: "วันรัฐธรรมนูญ" },
  { date: "2026-12-31", name: "วันสิ้นปี" }
];

function initDatabase() {
  try {
    const curUsers = localStorage.getItem('eredt_users');
    if (!curUsers || curUsers === '[]') {
      localStorage.setItem('eredt_users', JSON.stringify(DEFAULT_USERS));
      inMemoryUsers = null; // Invalidate cache so getUsers() reads fresh seeded data
    }
    if (!localStorage.getItem('eredt_requests')) {
      localStorage.setItem('eredt_requests', JSON.stringify([]));
    }
    if (!localStorage.getItem('eredt_holidays')) {
      localStorage.setItem('eredt_holidays', JSON.stringify(DEFAULT_HOLIDAYS));
    }
    const curCsv = localStorage.getItem('eredt_google_csv');
    if (!curCsv || curCsv.includes('1Y-OA9B8cPRwTcILCB9lmLny2GrfcEnNqR5i07lTGDM4')) {
      localStorage.setItem('eredt_google_csv', DEFAULT_GOOGLE_SHEET_CSV);
    }
    if (!localStorage.getItem('eredt_google_script')) {
      localStorage.setItem('eredt_google_script', DEFAULT_GOOGLE_SCRIPT_WEBAPP);
    }
  } catch (e) {
    console.warn('localStorage unavailable or blocked:', e);
    // If localStorage is blocked, use DEFAULT_USERS in-memory so login still works
    if (!inMemoryUsers || inMemoryUsers.length === 0) {
      inMemoryUsers = [...DEFAULT_USERS];
    }
  }
  try { initRealtimeChannel(); } catch (e) { console.warn('BroadcastChannel init error:', e); }
}

function clearMockData() {
  Swal.fire({
    title: 'ยืนยันการล้างข้อมูลทดสอบ?',
    text: 'การดำเนินการนี้จะลบรายการคดีคำร้องทดสอบทั้งหมดในระบบ และเตรียมพร้อมสำหรับการนำเข้าข้อมูลจริง',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc2626',
    cancelButtonColor: '#64748b',
    confirmButtonText: 'ล้างข้อมูลทดสอบทั้งหมด',
    cancelButtonText: 'ยกเลิก'
  }).then((result) => {
    if (result.isConfirmed) {
      localStorage.setItem('eredt_requests', JSON.stringify([]));
      Swal.fire({
        icon: 'success',
        title: 'ล้างข้อมูลสำเร็จ',
        text: 'ระบบได้รับการรีเซ็ตเป็น 0 คดี พร้อมสำหรับการรับข้อมูลคำร้องจริงเรียบร้อยแล้ว',
        timer: 2000,
        showConfirmButton: false
      });
      if (typeof currentActiveView !== 'undefined') {
        if (currentActiveView === 'dashboard') renderDashboard();
        else if (currentActiveView === 'requests') {
          if (currentUser.role === 'police') renderPoliceView();
          else renderCourtView();
        }
      }
    }
  });
}

// --------------------------------------------------------------------------
// IN-MEMORY STATE CACHING & TTL REFRESH ENGINE
// --------------------------------------------------------------------------
let inMemoryRequests = null;
let inMemoryUsers = null;
let inMemoryHolidays = null;

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes Cache TTL
const AUTO_SYNC_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes background polling

function invalidateInMemoryCache() {
  inMemoryRequests = null;
  inMemoryUsers = null;
  inMemoryHolidays = null;
}

function getUsers() {
  if (inMemoryUsers && Array.isArray(inMemoryUsers) && inMemoryUsers.length > 0) {
    return inMemoryUsers;
  }
  let users = [];
  try {
    users = JSON.parse(localStorage.getItem('eredt_users') || '[]');
  } catch (e) {
    console.warn('getUsers: localStorage read error:', e);
  }
  if (!Array.isArray(users) || users.length === 0) {
    users = [...DEFAULT_USERS];
  }
  users = users.filter(u => u && u.username && String(u.username).trim() !== '');
  inMemoryUsers = users;
  return inMemoryUsers;
}

function saveUsers(users) {
  const validUsers = (users || []).filter(u => u && u.username && String(u.username).trim() !== '');
  inMemoryUsers = validUsers;
  localStorage.setItem('eredt_users', JSON.stringify(validUsers));
  if (validUsers.length > 0) {
    syncToGoogleSheet('saveUsers', { users: validUsers });
  }
  broadcastRealtimeUpdate('USERS_UPDATED');
}

function deduplicateRequests(reqs) {
  if (!Array.isArray(reqs)) return [];
  const map = new Map();
  reqs.forEach(r => {
    if (!r || !r.caseNumber) return;
    const key = String(r.caseNumber).trim();
    if (!key) return;
    
    if (!map.has(key)) {
      map.set(key, { ...r, caseNumber: key });
    } else {
      // Merge properties: prioritize record with station, officer, fileName, occasions or updated history
      const existing = map.get(key);
      const merged = { ...existing };
      
      if (!merged.station && r.station) merged.station = r.station;
      if (!merged.officer && r.officer) merged.officer = r.officer;
      if (!merged.fileName && r.fileName) {
        merged.fileName = r.fileName;
        merged.fileUrl = r.fileUrl;
      }
      if (r.downloaded) merged.downloaded = true;
      if (r.closed) {
        merged.closed = true;
        merged.closedDate = r.closedDate || merged.closedDate;
      }
      if (Array.isArray(r.occasions) && r.occasions.length > (merged.occasions?.length || 0)) {
        merged.occasions = r.occasions;
      }
      if (Array.isArray(r.history) && r.history.length > (merged.history?.length || 0)) {
        merged.history = r.history;
      }
      map.set(key, merged);
    }
  });
  return Array.from(map.values());
}
window.deduplicateRequests = deduplicateRequests;

function getRequests() {
  if (inMemoryRequests && Array.isArray(inMemoryRequests)) {
    return inMemoryRequests;
  }
  const rawReqs = JSON.parse(localStorage.getItem('eredt_requests') || '[]');
  const reqs = deduplicateRequests(rawReqs);
  // Sanitize existing cases if any contain invalid date strings
  let modified = (rawReqs.length !== reqs.length);
  reqs.forEach(r => {
    if (!r.startDate || r.startDate.includes('NaN')) {
      r.startDate = toISO(new Date());
      modified = true;
    }
  });
  if (modified) {
    localStorage.setItem('eredt_requests', JSON.stringify(reqs));
  }
  inMemoryRequests = reqs;
  return inMemoryRequests;
}

function saveRequests(requests) {
  inMemoryRequests = deduplicateRequests(requests || []);
  localStorage.setItem('eredt_requests', JSON.stringify(inMemoryRequests));
  if (inMemoryRequests && inMemoryRequests.length > 0) {
    syncToGoogleSheet('saveRequests', { requests: inMemoryRequests });
  }
  broadcastRealtimeUpdate('REQUESTS_UPDATED');
}

function getHolidays() {
  if (inMemoryHolidays && Array.isArray(inMemoryHolidays)) {
    return inMemoryHolidays;
  }
  inMemoryHolidays = JSON.parse(localStorage.getItem('eredt_holidays') || JSON.stringify(DEFAULT_HOLIDAYS));
  return inMemoryHolidays;
}

function saveHolidays(holidays) {
  inMemoryHolidays = holidays || [];
  localStorage.setItem('eredt_holidays', JSON.stringify(inMemoryHolidays));
  if (inMemoryHolidays && inMemoryHolidays.length > 0) {
    syncToGoogleSheet('saveHolidays', { holidays: inMemoryHolidays });
  }
  broadcastRealtimeUpdate('HOLIDAYS_UPDATED');
}

let autoSyncTimerId = null;

function startAutoSyncTimer() {
  stopAutoSyncTimer();
  autoSyncTimerId = setInterval(() => {
    if (currentUser && document.visibilityState !== 'hidden' && !isSyncingData) {
      fetchLiveGoogleSheetData({ isSilent: true });
    }
  }, AUTO_SYNC_INTERVAL_MS);
}

function stopAutoSyncTimer() {
  if (autoSyncTimerId) {
    clearInterval(autoSyncTimerId);
    autoSyncTimerId = null;
  }
}

function checkAndAutoRefreshCache(force = false) {
  if (!currentUser || isSyncingData) return;
  const lastSync = Number(localStorage.getItem('eredt_last_sync') || 0);
  if (force || Date.now() - lastSync > CACHE_TTL_MS) {
    fetchLiveGoogleSheetData({ isSilent: true });
  }
}

// Auto-check Cache TTL when user switches back to this browser tab
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentUser) {
    checkAndAutoRefreshCache();
  }
});
window.addEventListener('focus', () => {
  if (currentUser) {
    checkAndAutoRefreshCache();
  }
});

function syncToGoogleSheet(actionName, payload) {
  const scriptUrl = localStorage.getItem('eredt_google_script');
  if (!scriptUrl) return;
  
  try {
    fetch(scriptUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: actionName, ...payload })
    }).catch(err => {
      console.warn('Google Sheet Sync warning:', err);
    });
  } catch (e) {
    console.warn('Google Sheet Sync error:', e);
  }
}

// --------------------------------------------------------------------------
// REALTIME MESSAGE BUS (HTML5 BroadcastChannel + Storage Event Fallback)
// --------------------------------------------------------------------------
let realtimeChannel = null;

function initRealtimeChannel() {
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      if (!realtimeChannel) {
        realtimeChannel = new BroadcastChannel('eredt_realtime_bus');
        realtimeChannel.onmessage = (event) => {
          handleRealtimeMessage(event.data);
        };
      }
    } catch (e) {
      console.warn('BroadcastChannel initialization error:', e);
    }
  }

  // Storage Event listener as cross-tab/cross-window fallback
  window.addEventListener('storage', (e) => {
    if (e.key === 'eredt_requests' || e.key === 'eredt_users' || e.key === 'eredt_holidays') {
      handleRealtimeMessage({ type: 'STORAGE_EVENT', key: e.key, timestamp: Date.now() });
    }
  });
}

function broadcastRealtimeUpdate(type, payload = {}) {
  const msg = { type, payload, timestamp: Date.now(), sender: currentUser?.role || 'court' };
  if (realtimeChannel) {
    try {
      realtimeChannel.postMessage(msg);
    } catch (e) {
      console.warn('BroadcastChannel post error:', e);
    }
  }
}

let realtimeToastTimeout = null;
function showRealtimeToast(text) {
  let toast = document.getElementById('realtimeToastNotification');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'realtimeToastNotification';
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: rgba(15, 23, 42, 0.92);
      color: #38bdf8;
      padding: 10px 18px;
      border-radius: 9999px;
      font-size: 0.85rem;
      font-weight: 600;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(56, 189, 248, 0.3);
      display: flex;
      align-items: center;
      gap: 8px;
      z-index: 99999;
      opacity: 0;
      transform: translateY(20px);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      pointer-events: none;
    `;
    document.body.appendChild(toast);
  }

  toast.innerHTML = `<i class="fa-solid fa-bolt" style="color: #fbbf24;"></i> <span>${text || 'อัปเดตข้อมูลสดแบบ Realtime เรียบร้อย'}</span>`;
  toast.style.opacity = '1';
  toast.style.transform = 'translateY(0)';

  if (realtimeToastTimeout) clearTimeout(realtimeToastTimeout);
  realtimeToastTimeout = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
  }, 2200);
}

function handleRealtimeMessage(msg) {
  if (!msg) return;
  console.log('[e-REDT Realtime Bus] Received update:', msg);
  
  // Invalidate In-Memory state so next read gets fresh data
  invalidateInMemoryCache();

  if (currentUser) {
    if (typeof refreshActiveView === 'function') {
      refreshActiveView();
    } else {
      if (typeof currentActiveView !== 'undefined') {
        if (currentActiveView === 'dashboard' && typeof renderDashboard === 'function') renderDashboard();
        else if (currentActiveView === 'requests') {
          if (currentUser.role === 'police' && typeof renderPoliceView === 'function') renderPoliceView();
          else if (typeof renderCourtView === 'function') renderCourtView();
        }
      }
    }
    showRealtimeToast('⚡ ข้อมูลอัปเดตแบบ Realtime แล้ว');
  }
}

// Global Application State
let currentUser = null;
let selectedFile = null;
let currentDate = new Date();
let currentActiveView = 'dashboard';

// --------------------------------------------------------------------------
// 5. TIME WINDOW & STATUS BANNER
// --------------------------------------------------------------------------

function checkTimeWindow() {
  const now = new Date();
  const thaiTimeString = now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' });
  const thaiDate = new Date(thaiTimeString);

  const day = thaiDate.getDay(); // 0 = Sun, 6 = Sat
  const hour = thaiDate.getHours();
  const minute = thaiDate.getMinutes();

  const totalMinutes = hour * 60 + minute;
  const startWindow = 8 * 60 + 30; // 08:30
  const endWindow = 16 * 60;       // 16:00

  const isWeekday = (day >= 1 && day <= 5);
  const isWithinTime = (totalMinutes >= startWindow && totalMinutes <= endWindow);

  const second = thaiDate.getSeconds();
  const formattedTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')} น.`;
  const dayNames = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'];

  if (!isWeekday) {
    return {
      isOpen: false,
      reason: `ระบบปิดรับคำร้องในวันเสาร์-อาทิตย์ (${dayNames[day]} เวลา ${formattedTime})`,
      timeStr: formattedTime
    };
  }

  if (!isWithinTime) {
    return {
      isOpen: false,
      reason: `ระบบเปิดรับคำร้องยื่นอิเล็กทรอนิกส์ระหว่างเวลา 08.30 - 16.00 น. เท่านั้น (${dayNames[day]} เวลา ${formattedTime})`,
      timeStr: formattedTime
    };
  }

  return {
    isOpen: true,
    reason: `ระบบเปิดรับคำร้องยื่นผัดฟ้องฝากขัง (${dayNames[day]} เวลา ${formattedTime})`,
    timeStr: formattedTime
  };
}

let liveClockInterval = null;

function startLiveClock() {
  if (liveClockInterval) clearInterval(liveClockInterval);
  updateTimeWindowBanner();
  liveClockInterval = setInterval(updateTimeWindowBanner, 1000);
}

function updateTimeWindowBanner() {
  const banner = document.getElementById('timeWindowBanner');
  if (!banner) return;

  const timeCheck = checkTimeWindow();
  const clockSpan = document.getElementById('bannerLiveClock');

  if (!clockSpan) {
    if (timeCheck.isOpen) {
      banner.style.background = '#d1fae5';
      banner.style.border = '1px solid #a7f3d0';
      banner.style.color = '#047857';
      banner.innerHTML = `
        <div>
          <i class="fa-solid fa-circle-check" style="color: #059669; font-size: 1.1rem; margin-right: 0.35rem;"></i>
          <b>สถานะระบบ: เปิดรับคำร้องยื่นผัดฟ้องฝากขัง</b> (ช่วงเวลา 08.30 - 16.00 น. จันทร์ - ศุกร์)
        </div>
        <div style="font-size: 0.8rem; background: #047857; color: #ffffff; padding: 0.2rem 0.65rem; border-radius: 999px; font-weight: 600; white-space: nowrap;">
          เวลาปัจจุบัน: <span id="bannerLiveClock">${timeCheck.timeStr}</span>
        </div>
      `;
    } else {
      banner.style.background = '#fee2e2';
      banner.style.border = '1px solid #fca5a5';
      banner.style.color = '#991b1b';
      banner.innerHTML = `
        <div>
          <i class="fa-solid fa-circle-xmark" style="color: #dc2626; font-size: 1.1rem; margin-right: 0.35rem;"></i>
          <b>สถานะระบบ: ปิดรับคำร้องทางระบบ</b> (${timeCheck.reason})
        </div>
        <div style="font-size: 0.8rem; background: #dc2626; color: #ffffff; padding: 0.2rem 0.65rem; border-radius: 999px; font-weight: 600; white-space: nowrap;">
          เวลาปัจจุบัน: <span id="bannerLiveClock">${timeCheck.timeStr}</span>
        </div>
      `;
    }
  } else {
    clockSpan.textContent = timeCheck.timeStr;
  }
}

// --------------------------------------------------------------------------
// 6. AUTHENTICATION & NAVIGATION
// --------------------------------------------------------------------------

function checkSession() {
  try {
    initDatabase();
  } catch (e) {
    console.warn('initDatabase error:', e);
  }

  let savedUser = null;
  try {
    savedUser = sessionStorage.getItem('eredt_session');
  } catch (e) {
    console.warn('sessionStorage read error:', e);
  }

  if (savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
    } catch (e) {
      currentUser = null;
    }
  } else {
    currentUser = null;
  }

  if (currentUser && currentUser.username && currentUser.role) {
    renderAppLayout();
  } else {
    currentUser = null;
    try { sessionStorage.removeItem('eredt_session'); } catch (e) { /* ignore */ }
    showLoginView();
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const username = document.getElementById('usernameInput').value.trim();
  const password = document.getElementById('passwordInput').value.trim();

  if (!username || !password) {
    Swal.fire({
      icon: 'warning',
      title: 'กรุณากรอกข้อมูลให้ครบถ้วน',
      text: 'โปรดกรอกชื่อผู้ใช้งานและรหัสผ่าน'
    });
    return;
  }

  // SPEC ข้อ 3: ไม่มี hardcoded admin — ตรวจสอบจากฐานข้อมูลเท่านั้น

  // 2. Check local users first
  let users = getUsers();
  let user = users.find(u => u.username && u.username.toLowerCase() === username.toLowerCase() && String(u.password) === password);

  // 3. If not found in local memory, check live Google Sheet!
  if (!user) {
    Swal.fire({
      title: 'กำลังตรวจสอบบัญชีผู้ใช้...',
      text: 'กำลังตรวจสอบข้อมูลกับ Google Sheet โปรดรอสักครู่',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    try {
      const scriptUrl = localStorage.getItem('eredt_google_script');
      const csvBaseUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=users`;
      let liveUsers = null;

      if (scriptUrl && scriptUrl.trim() !== '') {
        try {
          const res = await fetch(`${scriptUrl}?action=getUsers`);
          liveUsers = await res.json();
        } catch (e) {
          console.warn('Login live check Apps Script error:', e);
        }
      }

      if (!liveUsers || !Array.isArray(liveUsers) || liveUsers.length === 0) {
        try {
          const csvText = await fetch(csvBaseUrl).then(r => r.text());
          liveUsers = parseUsersCSV(csvText);
        } catch (e) {
          console.warn('Login live check CSV error:', e);
        }
      }

      if (Array.isArray(liveUsers) && liveUsers.length > 0) {
        saveUsers(liveUsers);
        users = getUsers();
        user = users.find(u => u.username && u.username.toLowerCase() === username.toLowerCase() && String(u.password) === password);
      }
    } catch (err) {
      console.warn('Live login verification error:', err);
    }
  }

  if (user) {
    if (user.status && user.status !== 'approved') {
      Swal.fire({
        icon: 'warning',
        title: 'บัญชีผู้ใช้ยังไม่ได้รับอนุมัติ',
        text: 'บัญชีของคุณอยู่ระหว่างการรออนุมัติสิทธิจากผู้ดูแลระบบ'
      });
      return;
    }

    currentUser = user;
    sessionStorage.setItem('eredt_session', JSON.stringify(user));
    
    Swal.fire({
      icon: 'success',
      title: 'เข้าสู่ระบบสำเร็จ',
      text: `ยินดีต้อนรับ คุณ${user.name}`,
      timer: 1500,
      showConfirmButton: false
    });

    renderAppLayout();
    // Fetch and check latest live data from Google Sheet upon login
    fetchLiveGoogleSheetData({ isSilent: true });
  } else {
    Swal.fire({
      icon: 'error',
      title: 'เข้าสู่ระบบไม่สำเร็จ',
      text: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง หรือไม่พบข้อมูลใน Google Sheet'
    });
  }
}

function quickLogin(roleOrUser) {
  // SPEC: ไม่มีบัญชี demo/quick login — ต้อง login ด้วยบัญชีจริงเท่านั้น
  console.warn('quickLogin is disabled per SPEC — use normal login');
}

function handleLogout() {
  if (typeof closeUserDropdown === 'function') closeUserDropdown();
  stopAutoSyncTimer();
  currentUser = null;
  sessionStorage.removeItem('eredt_session');
  sessionStorage.removeItem('eredt_last_view');
  if (window.location.protocol !== 'file:' && window.location.hash) {
    try { history.replaceState(null, null, ' '); } catch(e) {}
  }
  showLoginView();
}

function setElementDisplay(id, displayVal) {
  const el = document.getElementById(id);
  if (el) {
    el.style.setProperty('display', displayVal, 'important');
    if (displayVal === 'none') {
      el.classList.add('hidden');
    } else {
      el.classList.remove('hidden');
    }
  }
}
window.setElementDisplay = setElementDisplay;

function setElementText(id, textVal) {
  const el = document.getElementById(id);
  if (el) el.textContent = textVal;
}
window.setElementText = setElementText;

function setElementValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}
window.setElementValue = setElementValue;

function setElementClass(id, className, isAdd) {
  const el = document.getElementById(id);
  if (el) {
    if (isAdd) el.classList.add(className);
    else el.classList.remove(className);
  }
}
window.setElementClass = setElementClass;

function showLoginView() {
  setElementDisplay('loginView', 'flex');
  setElementDisplay('appHeader', 'none');
  setElementDisplay('appLayoutContainer', 'none');
  
  const users = getUsers();
  const hasCourtAccount = users.some(u => u.role === 'officer' || u.role === 'admin');
  const firstPanel = document.getElementById('firstAccountSetupPanel');
  const normalPanel = document.getElementById('normalLoginPanel');
  if (firstPanel && normalPanel) {
    if (!hasCourtAccount) {
      firstPanel.style.display = 'block';
      normalPanel.style.display = 'none';
    } else {
      firstPanel.style.display = 'none';
      normalPanel.style.display = 'block';
    }
  }
}

function toggleFirstSetupPanel(showSetup) {
  const firstPanel = document.getElementById('firstAccountSetupPanel');
  const normalPanel = document.getElementById('normalLoginPanel');
  if (firstPanel && normalPanel) {
    if (showSetup) {
      firstPanel.style.display = 'block';
      normalPanel.style.display = 'none';
    } else {
      firstPanel.style.display = 'none';
      normalPanel.style.display = 'block';
    }
  }
}
window.toggleFirstSetupPanel = toggleFirstSetupPanel;

function renderAppLayout() {
  if (!currentUser) return;

  setElementDisplay('loginView', 'none');
  setElementDisplay('appHeader', 'flex');
  setElementDisplay('appLayoutContainer', 'flex');

  setElementText('userName', currentUser.name || '');
  setElementText('userDropdownName', currentUser.name || currentUser.username || 'เจ้าหน้าที่ศาล');
  setElementText('userDropdownUsername', '@' + (currentUser.username || ''));
  if (document.getElementById('userAvatar')) {
    const initial = (currentUser.name ? currentUser.name.trim().charAt(0).toUpperCase() : (currentUser.role === 'police' ? 'P' : 'C'));
    setElementText('userAvatar', initial);
  }

  const roleNames = { admin: 'ผู้ดูแลระบบ', officer: 'เจ้าหน้าที่ศาล', police: 'พนักงานสอบสวน' };
  setElementText('userRoleBadge', roleNames[currentUser.role] || currentUser.role);

  // Theme styling
  if (currentUser.role === 'police') {
    document.body.className = 'theme-police';
  } else {
    document.body.className = '';
  }

  // สิทธิ์ผู้ดูแลระบบ (Admin) vs เจ้าหน้าที่ศาลทั่วไป (Officer)
  const isAdmin = (currentUser.role === 'admin');
  const isCourt = (currentUser.role === 'officer' || currentUser.role === 'admin');
  const isPolice = (currentUser.role === 'police');

  // Setup Sidebar Menus based on Role
  setElementDisplay('navCategoryCourt', isCourt ? 'block' : 'none');
  setElementDisplay('navItemCreateBatch', isCourt ? 'block' : 'none');
  setElementDisplay('navItemHolidays', isCourt ? 'block' : 'none');

  setElementDisplay('navCategoryPolice', isPolice ? 'block' : 'none');
  setElementDisplay('navItemStationInbox', isPolice ? 'block' : 'none');
  setElementDisplay('navItemDownloadICS', isPolice ? 'block' : 'none');

  // หากไม่ใช่สิทธิผู้ดูแลระบบ ให้ซ่อนปุ่ม sidebar "จัดการผู้ใช้งาน" และปุ่ม "เชื่อมต่อ Google Services"
  setElementDisplay('navCategoryAdmin', isAdmin ? 'block' : 'none');
  setElementDisplay('navItemUsers', isAdmin ? 'block' : 'none');
  setElementDisplay('navItemGoogleSettings', isAdmin ? 'block' : 'none');
  setElementDisplay('navItemConfigGuide', isAdmin ? 'block' : 'none');

  // Setup Mobile Bottom Nav items based on Role
  setElementDisplay('mbNavQuickUpload', isPolice ? 'flex' : 'none');
  setElementDisplay('mbNavInbox', isPolice ? 'flex' : 'none');
  setElementDisplay('mbNavCreateBatch', isCourt ? 'flex' : 'none');
  setElementDisplay('mbNavHolidays', isCourt ? 'flex' : 'none');
  setElementDisplay('mbNavAdmin', isAdmin ? 'flex' : 'none');

  // Sync Button visible for all court officers
  setElementDisplay('btnSyncGoogleSheet', isCourt ? 'inline-flex' : 'none');

  // Restore Last Active View on Refresh
  let hashView = '';
  if (window.location.protocol !== 'file:') {
    hashView = (window.location.hash || '').replace('#', '').trim();
  }
  let savedView = hashView || sessionStorage.getItem('eredt_last_view') || 'dashboard';
  
  if ((savedView === 'admin' || savedView === 'google_settings' || savedView === 'config_guide') && !isAdmin) {
    savedView = 'dashboard';
  }
  
  switchView(savedView);

  if (isCourt) {
    setTimeout(checkPendingCourtDownloadsAlert, 700);
  }
}

function switchView(viewName, event, subTab) {
  if (event) {
    try {
      if (typeof event.preventDefault === 'function') event.preventDefault();
    } catch (e) {}
  }

  // Auto-close SweetAlert on mobile screens (< 768px) before rendering view
  if (window.innerWidth < 768 && typeof Swal !== 'undefined' && Swal.isVisible && Swal.isVisible()) {
    Swal.close();
  }

  // ป้องกันการเข้าถึงหน้า admin, google_settings หรือ config_guide หากไม่ใช่ผู้ดูแลระบบ
  if ((viewName === 'admin' || viewName === 'google_settings' || viewName === 'config_guide') && (!currentUser || currentUser.role !== 'admin')) {
    Swal.fire({
      icon: 'warning',
      title: 'ไม่มีสิทธิ์เข้าถึง',
      text: 'เฉพาะสิทธิผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถจัดการผู้ใช้งานและตั้งค่าระบบได้'
    });
    viewName = 'dashboard';
  }

  currentActiveView = viewName;
  sessionStorage.setItem('eredt_last_view', viewName);
  
  if (window.location.protocol !== 'file:') {
    try {
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, null, '#' + viewName);
      } else {
        window.location.hash = viewName;
      }
    } catch (e) {}
  }

  setElementDisplay('dashboardView', 'none');
  setElementDisplay('createBatchView', 'none');
  setElementDisplay('requestsView', 'none');
  setElementDisplay('adminView', 'none');
  setElementDisplay('holidaysView', 'none');
  setElementDisplay('googleSettingsView', 'none');
  setElementDisplay('configGuideView', 'none');

  // Reset ALL sidebar navigation items
  document.querySelectorAll('.sidebar-item').forEach(el => {
    el.classList.remove('active');
  });

  // Reset ALL mobile bottom navigation items
  document.querySelectorAll('.bnav-item').forEach(el => {
    el.classList.remove('active');
  });

  if (viewName === 'dashboard') {
    setElementDisplay('dashboardView', 'block');
    setElementClass('navItemDashboard', 'active', true);
    setElementClass('mbNavDashboard', 'active', true);
    renderDashboard();
  } else if (viewName === 'create_batch') {
    const isCourt = currentUser && (currentUser.role === 'officer' || currentUser.role === 'admin');
    if (!isCourt) {
      switchView('dashboard');
      return;
    }
    setElementDisplay('createBatchView', 'block');
    setElementClass('navItemCreateBatch', 'active', true);
    setElementClass('navItemCreateBatchLink', 'active', true);
    setElementClass('mbNavCreateBatch', 'active', true);
    renderCreateBatchView();
  } else if (viewName === 'requests') {
    setElementDisplay('requestsView', 'block');

    if (currentUser && currentUser.role === 'police') {
      setElementDisplay('policeRequestsSection', 'block');
      setElementDisplay('courtRequestsSection', 'none');

      let currentSubTab = subTab;
      if (!currentSubTab) {
        currentSubTab = sessionStorage.getItem('eredt_police_subtab') || 'my_cases';
      }
      sessionStorage.setItem('eredt_police_subtab', currentSubTab);

      if (currentSubTab === 'inbox') {
        setElementDisplay('policeStationInboxPanel', 'block');
        setElementDisplay('policeMyCasesPanel', 'none');
        setElementClass('navItemStationInbox', 'active', true);
        setElementClass('mbNavInbox', 'active', true);

        const btnMyCases = document.getElementById('subTabPoliceMyCases');
        const btnInbox = document.getElementById('subTabPoliceInbox');
        if (btnMyCases && btnInbox) {
          // Unselected My Cases
          btnMyCases.style.background = '#ffffff';
          btnMyCases.style.color = '#000000';
          btnMyCases.style.border = '1px solid #cbd5e1';
          btnMyCases.style.fontWeight = '600';
          btnMyCases.style.boxShadow = 'none';

          // Selected Inbox (Background: System Primary, Text: System Gold)
          btnInbox.style.background = 'var(--primary)';
          btnInbox.style.color = 'var(--accent-gold)';
          btnInbox.style.border = '1px solid var(--primary)';
          btnInbox.style.fontWeight = '700';
          btnInbox.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
        }
      } else {
        setElementDisplay('policeStationInboxPanel', 'none');
        setElementDisplay('policeMyCasesPanel', 'block');
        setElementClass('navItemRequests', 'active', true);
        setElementClass('mbNavRequests', 'active', true);

        const btnMyCases = document.getElementById('subTabPoliceMyCases');
        const btnInbox = document.getElementById('subTabPoliceInbox');
        if (btnMyCases && btnInbox) {
          // Selected My Cases (Background: System Primary, Text: System Gold)
          btnMyCases.style.background = 'var(--primary)';
          btnMyCases.style.color = 'var(--accent-gold)';
          btnMyCases.style.border = '1px solid var(--primary)';
          btnMyCases.style.fontWeight = '700';
          btnMyCases.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';

          // Unselected Inbox
          btnInbox.style.background = '#ffffff';
          btnInbox.style.color = '#000000';
          btnInbox.style.border = '1px solid #cbd5e1';
          btnInbox.style.fontWeight = '600';
          btnInbox.style.boxShadow = 'none';
        }
      }

      renderPoliceView();
    } else {
      setElementDisplay('policeRequestsSection', 'none');
      setElementDisplay('courtRequestsSection', 'block');
      setElementClass('navItemRequests', 'active', true);
      setElementClass('mbNavRequests', 'active', true);
      renderCourtRequestsTable();
    }
  } else if (viewName === 'downloads') {
    const isCourt = currentUser && (currentUser.role === 'officer' || currentUser.role === 'admin');
    if (!isCourt) {
      switchView('dashboard');
      return;
    }
    setElementDisplay('downloadsView', 'block');
    setElementClass('navItemDownloadHistory', 'active', true);
    setElementClass('navItemDownloadHistoryLink', 'active', true);
    setElementClass('mbNavDownloads', 'active', true);
    renderDownloadHistoryTable();
  } else if (viewName === 'holidays') {
    const isCourt = currentUser && (currentUser.role === 'officer' || currentUser.role === 'admin');
    if (!isCourt) {
      switchView('dashboard');
      return;
    }
    setElementDisplay('holidaysView', 'block');
    setElementClass('navItemHolidays', 'active', true);
    setElementClass('navItemHolidaysLink', 'active', true);
    setElementClass('mbNavHolidays', 'active', true);
    renderHolidaysPage();
  } else if (viewName === 'google_settings') {
    const isAdminUser = currentUser && currentUser.role === 'admin';
    if (!isAdminUser) {
      switchView('dashboard');
      return;
    }
    setElementDisplay('googleSettingsView', 'block');
    setElementClass('navItemGoogleSettings', 'active', true);
    setElementClass('navItemGoogleSettingsLink', 'active', true);
    renderGoogleSettingsPage();
  } else if (viewName === 'config_guide') {
    const isAdminUser = currentUser && currentUser.role === 'admin';
    if (!isAdminUser) {
      switchView('dashboard');
      return;
    }
    setElementDisplay('configGuideView', 'block');
    setElementClass('navItemConfigGuide', 'active', true);
    setElementClass('navItemConfigGuideLink', 'active', true);
    renderConfigGuidePage();
  } else if (viewName === 'admin') {
    const isAdminUser = currentUser && currentUser.role === 'admin';
    if (!isAdminUser) {
      switchView('dashboard');
      return;
    }
    setElementDisplay('adminView', 'block');
    setElementClass('navItemUsersLink', 'active', true);
    setElementClass('mbNavAdmin', 'active', true);
    renderAdminView();
  }
}

// --------------------------------------------------------------------------
// 7. DASHBOARD & CALENDAR ENGINE
// --------------------------------------------------------------------------

function isSameStation(station1, station2) {
  if (!station1 || !station2) return false;
  const s1 = String(station1).trim().toLowerCase().replace(/\s+/g, '').replace(/^สภ\./, '').replace(/^สภ/, '');
  const s2 = String(station2).trim().toLowerCase().replace(/\s+/g, '').replace(/^สภ\./, '').replace(/^สภ/, '');
  if (!s1 || !s2) return false;
  return s1 === s2 || s1.includes(s2) || s2.includes(s1);
}
window.isSameStation = isSameStation;

function isMyPoliceCase(c, user) {
  if (!user || user.role !== 'police') return true;

  // 1. Station Matching: ตรวจสอบสถานีตำรวจสังกัด (ต้องตรงกับสถานีของตนเองเท่านั้น ห้ามแสดงผลสถานีอื่นเด็ดขาด)
  if (!user.station || !c.station) return false;
  if (!isSameStation(c.station, user.station)) return false;

  // 2. Officer Matching: ตรวจสอบเจ้าของสำนวนคดี
  const caseOfficer = String(c.officer || '').trim().toLowerCase();
  const userUsername = String(user.username || '').trim().toLowerCase();
  const userName = String(user.name || '').trim().toLowerCase();

  if (!caseOfficer) return false;

  const isOfficerMatch = Boolean(
    (userUsername && caseOfficer === userUsername) ||
    (userName && caseOfficer === userName) ||
    (userUsername && caseOfficer.replace(/\s+/g, '') === userUsername.replace(/\s+/g, '')) ||
    (userName && caseOfficer.replace(/\s+/g, '') === userName.replace(/\s+/g, '')) ||
    (userName && (caseOfficer.includes(userName) || userName.includes(caseOfficer))) ||
    (userUsername && (caseOfficer.includes(userUsername) || userUsername.includes(caseOfficer)))
  );

  return isOfficerMatch;
}

function renderDashboard() {
  if (!currentUser) return;
  const rawRequests = getRequests();
  const holidays = getHolidays();
  const enrichedCases = rawRequests.map(r => enrichCase(r, holidays));

  let filteredCases = enrichedCases;
  if (currentUser && currentUser.role === 'police') {
    filteredCases = enrichedCases.filter(c => isMyPoliceCase(c, currentUser));
    setElementText('dashboardSubtitle', `สภ.: ${currentUser.station || 'ไม่ระบุ'} | พนักงานสอบสวน: คุณ${currentUser.name || currentUser.username} (แสดงเฉพาะสำนวนคดีในความรับผิดชอบ)`);
    setElementText('dashStatTotalLabel', 'คดีในความรับผิดชอบของฉัน');
  } else {
    setElementText('dashboardSubtitle', `คำนวณวันยื่นล่วงหน้า 1 วันทำการและเวลาตัดยื่น 16.00 น. ตามระเบียบศาลจังหวัดอุดรธานี พ.ศ. 2569`);
    setElementText('dashStatTotalLabel', 'คดีทั้งหมดของศาล');
  }

  // Dashboard filtering rule:
  // แสดงเฉพาะรายการที่ยังไม่ดำเนินการอัพโหลดไฟล์ (!c.fileName) และรายการที่ยังไม่มีการดาวน์โหลดไฟล์ (!c.downloaded)
  // หากมีการดาวน์โหลดไฟล์แล้ว (c.downloaded === true) หรือปิดคดีแล้ว (c.closed === true) ให้ตัดรายการเลขฝากขังนั้นออกจากรายการในแดชบอร์ด
  const pendingDashboardCases = filteredCases.filter(c => !c.closed && (!c.downloaded || !c.fileName));

  setElementText('dashStatTotal', pendingDashboardCases.length);
  
  const dueCases = pendingDashboardCases.filter(c => c.status === 'due' || c.status === 'overdue' || c.status === 'uploaded');
  setElementText('dashStatDue', dueCases.length);

  const waitingDownloadCases = pendingDashboardCases.filter(c => c.fileName && !c.downloaded);
  setElementText('dashStatDownloaded', waitingDownloadCases.length);

  const dlStatLabel = document.querySelector('#dashboardView .stat-card:nth-child(3) .stat-label');
  if (dlStatLabel) dlStatLabel.textContent = 'รอศาลดาวน์โหลด / ไฟล์ใหม่';

  renderCalendar(pendingDashboardCases);
  renderMobileTodayList(pendingDashboardCases);
}

/**
 * ฟังก์ชันตรวจสอบและแจ้งเตือน SweetAlert เมื่อมีไฟล์ใหม่/ไฟล์แก้ไขส่งเข้ามาและศาลยังไม่ได้ดาวน์โหลด
 * (จะแจ้งเตือนเมื่อเข้าสู่ระบบ จนกว่าศาลจะดาวน์โหลดไฟล์ครบ)
 */
function checkPendingCourtDownloadsAlert() {
  if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'officer')) return;
  const rawRequests = getRequests();
  const holidays = getHolidays();
  const enriched = rawRequests.map(r => enrichCase(r, holidays));

  // ค้นหารายการคำร้องที่มีไฟล์อัพโหลดเข้ามาแล้ว และศาลยังไม่ได้ดาวน์โหลด (!c.downloaded && c.fileName && !c.closed)
  const pendingFiles = enriched.filter(c => !c.closed && c.fileName && !c.downloaded);
  if (pendingFiles.length === 0) return;

  let listHtml = pendingFiles.map(c => {
    const typeBadge = c.type === 'ยฝ.' ? '<span class="badge badge-type-yf">ยฝ.</span>' : '<span class="badge badge-type-f">ฝ.</span>';
    const uploadTimeStr = c.uploadedAt ? `${formatThaiDate(c.uploadedAt)} ${new Date(c.uploadedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.` : 'ไฟล์ใหม่';
    const isReupload = Boolean(c.reuploaded);
    return `
      <div style="padding: 0.6rem 0.75rem; border: 1px solid #e2e8f0; border-radius: 0.5rem; margin-bottom: 0.4rem; background: ${isReupload ? '#fffbeb' : '#ffffff'}; display: flex; justify-content: space-between; align-items: center; text-align: left; gap: 0.5rem;">
        <div>
          <div style="font-weight: 700; color: #0f172a; font-size: 0.9rem;">
            ${typeBadge} ${c.caseNumber} ${isReupload ? '<span style="color: #b45309; font-size: 0.75rem; font-weight: 700; margin-left: 0.35rem;"><i class="fa-solid fa-rotate-left"></i> นำเข้าไฟล์ใหม่แล้ว</span>' : ''}
          </div>
          <div style="font-size: 0.775rem; color: #64748b; margin-top: 0.15rem;">
            <b>สภ.:</b> ${c.station || 'รอกำหนด'} | <b>พงส.:</b> ${c.officer || '-'} | <b>อัพโหลดเมื่อ:</b> ${uploadTimeStr}
          </div>
        </div>
        <button onclick="downloadCourtFile('${c.caseNumber}'); Swal.close();" type="button" class="btn-primary" style="padding: 0.3rem 0.65rem; font-size: 0.75rem; width: auto; background-color: #0d9488; border-color: #0d9488; color: #ffffff !important; white-space: nowrap;">
          <i class="fa-solid fa-download"></i> ดาวน์โหลด
        </button>
      </div>
    `;
  }).join('');

  Swal.fire({
    icon: 'info',
    title: `<i class="fa-solid fa-file-arrow-down" style="color: #0d9488;"></i> มีไฟล์คำร้องใหม่รอศาลดาวน์โหลด (${pendingFiles.length} รายการ)`,
    html: `
      <div style="text-align: left; font-size: 0.875rem; color: #334155; margin-bottom: 0.75rem;">
        มีไฟล์คำร้องขอฝากขังที่พนักงานสอบสวนอัพโหลด/นำเข้าใหม่เข้าสู่ระบบ กรุณาดาวน์โหลดเอกสาร:
      </div>
      <div style="max-height: 280px; overflow-y: auto; margin-bottom: 0.75rem;">
        ${listHtml}
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: '<i class="fa-solid fa-file-zipper"></i> ดาวน์โหลดทั้งหมด (.ZIP)',
    confirmButtonColor: '#0d9488',
    cancelButtonText: 'ปิดหน้าต่าง',
    cancelButtonColor: '#64748b'
  }).then((result) => {
    if (result.isConfirmed) {
      downloadTodayAllDocuments();
    }
  });
}
window.checkPendingCourtDownloadsAlert = checkPendingCourtDownloadsAlert;

function resetCalendarToToday() {
  currentDate = new Date();
  renderDashboard();
}

function changeMonth(offset) {
  currentDate.setMonth(currentDate.getMonth() + offset);
  renderDashboard();
}

function renderCalendar(cases) {
  const gridContainer = document.getElementById('calendarGridDays');
  if (!gridContainer) return;

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const thaiYear = year < 2400 ? year + 543 : year;
  setElementText('calendarMonthTitle', `${THAI_MONTHS_FULL[month]} ${thaiYear}`);

  const firstDay = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();

  gridContainer.innerHTML = '';

  // Blank padding days
  for (let i = 0; i < firstDay; i++) {
    const blank = document.createElement('div');
    blank.className = 'calendar-day-cell blank';
    gridContainer.appendChild(blank);
  }

  const holidays = getHolidays();
  const todayISO = toISO(new Date());

  for (let day = 1; day <= totalDays; day++) {
    const dayDate = new Date(year, month, day);
    const dayISO = toISO(dayDate);

    const dayCell = document.createElement('div');
    dayCell.className = 'calendar-day-cell';

    const isToday = (dayISO === todayISO);
    const isWknd = isWeekend(dayDate);
    const isHolidy = isHoliday(dayISO, holidays);

    if (isToday) dayCell.classList.add('today');
    if (isWknd) dayCell.classList.add('weekend');
    if (isHolidy) dayCell.classList.add('holiday');

    // Header row inside day card
    const headerRow = document.createElement('div');
    headerRow.className = 'day-header-row';

    const numberSpan = document.createElement('div');
    numberSpan.className = 'calendar-day-number';
    numberSpan.textContent = day;
    headerRow.appendChild(numberSpan);

    if (isToday) {
      const todayBadge = document.createElement('span');
      todayBadge.className = 'today-tag';
      todayBadge.textContent = 'วันนี้';
      headerRow.appendChild(todayBadge);
    } else if (isHolidy) {
      const holidayObj = holidays.find(h => h.date === dayISO);
      const holiTag = document.createElement('span');
      holiTag.className = 'holiday-tag';
      holiTag.textContent = holidayObj ? holidayObj.name : 'วันหยุด';
      headerRow.appendChild(holiTag);
    }

    dayCell.appendChild(headerRow);

    // Cases matching filingDeadline (วันต้องยื่นคำร้อง)
    const filingCases = cases.filter(c => c.filingDeadline === dayISO && !c.closed);

    const badgesContainer = document.createElement('div');
    badgesContainer.className = 'calendar-badges-container';

    if (filingCases.length > 0) {
      const fBadge = document.createElement('div');
      fBadge.className = 'calendar-count-badge badge-filing';
      fBadge.innerHTML = `<span><i class="fa-solid fa-clock"></i> ต้องยื่น</span> <span class="count-number-pill">${filingCases.length}</span>`;
      badgesContainer.appendChild(fBadge);
    }

    if (filingCases.length > 0) {
      dayCell.appendChild(badgesContainer);
      dayCell.onclick = (e) => {
        e.stopPropagation();
        openDayDetailModal(dayISO);
      };
    } else {
      dayCell.onclick = () => {
        openDayDetailModal(dayISO);
      };
    }

    gridContainer.appendChild(dayCell);
  }
}

function openDayDetailModal(dayISO) {
  const rawRequests = getRequests();
  const holidays = getHolidays();
  const enriched = rawRequests.map(r => enrichCase(r, holidays));

  let filtered = enriched.filter(c => c.filingDeadline === dayISO);
  const isPolice = (currentUser && currentUser.role === 'police');
  if (isPolice) {
    filtered = filtered.filter(c => c.officer === currentUser.username);
  }

  const dateTitle = formatThaiDate(dayISO, true);

  if (filtered.length === 0) {
    Swal.fire({
      icon: 'info',
      title: `<i class="fa-solid fa-calendar-day" style="color: var(--primary);"></i> ประจำวันที่ ${dateTitle}`,
      html: `<div style="font-size: 0.95rem; color: #475569; padding: 0.5rem 0;">ไม่มีรายการคำร้องผัดฟ้องฝากขังในวันนี้</div>`,
      confirmButtonText: 'ตกลง',
      confirmButtonColor: '#1e3a8a'
    });
    return;
  }

  let tableHtml = '';

  if (!isPolice) {
    // SPEC ข้อ 5.5: ดาวน์โหลดไฟล์คำร้องแบบกลุ่มแยกตามสถานีประจำวัน (ฝั่งศาล)
    const stationsMap = {};
    filtered.forEach(c => {
      const st = c.station || 'รอจับคู่สถานี';
      if (!stationsMap[st]) stationsMap[st] = [];
      stationsMap[st].push(c);
    });

    const groupsHtml = Object.keys(stationsMap).map(st => {
      const stationCases = stationsMap[st];
      const pendingFiles = stationCases.filter(c => c.fileName && !c.downloaded && c.filingDeadline === dayISO);
      const hasPendingFiles = (pendingFiles.length > 0 && st !== 'รอจับคู่สถานี');

      const rows = stationCases.map(c => {
        const typeBadge = c.type === 'ยฝ.' ? '<span class="badge badge-type-yf">ยฝ.</span>' : '<span class="badge badge-type-f">ฝ.</span>';
        const pdfBtn = c.fileName ? `
          <button onclick="Swal.close(); previewPdfFile('${c.caseNumber}', event);" type="button" class="btn-secondary" style="padding: 0.25rem 0.55rem; font-size: 0.75rem; background-color: #0284c7; border-color: #0284c7; color: #fff; width: auto;">
            <i class="fa-solid fa-file-pdf"></i> ${c.downloaded ? 'ดูไฟล์' : 'ไฟล์ใหม่'}
          </button>
        ` : '-';
        return `
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 0.5rem 0.4rem;">${typeBadge}</td>
            <td style="padding: 0.5rem 0.4rem;"><b>${c.caseNumber}</b></td>
            <td style="padding: 0.5rem 0.4rem;">${c.officer || '<span style="color:#b45309;">ไม่มีเจ้าของ</span>'}</td>
            <td style="padding: 0.5rem 0.4rem;">ครั้งที่ ${c.k}</td>
            <td style="padding: 0.5rem 0.4rem;"><b style="color: #b45309;">${formatThaiDate(c.legalDeadline)}</b></td>
            <td style="padding: 0.5rem 0.4rem;">${renderStatusBadge(c.status)}</td>
            <td style="padding: 0.5rem 0.4rem;">${pdfBtn}</td>
          </tr>
        `;
      }).join('');

      return `
        <div style="margin-bottom: 1rem; border: 1px solid #cbd5e1; border-radius: 0.5rem; overflow: hidden; background: #ffffff; text-align: left;">
          <div style="background: #f1f5f9; padding: 0.6rem 0.8rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; flex-wrap: wrap; gap: 0.5rem;">
            <div style="font-weight: 700; color: var(--primary); font-size: 0.9rem;">
              <i class="fa-solid fa-building-shield"></i> ${st} <span style="font-size: 0.8rem; color: #64748b; font-weight: normal;">(${stationCases.length} คดี)</span>
            </div>
            <div>
              ${hasPendingFiles ? `
                <button onclick="Swal.close(); downloadStationBatch('${dayISO}', '${st}');" class="btn-primary" style="padding: 0.25rem 0.65rem; font-size: 0.75rem; width: auto; background-color: #059669; border-color: #059669;">
                  <i class="fa-solid fa-cloud-arrow-down"></i> โหลดไฟล์ สภ. นี้ (${pendingFiles.length} ไฟล์)
                </button>
              ` : ''}
            </div>
          </div>
          <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.825rem;">
            <thead>
              <tr style="background: #f8fafc; text-align: left; color: #475569;">
                <th style="padding: 0.4rem;">ประเภท</th>
                <th style="padding: 0.4rem;">เลขฝากขัง</th>
                <th style="padding: 0.4rem;">พนักงานสอบสวน</th>
                <th style="padding: 0.4rem;">ครั้งที่</th>
                <th style="padding: 0.4rem;">ครบกำหนด</th>
                <th style="padding: 0.4rem;">สถานะ</th>
                <th style="padding: 0.4rem;">เอกสาร</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      `;
    }).join('');

    tableHtml = `<div style="max-height: 420px; overflow-y: auto; text-align: left; margin-top: 0.5rem;">${groupsHtml}</div>`;
  } else {
    // Police view: single clean table of officer's cases
    let rowsHtml = filtered.map(c => {
      const typeBadge = c.type === 'ยฝ.' ? '<span class="badge badge-type-yf">ยฝ.</span>' : '<span class="badge badge-type-f">ฝ.</span>';
      const pdfBtn = c.fileName ? `
        <button onclick="Swal.close(); previewPdfFile('${c.caseNumber}', event);" type="button" class="btn-secondary" style="padding: 0.25rem 0.55rem; font-size: 0.75rem; background-color: #0284c7; border-color: #0284c7; color: #fff; width: auto;">
          <i class="fa-solid fa-file-pdf"></i> ไฟล์ PDF
        </button>
      ` : '-';

      return `
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 0.6rem 0.4rem;">${typeBadge}</td>
          <td style="padding: 0.6rem 0.4rem;"><b>${c.caseNumber}</b></td>
          <td style="padding: 0.6rem 0.4rem;">${c.station || 'รอกำหนด'}</td>
          <td style="padding: 0.6rem 0.4rem;">ครั้งที่ ${c.k}</td>
          <td style="padding: 0.6rem 0.4rem;"><b style="color: #b45309;">${formatThaiDate(c.legalDeadline)}</b></td>
          <td style="padding: 0.6rem 0.4rem;">${renderStatusBadge(c.status)}</td>
          <td style="padding: 0.6rem 0.4rem;">${pdfBtn}</td>
        </tr>
      `;
    }).join('');

    tableHtml = `
      <div style="max-height: 360px; overflow-y: auto; text-align: left; margin-top: 0.5rem;">
        <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
          <thead>
            <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; text-align: left;">
              <th style="padding: 0.5rem 0.4rem;">ประเภท</th>
              <th style="padding: 0.5rem 0.4rem;">เลขฝากขัง</th>
              <th style="padding: 0.5rem 0.4rem;">สภ.</th>
              <th style="padding: 0.5rem 0.4rem;">ครั้งที่</th>
              <th style="padding: 0.5rem 0.4rem;">ครบกำหนด</th>
              <th style="padding: 0.5rem 0.4rem;">สถานะ</th>
              <th style="padding: 0.5rem 0.4rem;">เอกสาร</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    `;
  }

  Swal.fire({
    title: `<i class="fa-solid fa-calendar-day" style="color: var(--primary);"></i> รายการคำร้องประจำวันที่ ${dateTitle}`,
    html: tableHtml,
    width: window.innerWidth < 768 ? '95%' : (isPolice ? '680px' : '760px'),
    showConfirmButton: true,
    confirmButtonText: 'ปิดหน้าต่าง',
    confirmButtonColor: '#1e3a8a'
  });

  // Safe fallback for legacy modal if elements happen to exist
  const titleEl = document.getElementById('dayDetailTitle');
  if (titleEl) titleEl.textContent = `รายการคำร้องประจำวันที่ ${dateTitle}`;
  const tbody = document.getElementById('dayDetailTableBody');
  if (tbody) {
    tbody.innerHTML = '';
    filtered.forEach(c => {
      const typeBadge = c.type === 'ยฝ.' ? '<span class="badge badge-type-yf">ยฝ.</span>' : '<span class="badge badge-type-f">ฝ.</span>';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${typeBadge}</td>
        <td><b>${c.caseNumber}</b></td>
        <td>${c.station || 'รอกำหนด'}</td>
        <td>ครั้งที่ ${c.k}</td>
        <td>${formatThaiDate(c.legalDeadline)}</td>
        <td>${renderStatusBadge(c.status)}</td>
        <td>${c.fileName ? `<button onclick="previewPdfFile('${c.caseNumber}', event)" class="btn-secondary" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;"><i class="fa-solid fa-file-pdf"></i> เปิดไฟล์</button>` : '-'}</td>
      `;
      tbody.appendChild(tr);
    });
    openModal('dayDetailModal');
  }
}
window.openDayDetailModal = openDayDetailModal;

// --------------------------------------------------------------------------
// 8. POLICE WORKFLOW & STATION INBOX
// --------------------------------------------------------------------------

function openMobileStationInbox(event) {
  if (event) {
    try { if (typeof event.preventDefault === 'function') event.preventDefault(); } catch (e) {}
    try { if (typeof event.stopPropagation === 'function') event.stopPropagation(); } catch (e) {}
  }

  if (window.innerWidth < 768) {
    // Auto-close existing SweetAlert on mobile
    if (typeof Swal !== 'undefined' && Swal.isVisible && Swal.isVisible()) {
      Swal.close();
    }

    // Check if there are inbox items
    const rawRequests = getRequests();
    const holidays = getHolidays();
    const enriched = rawRequests.map(r => enrichCase(r, holidays));
    const stationInbox = currentUser ? enriched.filter(c => c.station === currentUser.station && !c.officer && !c.closed) : [];

    if (stationInbox.length === 0) {
      Swal.fire({
        icon: 'info',
        title: '<i class="fa-solid fa-inbox" style="color: #f59e0b;"></i> กล่องจดหมายสถานี',
        html: `<div style="font-size: 0.95rem; color: #475569; line-height: 1.6;">
                <p style="margin-bottom: 0.5rem;">ยังไม่มีคดีใหม่ที่รอรับเป็นเจ้าของ</p>
                <p style="font-size: 0.8rem; color: #94a3b8;">สังกัด: <b>${currentUser?.station || 'ไม่ระบุ'}</b></p>
               </div>`,
        confirmButtonText: 'ตกลง',
        confirmButtonColor: '#1e3a8a'
      });
      return;
    }
  }

  // If has data or not mobile, switch to inbox view normally
  switchView('requests', event, 'inbox');
}
window.openMobileStationInbox = openMobileStationInbox;

function renderPoliceView() {
  if (!currentUser) return;
  startLiveClock();
  setElementText('policeStationSub', `สังกัด: ${currentUser.station || 'ไม่ระบุ'}`);

  const rawRequests = getRequests();
  const holidays = getHolidays();
  const enriched = rawRequests.map(r => enrichCase(r, holidays));

  // 1. Station Inbox: Unassigned cases strictly for police's station only (ห้ามแสดงผลสถานีอื่นเด็ดขาด)
  const stationInbox = enriched.filter(c => 
    isSameStation(c.station, currentUser.station) && 
    !c.officer && 
    !c.closed
  );
  setElementText('stationInboxCount', `${stationInbox.length} คดีรอรับ`);
  setElementText('policeInboxBadgeCount', `${stationInbox.length}`);

  const inboxTbody = document.getElementById('stationInboxTableBody');
  inboxTbody.innerHTML = '';

  if (stationInbox.length === 0) {
    inboxTbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">ไม่มีคดีใหม่รอรับเป็นเจ้าของในกล่องจดหมายสถานี (${currentUser.station || 'สังกัดของท่าน'})</td></tr>`;
  } else {
    stationInbox.forEach(c => {
      const typeBadge = c.type === 'ยฝ.' ? '<span class="badge badge-type-yf">ยฝ.</span>' : '<span class="badge badge-type-f">ฝ.</span>';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${typeBadge}</td>
        <td><b>${c.caseNumber}</b></td>
        <td>${formatThaiDate(c.startDate)}</td>
        <td>ครั้งที่ ${c.k}</td>
        <td><b style="color: #b45309;">${formatThaiDate(c.filingDeadline)} (16.00 น.)</b></td>
        <td>${formatThaiDate(c.legalDeadline)}</td>
        <td>
          <div style="display: flex; gap: 0.35rem; align-items: center;">
            <button onclick="claimForMe('${c.caseNumber}', event)" type="button" class="btn-primary" style="padding: 0.3rem 0.75rem; font-size: 0.8rem; width: auto;">
              <i class="fa-solid fa-hand-holding-hand"></i> รับเป็นเจ้าของคดี
            </button>
            <button onclick="openReturnModal('${c.caseNumber}')" type="button" class="btn-secondary" style="padding: 0.3rem 0.65rem; font-size: 0.8rem; width: auto; background-color: #d97706; border-color: #d97706; color: #fff;" title="คืนสำนวนกลับกองกลางศาล">
              <i class="fa-solid fa-rotate-left"></i> คืนสำนวน
            </button>
          </div>
        </td>
      `;
      inboxTbody.appendChild(tr);
    });
  }

  // 2. My Registered Cases Table
  renderPoliceTable();
}

function renderPoliceTable() {
  const searchTerm = (document.getElementById('policeSearchInput')?.value || '').toLowerCase().trim();
  const rawRequests = getRequests();
  const holidays = getHolidays();
  const enriched = rawRequests.map(r => enrichCase(r, holidays));

  const myCases = enriched.filter(c => c.officer === currentUser.username && (c.caseNumber.toLowerCase().includes(searchTerm) || (c.station && c.station.toLowerCase().includes(searchTerm))));

  const tbody = document.getElementById('policeTableBody');
  tbody.innerHTML = '';

  if (myCases.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">ยังไม่มีคดีในทะเบียนส่วนตัวของคุณ (กดรับคดีจากกล่องจดหมายสถานีด้านบน)</td></tr>`;
  } else {
    myCases.forEach(c => {
      const typeBadge = c.type === 'ยฝ.' ? '<span class="badge badge-type-yf">ยฝ.</span>' : '<span class="badge badge-type-f">ฝ.</span>';
      const isPast = isPastCutoff(c.filingDeadline);

      let actionButtons = '';
      if (!c.closed) {
        const isClosedTime = isPast;

        if (c.fileName) {
          // File HAS been uploaded -> Show Preview PDF + re-upload & return
          actionButtons += `
            <button onclick="previewPdfFile('${c.caseNumber}', event)" type="button" class="btn-secondary" style="padding: 0.3rem 0.65rem; font-size: 0.775rem; width: auto; background-color: #0284c7; border-color: #0284c7; color: #ffffff !important; display: inline-flex; align-items: center; gap: 0.3rem; white-space: nowrap;" title="ดูตัวอย่างไฟล์ PDF">
              <i class="fa-solid fa-file-pdf"></i> Preview PDF
            </button>
          `;

          const canReupload = !isClosedTime && !c.closed;
          actionButtons += `
            <button ${canReupload ? `onclick="openUploadModal('${c.caseNumber}')"` : 'disabled'} type="button" class="btn-primary btn-police-upload" style="padding: 0.3rem 0.65rem; font-size: 0.775rem; width: auto; display: inline-flex; align-items: center; gap: 0.3rem; white-space: nowrap; ${canReupload ? '' : 'opacity: 0.55; cursor: not-allowed; background-color: #94a3b8; border-color: #94a3b8;'}" title="${isClosedTime ? 'เลยเวลา 16.00 น. ไม่สามารถอัพโหลดทับได้' : 'อัพโหลดไฟล์ใหม่ทับของเดิม'}">
              <i class="fa-solid fa-upload"></i> อัพโหลดทับ
            </button>
          `;

          if (!c.history || c.history.length === 0) {
            actionButtons += `
              <button onclick="openReturnModal('${c.caseNumber}')" type="button" class="btn-secondary" style="padding: 0.3rem 0.65rem; font-size: 0.775rem; width: auto; background-color: #d97706; border-color: #d97706; color: #ffffff !important; display: inline-flex; align-items: center; gap: 0.3rem; white-space: nowrap;" title="คืนสำนวนกลับกองกลางศาล">
                <i class="fa-solid fa-rotate-left"></i> คืนสำนวน
              </button>
            `;
          }
        } else {
          // File has NOT been uploaded yet -> Show red warning ONLY if time is closed
          if (isClosedTime) {
            actionButtons += `<span style="font-size: 0.75rem; color: #dc2626; font-weight: 700; white-space: nowrap;"><i class="fa-solid fa-ban"></i> เลย 16.00 น. ยื่นที่ศาลด้วยตนเอง</span>`;
          } else {
            actionButtons += `
              <button onclick="openUploadModal('${c.caseNumber}')" type="button" class="btn-primary btn-police-upload" style="padding: 0.3rem 0.65rem; font-size: 0.775rem; width: auto; display: inline-flex; align-items: center; gap: 0.3rem; white-space: nowrap;">
                <i class="fa-solid fa-upload"></i> อัพโหลด PDF
              </button>
            `;
            if (!c.history || c.history.length === 0) {
              actionButtons += `
                <button onclick="openReturnModal('${c.caseNumber}')" type="button" class="btn-secondary" style="padding: 0.3rem 0.65rem; font-size: 0.775rem; width: auto; background-color: #d97706; border-color: #d97706; color: #ffffff !important; display: inline-flex; align-items: center; gap: 0.3rem; white-space: nowrap;" title="คืนสำนวนกลับกองกลางศาล">
                  <i class="fa-solid fa-rotate-left"></i> คืนสำนวน
                </button>
              `;
            }
          }
        }
      } else {
        let closedTimeInfo = '';
        if (c.closedAt) {
          const cDate = new Date(c.closedAt);
          closedTimeInfo = `<div style="font-size: 0.7rem; color: #dc2626; margin-top: 0.25rem; font-weight: 700; white-space: nowrap;"><i class="fa-solid fa-clock"></i> เสร็จสิ้น: ${formatThaiDate(c.closedAt)} ${cDate.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.</div>`;
        }
        actionButtons = `
          <span class="badge badge-status-closed" style="background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; font-size: 0.75rem; padding: 0.25rem 0.55rem; display: inline-flex; align-items: center; gap: 0.25rem; white-space: nowrap;">
            <i class="fa-solid fa-lock"></i> เสร็จสิ้นการฝากขังแล้ว
          </span>
          ${closedTimeInfo}
        `;
      }

      let flagWarning = '';
      if (c.courtFlag) {
        flagWarning = `
          <div class="court-flag-banner">
            <i class="fa-solid fa-triangle-exclamation"></i> <b>ศาลแจ้งไฟล์ผิด:</b> ${c.courtFlag.reason}
          </div>
        `;
      }

      const tr = document.createElement('tr');
      tr.onclick = (e) => {
        if (window.innerWidth <= 768 && !e.target.closest('button')) {
          openMobileCaseActionModal(c.caseNumber);
        }
      };
      tr.innerHTML = `
        <td>${typeBadge}</td>
        <td><b>${c.caseNumber}</b></td>
        <td>ครั้งที่ ${c.k}</td>
        <td><b style="color: #b45309;">${formatThaiDate(c.filingDeadline)}</b></td>
        <td>${formatThaiDate(c.legalDeadline)}</td>
        <td>${c.cap || 84} วัน (${c.cap === 48 ? 4 : 7} ครั้ง)</td>
        <td>
          ${renderStatusBadge(c.status)}
          ${c.fileName ? `<br><small style="color: var(--text-muted);">${c.fileName}</small>` : ''}
          ${flagWarning}
        </td>
        <td style="white-space: nowrap;">
          <div style="display: inline-flex; align-items: center; gap: 0.35rem; white-space: nowrap;">
            ${actionButtons}
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }
}

function claimForMe(caseNumber, event) {
  if (event) {
    try { if (typeof event.preventDefault === 'function') event.preventDefault(); } catch (e) {}
    try { if (typeof event.stopPropagation === 'function') event.stopPropagation(); } catch (e) {}
  }
  const requests = getRequests();
  const index = requests.findIndex(r => r.caseNumber === caseNumber);
  if (index !== -1) {
    requests[index].officer = currentUser.username;
    saveRequests(requests);
    Swal.fire({ icon: 'success', title: 'รับเป็นเจ้าของคดีเรียบร้อย', timer: 1200, showConfirmButton: false });
    renderPoliceView();
  }
}
window.claimForMe = claimForMe;

function previewPdfFile(caseNumber, event) {
  if (event) {
    try { if (typeof event.preventDefault === 'function') event.preventDefault(); } catch (e) {}
    try { if (typeof event.stopPropagation === 'function') event.stopPropagation(); } catch (e) {}
  }
  const requests = getRequests();
  const c = requests.find(r => r.caseNumber === caseNumber);
  if (!c || !c.fileName) {
    Swal.fire({ icon: 'warning', title: 'ไม่พบไฟล์ PDF', text: 'คดีนี้ยังไม่ได้ถูกอัพโหลดไฟล์ PDF' });
    return;
  }

  if (c.fileUrl) {
    window.open(c.fileUrl, '_blank');
  } else {
    Swal.fire({
      icon: 'info',
      title: `<i class="fa-solid fa-file-pdf" style="color: #dc2626;"></i> ${c.fileName}`,
      html: `<div style="text-align: left; font-size: 0.9rem; color: #334155; line-height: 1.6;">
              <p style="margin-bottom: 0.4rem;"><b>เลขคำร้องฝากขัง:</b> ${c.caseNumber} (ครั้งที่ ${c.k})</p>
              <p style="margin-bottom: 0.4rem;"><b>ชื่อไฟล์ PDF:</b> ${c.fileName}</p>
              <p style="margin-bottom: 0.4rem;"><b>สถานะดาวน์โหลดของศาล:</b> ${c.downloaded ? '<span style="color: #059669; font-weight: 600;">ศาลเปิดดู/ดาวน์โหลดแล้ว (ไม่สามารถอัพโหลดทับหรือคืนสำนวนได้)</span>' : '<span style="color: #d97706; font-weight: 600;">รอศาลตรวจรับ/ดาวน์โหลด (สามารถอัพโหลดทับไฟล์ใหม่ได้)</span>'}</p>
             </div>`,
      confirmButtonText: 'ตกลง',
      confirmButtonColor: '#1e3a8a'
    });
  }
}
window.previewPdfFile = previewPdfFile;

function openUploadModal(caseNumber) {
  const requests = getRequests();
  const c = requests.find(r => r.caseNumber === caseNumber);
  if (!c) return;

  if (c.closed) {
    Swal.fire({
      icon: 'warning',
      title: 'คดีนี้ปิดแล้ว',
      text: 'คดีนี้ปิดการติดตามแล้ว ไม่สามารถอัพโหลดไฟล์ได้'
    });
    return;
  }

  const isPast = isPastCutoff(c.filingDeadline);
  if (isPast) {
    Swal.fire({
      icon: 'warning',
      title: 'ไม่สามารถอัพโหลดไฟล์ได้',
      html: `<div style="text-align: left; font-size: 0.9rem; color: #334155; line-height: 1.6;">
              <p style="color: #dc2626; font-weight: 700; margin-bottom: 0.5rem;"><i class="fa-solid fa-clock"></i> เลยเวลา 16.00 น. ของวันครบกำหนดยื่นในระบบแล้ว (${formatThaiDate(c.filingDeadline)})</p>
              <p style="color: #b45309; font-weight: 600;">* ท่านต้องนำเอกสารคำร้องยื่นผัดฟ้องฝากขังไปยื่นต่อศาลด้วยตนเองเท่านั้น</p>
             </div>`,
      confirmButtonText: 'รับทราบ',
      confirmButtonColor: '#1e3a8a'
    });
    return;
  }

  setElementValue('uploadCaseNumber', c.caseNumber);
  setElementText('uploadCaseNumberDisplay', `เลขคดี: ${c.caseNumber}`);
  setElementText('uploadCaseInfoDisplay', `ครั้งที่ ${c.k} | สภ.: ${c.station || 'ไม่ระบุ'}`);

  selectedFile = null;
  setElementValue('pdfFileInput', '');
  setElementText('dropzoneText', 'คลิก หรือ ลากไฟล์ PDF มาวางที่นี่');

  const statusDiv = document.getElementById('pdfValidationStatus');
  if (statusDiv) statusDiv.style.display = 'none';

  const submitBtn = document.getElementById('submitRequestBtn');
  if (submitBtn) submitBtn.disabled = true;

  openModal('addRequestModal');
}

function triggerMobileQuickUpload(event) {
  if (event) event.preventDefault();
  if (!currentUser) return;

  const rawRequests = getRequests();
  const holidays = getHolidays();
  const enriched = rawRequests.map(r => enrichCase(r, holidays));

  // Find cases for police officer that need upload and NOT past cutoff (16:00 of filingDeadline)
  let pendingCases = enriched.filter(c => 
    (!c.closed) && 
    (!c.fileName || c.courtFlag) && 
    !isPastCutoff(c.filingDeadline) &&
    (currentUser.role === 'police' ? (c.officer === currentUser.username) : true)
  );

  if (pendingCases.length === 0) {
    // Check if there are any assigned active cases that can be re-uploaded
    let allUserCases = enriched.filter(c => 
      !c.closed && 
      !isPastCutoff(c.filingDeadline) &&
      (currentUser.role === 'police' ? (c.officer === currentUser.username) : true)
    );

    if (allUserCases.length > 0) {
      let optionsHtml = allUserCases.map(c => `
        <div style="padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 0.6rem; margin-bottom: 0.5rem; text-align: left; display: flex; justify-content: space-between; align-items: center; background: #ffffff;">
          <div>
            <div style="font-weight: 700; color: var(--primary); font-size: 0.95rem;">${c.type} ${c.caseNumber} (ครั้งที่ ${c.k})</div>
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.15rem;">สถานะ: ${c.fileName ? 'มีไฟล์อัพโหลดแล้ว' : 'ยังไม่มีไฟล์'}</div>
          </div>
          <button onclick="Swal.close(); openUploadModal('${c.caseNumber}');" class="btn-primary" style="width: auto; padding: 0.4rem 0.75rem; font-size: 0.8rem;">
            <i class="fa-solid fa-cloud-arrow-up"></i> ${c.fileName ? 'อัพทับ' : 'อัพใหม่'}
          </button>
        </div>
      `).join('');

      Swal.fire({
        title: 'เลือกคดีที่ต้องการอัพโหลด PDF',
        html: `<div style="max-height: 320px; overflow-y: auto; margin-top: 0.5rem;">${optionsHtml}</div>`,
        showConfirmButton: false,
        showCloseButton: true
      });
      return;
    }

    Swal.fire({
      icon: 'info',
      title: 'ไม่พบรายการคดีที่สามารถอัพโหลดได้',
      text: 'ไม่มีรายการคดีที่รออัพโหลด หรือคดีในระบบเลยเวลาตัดยื่น 16.00 น. แล้ว (ต้องนำยื่นศาลด้วยตนเอง)'
    });
    return;
  }

  if (pendingCases.length === 1) {
    openUploadModal(pendingCases[0].caseNumber);
    return;
  }

  if (pendingCases.length > 1) {
    let optionsHtml = pendingCases.map(c => `
      <div style="padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 0.6rem; margin-bottom: 0.5rem; text-align: left; display: flex; justify-content: space-between; align-items: center; background: #ffffff;">
        <div>
          <div style="font-weight: 700; color: var(--primary); font-size: 0.95rem;">${c.type} ${c.caseNumber} (ครั้งที่ ${c.k})</div>
          <div style="font-size: 0.75rem; color: #b45309; margin-top: 0.15rem;"><i class="fa-solid fa-clock"></i> ยื่นภายใน: ${formatThaiDate(c.filingDeadline)} (16.00 น.)</div>
        </div>
        <button onclick="Swal.close(); openUploadModal('${c.caseNumber}');" class="btn-primary" style="width: auto; padding: 0.4rem 0.75rem; font-size: 0.8rem;">
          <i class="fa-solid fa-cloud-arrow-up"></i> เลือกคดีนี้
        </button>
      </div>
    `).join('');

    Swal.fire({
      title: 'เลือกคดีที่ต้องการอัพโหลด PDF',
      html: `<div style="max-height: 320px; overflow-y: auto; margin-top: 0.5rem;">${optionsHtml}</div>`,
      showConfirmButton: false,
      showCloseButton: true
    });
    return;
  }
}

let rawSelectedFileObject = null;

function handleFileSelected(file) {
  if (!file) return;

  rawSelectedFileObject = file;
  const fileMeta = { name: file.name, sizeBytes: file.size, fileUrl: URL.createObjectURL(file) };
  const check = validateUploadFile(fileMeta);

  const statusDiv = document.getElementById('pdfValidationStatus');
  statusDiv.style.display = 'block';

  if (check.valid) {
    selectedFile = fileMeta;
    statusDiv.style.background = '#d1fae5';
    statusDiv.style.color = '#047857';
    statusDiv.innerHTML = `<i class="fa-solid fa-circle-check"></i> ไฟล์ถูกต้อง: <b>${file.name}</b> (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
    document.getElementById('submitRequestBtn').disabled = false;
  } else {
    selectedFile = null;
    rawSelectedFileObject = null;
    statusDiv.style.background = '#fee2e2';
    statusDiv.style.color = '#991b1b';
    statusDiv.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> ${check.reason}`;
    document.getElementById('submitRequestBtn').disabled = true;
  }
}

function handleCreateRequest(event) {
  event.preventDefault();
  const caseNumber = document.getElementById('uploadCaseNumber').value;
  if (!selectedFile) return;

  const requests = getRequests();
  const holidays = getHolidays();
  const index = requests.findIndex(r => r.caseNumber === caseNumber);

  if (index === -1) return;

  const targetCase = requests[index];
  const isPast = targetCase ? isPastCutoff(targetCase.filingDeadline) : false;

  if (isPast || targetCase.closed) {
    closeModal('addRequestModal');
    Swal.fire({
      icon: 'error',
      title: 'ไม่สามารถอัพโหลดไฟล์ได้',
      text: 'ขณะนี้เลยเวลา 16.00 น. ของวันครบกำหนดยื่นคำร้องออนไลน์ หรือคดีนี้ปิดแล้ว กรุณานำเอกสารยื่นต่อศาลด้วยตนเอง'
    });
    return;
  }

  const scriptUrl = localStorage.getItem('eredt_google_script');
  const driveFolderId = localStorage.getItem('eredt_drive_folder') || DEFAULT_DRIVE_FOLDER_ID;

  Swal.fire({
    title: 'กำลังอัพโหลดคำร้องไป Google Drive...',
    text: `กำลังจัดเก็บไฟล์เข้าระบบและสร้าง/ค้นหาโฟลเดอร์สำหรับ ${targetCase.station || (currentUser ? currentUser.station : null) || 'สภ.เมืองอุดรธานี'}`,
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  if (scriptUrl && rawSelectedFileObject) {
    const reader = new FileReader();
    reader.onload = function(e) {
      const base64Data = e.target.result;
      
      fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'uploadFile',
          fileName: selectedFile.name,
          fileData: base64Data,
          station: targetCase.station || (currentUser ? currentUser.station : null) || 'ทั่วไป',
          driveFolderId: driveFolderId
        })
      })
      .then(res => res.json())
      .then(resData => {
        if (resData && resData.fileUrl) {
          selectedFile.fileUrl = resData.fileUrl;
        }
        finishUploadProcess();
      })
      .catch(err => {
        console.warn('Google Drive direct upload warning, proceeding locally:', err);
        finishUploadProcess();
      });
    };
    reader.readAsDataURL(rawSelectedFileObject);
  } else {
    finishUploadProcess();
  }

  function finishUploadProcess() {
    const result = uploadFile(requests[index], selectedFile, holidays);
    if (result.ok) {
      requests[index] = result.case;
      saveRequests(requests);
      closeModal('addRequestModal');
      Swal.fire({ icon: 'success', title: 'อัพโหลดคำร้องเรียบร้อย', text: 'จัดเก็บไฟล์เข้า Google Drive และซิงค์ตาราง Google Sheet เรียบร้อยแล้ว', timer: 1800, showConfirmButton: false });
      renderPoliceView();
    } else {
      Swal.fire({ icon: 'error', title: 'ไม่อนุญาตให้อัพโหลด', text: result.reason });
    }
  }
}

function openReturnModal(caseNumber) {
  const requests = getRequests();
  const index = requests.findIndex(r => r.caseNumber === caseNumber);
  if (index === -1) return;
  const c = requests[index];

  if (c.history && c.history.length > 0) {
    Swal.fire({
      icon: 'warning',
      title: 'ไม่สามารถคืนสำนวนได้',
      text: 'คดีนี้เคยถูกศาลรับเรื่องไปแล้วอย่างน้อยหนึ่งครั้ง ไม่สามารถคืนสำนวนผ่านระบบได้ กรุณาติดต่อเจ้าหน้าที่ศาลโดยตรง'
    });
    return;
  }

  Swal.fire({
    title: 'ยืนยันการคืนสำนวน',
    text: `คุณต้องการคืนสำนวนคดี ${caseNumber} กลับเข้ากล่องจดหมายกลางของศาลเพื่อจับคู่สถานีใหม่หรือไม่?`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonColor: '#dc2626',
    cancelButtonColor: '#64748b',
    confirmButtonText: 'ใช่, คืนสำนวน',
    cancelButtonText: 'ยกเลิก'
  }).then((result) => {
    if (result.isConfirmed) {
      const res = returnToPool(c);
      if (res.ok) {
        requests[index] = res.case;
        saveRequests(requests);
        Swal.fire({ icon: 'success', title: 'คืนสำนวนเข้ากองกลางศาลเรียบร้อย', timer: 1500, showConfirmButton: false });
        renderPoliceView();
      } else {
        Swal.fire({ icon: 'error', title: 'คืนสำนวนไม่สำเร็จ', text: res.reason });
      }
    }
  });
}

function handleConfirmReturnToPool(event) {
  event.preventDefault();
  const caseNumber = document.getElementById('returnCaseNumber').value;
  const reason = document.getElementById('returnReasonInput').value;

  const requests = getRequests();
  const index = requests.findIndex(r => r.caseNumber === caseNumber);

  if (index !== -1) {
    const result = returnToPool(requests[index], reason);
    if (result.ok) {
      requests[index] = result.case;
      saveRequests(requests);
      closeModal('returnToPoolModal');
      Swal.fire({ icon: 'success', title: 'คืนสำนวนเข้ากองกลางศาลเรียบร้อย', timer: 1500, showConfirmButton: false });
      renderPoliceView();
    } else {
      Swal.fire({ icon: 'error', title: 'คืนสำนวนไม่สำเร็จ', text: result.reason });
    }
  }
}

function downloadPersonalICS(event) {
  if (event) event.preventDefault();
  const rawRequests = getRequests();
  const holidays = getHolidays();
  const enriched = rawRequests.map(r => enrichCase(r, holidays));

  const myCases = enriched.filter(c => c.officer === currentUser.username);
  const icsText = generateICS(myCases, `คำร้องฝากขัง - ${currentUser.name}`);

  const blob = new Blob([icsText], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `remand-calendar-${currentUser.username}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  Swal.fire({
    icon: 'success',
    title: 'ดาวน์โหลดไฟล์ปฏิทินสำเร็จ',
    text: 'สามารถนำไฟล์ .ics นี้ไปนำเข้าใน Google Calendar หรือ Apple Calendar ได้ทันที'
  });
}

// --------------------------------------------------------------------------
// 9. COURT OFFICER WORKFLOW & BATCH NUMBERS
// --------------------------------------------------------------------------

function renderCreateBatchView() {
  if (!currentUser) return;

  const curYear = new Date().getFullYear();
  const beYear = curYear < 2400 ? curYear + 543 : curYear;
  const batchYearInput = document.getElementById('batchYearInput');
  if (batchYearInput && !batchYearInput.value) batchYearInput.value = beYear;

  setThaiDatePickerValue('batchStartDateInput', new Date());

  const rawRequests = getRequests();
  const holidays = getHolidays();
  const enriched = rawRequests.map(r => enrichCase(r, holidays));

  // Render Sub-Sections matching uploaded image workflow:
  // 1. Assigned to station, waiting for police claim
  const assignedUnclaimed = enriched.filter(c => c.station && !c.officer && !c.closed);
  const countAssignedEl = document.getElementById('countAssignedUnclaimed');
  if (countAssignedEl) countAssignedEl.textContent = assignedUnclaimed.length;

  const containerAssigned = document.getElementById('containerAssignedUnclaimed');
  if (containerAssigned) {
    if (assignedUnclaimed.length === 0) {
      containerAssigned.innerHTML = `
        <div style="text-align: center; padding: 0.85rem; color: #94a3b8; font-size: 0.85rem; background: #f8fafc; border-radius: 0.5rem;">
          ไม่มีคดีที่รอพนักงานรับตอนนี้
        </div>
      `;
    } else {
      let html = `<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.75rem;">`;
      assignedUnclaimed.forEach(c => {
        html += `
          <div style="background: #fff8f0; border: 1px solid #fed7aa; padding: 0.6rem 0.85rem; border-radius: 0.5rem;">
            <div style="font-weight: 700; color: #b45309; font-size: 0.9rem;">${c.caseNumber}</div>
            <div style="font-size: 0.775rem; color: #78350f; margin-top: 0.15rem;">
              <i class="fa-solid fa-building-shield"></i> ${c.station}
            </div>
            <div style="font-size: 0.725rem; color: #a16207; margin-top: 0.1rem;">
              วันที่เริ่ม: ${formatThaiDate(c.startDate)}
            </div>
          </div>
        `;
      });
      html += `</div>`;
      containerAssigned.innerHTML = html;
    }
  }

  // 2. Unassigned cases waiting for station pairing
  const unassignedCases = enriched.filter(c => !c.station && !c.officer && !c.closed);
  const countUnassignedEl = document.getElementById('countUnassignedTotal');
  if (countUnassignedEl) countUnassignedEl.textContent = unassignedCases.length;

  const summaryUnassignedEl = document.getElementById('summaryUnassignedCount');
  if (summaryUnassignedEl) summaryUnassignedEl.textContent = unassignedCases.length;

  const summaryUnclaimedEl = document.getElementById('summaryUnclaimedCount');
  if (summaryUnclaimedEl) summaryUnclaimedEl.textContent = assignedUnclaimed.length;

  const containerUnassigned = document.getElementById('containerUnassignedBatches');
  if (containerUnassigned) {
    if (unassignedCases.length === 0) {
      containerUnassigned.innerHTML = `
        <div style="text-align: center; padding: 0.85rem; color: #94a3b8; font-size: 0.85rem; background: #f8fafc; border-radius: 0.5rem;">
          ไม่มีเลขที่รอจับคู่สถานี
        </div>
      `;
    } else {
      let html = `<div style="display: flex; flex-direction: column; gap: 0.75rem;">`;
      unassignedCases.forEach(c => {
        const safeId = c.caseNumber.replace(/[^a-zA-Z0-9]/g, '_');
        html += `
          <div style="background: #f0f9ff; border: 1px solid #bae6fd; padding: 0.75rem 1rem; border-radius: 0.5rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem;">
            <div>
              <span style="font-weight: 700; color: #0369a1; font-size: 0.95rem; margin-right: 0.5rem;">${c.caseNumber}</span>
              <span style="font-size: 0.775rem; color: #0284c7;">(วันที่เริ่ม: ${formatThaiDate(c.startDate)})</span>
            </div>
            <div style="display: flex; gap: 0.5rem; align-items: center;">
              <select id="selectPair_${safeId}" class="form-control" style="font-size: 0.8rem; padding: 0.25rem 0.5rem; width: 190px;">
                <option value="">-- เลือกสถานีตำรวจ (23 สภ.) --</option>
                ${UDON_STATIONS.map(st => `<option value="${st}">${st}</option>`).join('')}
              </select>
              <button onclick="pairCaseToStation('${c.caseNumber}')" class="btn-primary" style="padding: 0.3rem 0.75rem; font-size: 0.8rem; width: auto;">
                <i class="fa-solid fa-link"></i> จับคู่สถานี
              </button>
            </div>
          </div>
        `;
      });
      html += `</div>`;
      containerUnassigned.innerHTML = html;
    }
  }
}
window.renderCreateBatchView = renderCreateBatchView;

function renderCourtView() {
  renderCreateBatchView();
  renderCourtRequestsTable();
}
window.renderCourtView = renderCourtView;

function pairCaseToStation(caseNumber) {
  const safeId = caseNumber.replace(/[^a-zA-Z0-9]/g, '_');
  const selectEl = document.getElementById(`selectPair_${safeId}`);
  if (!selectEl || !selectEl.value) {
    Swal.fire({ icon: 'warning', title: 'กรุณาเลือกสถานีตำรวจ', text: 'เลือกสถานีตำรวจที่ต้องการจับคู่ก่อนกดจับคู่' });
    return;
  }

  const station = selectEl.value;
  const requests = getRequests();
  const target = requests.find(r => r.caseNumber === caseNumber);
  if (target) {
    target.station = station;
    saveRequests(requests);
    if (typeof currentActiveView !== 'undefined' && currentActiveView === 'create_batch') {
      renderCreateBatchView();
    } else {
      renderCourtView();
    }
    Swal.fire({ icon: 'success', title: 'จับคู่สถานีเรียบร้อย', text: `จับคู่เลขคดี ${caseNumber} กับ ${station} สำเร็จ`, timer: 1200, showConfirmButton: false });
  }
}

// --------------------------------------------------------------------------
// BATCH MATCH STATION (จับคู่สถานีตำรวจหลายรายการ)
// --------------------------------------------------------------------------

let batchMatchSelectedCases = new Set();
let batchMatchSearchQuery = '';

function openBatchMatchStationModal() {
  if (!currentUser) return;
  batchMatchSelectedCases = new Set();
  batchMatchSearchQuery = '';

  const stationSelect = document.getElementById('batchMatchStationSelect');
  if (stationSelect) {
    stationSelect.innerHTML = `<option value="">-- กรุณาเลือกสถานีตำรวจเป้าหมาย (23 สภ.) --</option>`;
    UDON_STATIONS.forEach(st => {
      const isDefault = (st === 'สภ.เมืองอุดรธานี');
      stationSelect.innerHTML += `<option value="${st}" ${isDefault ? 'selected' : ''}>${st}</option>`;
    });
    stationSelect.value = 'สภ.เมืองอุดรธานี';
  }

  const searchInput = document.getElementById('batchMatchSearchFilter');
  if (searchInput) searchInput.value = '';

  renderBatchMatchModalContent();
  openModal('batchMatchStationModal');
}
window.openBatchMatchStationModal = openBatchMatchStationModal;

function renderBatchMatchModalContent() {
  const requests = getRequests();
  // Filter unassigned cases that are not closed, strictly deduplicated by caseNumber
  const unassignedMap = new Map();
  requests.forEach(c => {
    if (!c.closed && (!c.station || c.station === '' || c.station === 'รอจับคู่สถานี')) {
      const key = (c.caseNumber || '').trim();
      if (key && !unassignedMap.has(key)) {
        unassignedMap.set(key, c);
      }
    }
  });
  const unassignedCases = Array.from(unassignedMap.values());

  // Sort unassigned cases nicely (by Type, Year desc, Num asc)
  unassignedCases.sort((a, b) => {
    const compA = parseCaseComponents(a.caseNumber);
    const compB = parseCaseComponents(b.caseNumber);
    if (!compA || !compB) return String(a.caseNumber).localeCompare(String(b.caseNumber));
    if (compA.type !== compB.type) return compA.type.localeCompare(compB.type);
    if (compA.year !== compB.year) return compB.year - compA.year;
    return (compA.num || 0) - (compB.num || 0);
  });

  const availableContainer = document.getElementById('batchMatchAvailableChipsContainer');
  const selectedContainer = document.getElementById('batchMatchSelectedChipsContainer');
  const availableCountEl = document.getElementById('batchMatchAvailableCount');
  const selectedCountEl = document.getElementById('batchMatchSelectedCount');
  const submitCountEl = document.getElementById('btnBatchMatchSubmitCount');

  if (availableCountEl) availableCountEl.textContent = unassignedCases.length;
  if (selectedCountEl) selectedCountEl.textContent = batchMatchSelectedCases.size;
  if (submitCountEl) submitCountEl.textContent = batchMatchSelectedCases.size;

  // Render Selected Chips Box (Always sorted numerically ascending from left to right)
  if (selectedContainer) {
    if (batchMatchSelectedCases.size === 0) {
      selectedContainer.innerHTML = `<span style="color: #64748b; font-size: 0.85rem; font-weight: 500; padding: 0.25rem 0.5rem;">ยังไม่มีเลขที่เลือก (คลิกเลือกจากรายการด้านล่าง)</span>`;
    } else {
      let selectedHtml = '';
      const selectedArray = Array.from(batchMatchSelectedCases);
      // Sort selected cases ascending (Type, Year desc, Num asc: น้อยไปหามาก)
      selectedArray.sort((a, b) => {
        const compA = parseCaseComponents(a);
        const compB = parseCaseComponents(b);
        if (!compA || !compB) return String(a).localeCompare(String(b));
        if (compA.type !== compB.type) return compA.type.localeCompare(compB.type);
        if (compA.year !== compB.year) return compB.year - compA.year;
        return (compA.num || 0) - (compB.num || 0);
      });

      selectedArray.forEach(caseNum => {
        selectedHtml += `
          <span style="display: inline-flex; align-items: center; gap: 0.4rem; background: #047857; border: 1px solid #065f46; color: #ffffff !important; font-weight: 700; font-family: monospace; font-size: 0.875rem; padding: 0.35rem 0.7rem; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.15);">
            <span style="color: #ffffff !important;">${caseNum}</span>
            <button onclick="toggleBatchMatchCase('${caseNum}')" type="button" style="border: none; background: rgba(255,255,255,0.25); cursor: pointer; color: #ffffff !important; font-size: 0.8rem; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; padding: 0; margin-left: 0.15rem; transition: background 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.45)'" onmouseout="this.style.background='rgba(255,255,255,0.25)'" title="ยกเลิกการเลือก">
              <i class="fa-solid fa-xmark" style="color: #ffffff !important;"></i>
            </button>
          </span>
        `;
      });
      selectedContainer.innerHTML = selectedHtml;
    }
  }

  // Render Available Unassigned Chips
  if (availableContainer) {
    let filteredCases = unassignedCases;
    if (batchMatchSearchQuery) {
      filteredCases = unassignedCases.filter(c => (c.caseNumber || '').toLowerCase().includes(batchMatchSearchQuery.toLowerCase()));
    }

    if (filteredCases.length === 0) {
      availableContainer.innerHTML = `<div style="width: 100%; text-align: center; color: #64748b; font-size: 0.875rem; font-weight: 600; padding: 1.5rem;">${unassignedCases.length === 0 ? 'ไม่มีเลขฝากขังที่รอจับคู่ในระบบ' : 'ไม่พบเลขฝากขังตรงตามคำค้นหา'}</div>`;
    } else {
      let chipsHtml = '';
      filteredCases.forEach(c => {
        const isSelected = batchMatchSelectedCases.has(c.caseNumber);
        
        if (isSelected) {
          // Disabled badge state (เมื่อเลือกแล้ว ให้ disabled รายการเลขนั้น)
          chipsHtml += `
            <button type="button" disabled style="padding: 0.4rem 0.75rem; border-radius: 0.45rem; font-size: 0.85rem; font-weight: 700; font-family: monospace; border: 1px solid #cbd5e1; background: #e2e8f0; color: #475569 !important; cursor: not-allowed; opacity: 0.8; display: inline-flex; align-items: center; gap: 0.35rem;" title="เลือกไว้แล้วในกล่องด้านบน">
              <i class="fa-solid fa-circle-check" style="color: #059669 !important; font-size: 0.85rem;"></i>
              <span style="color: #64748b !important; text-decoration: line-through;">${c.caseNumber}</span>
            </button>
          `;
        } else {
          // Clickable badge state (High-contrast, crystal clear!)
          const isYF = (c.type === 'ยฝ.');
          const bgCol = isYF ? '#f5f3ff' : '#eff6ff';
          const borderCol = isYF ? '#8b5cf6' : '#3b82f6';
          const textCol = isYF ? '#5b21b6' : '#1e40af';
          const plusCol = isYF ? '#7c3aed' : '#2563eb';
          const hoverBg = isYF ? '#ede9fe' : '#dbeafe';

          chipsHtml += `
            <button onclick="toggleBatchMatchCase('${c.caseNumber}')" type="button" style="padding: 0.4rem 0.75rem; border-radius: 0.45rem; font-size: 0.875rem; font-weight: 800; font-family: monospace; border: 2px solid ${borderCol}; background: ${bgCol}; color: ${textCol} !important; cursor: pointer; display: inline-flex; align-items: center; gap: 0.35rem; transition: all 0.15s ease; box-shadow: 0 1px 2px rgba(0,0,0,0.06);" onmouseover="this.style.background='${hoverBg}'; this.style.transform='translateY(-1px)';" onmouseout="this.style.background='${bgCol}'; this.style.transform='none';">
              <span style="color: ${plusCol} !important; font-size: 0.95rem; font-weight: 900;">+</span>
              <span style="color: ${textCol} !important;">${c.caseNumber}</span>
            </button>
          `;
        }
      });
      availableContainer.innerHTML = chipsHtml;
    }
  }
}
window.renderBatchMatchModalContent = renderBatchMatchModalContent;

function toggleBatchMatchCase(caseNumber) {
  if (batchMatchSelectedCases.has(caseNumber)) {
    batchMatchSelectedCases.delete(caseNumber);
  } else {
    batchMatchSelectedCases.add(caseNumber);
  }
  renderBatchMatchModalContent();
}
window.toggleBatchMatchCase = toggleBatchMatchCase;

function selectAllBatchMatchCases() {
  const requests = getRequests();
  const unassignedMap = new Map();
  requests.forEach(c => {
    if (!c.closed && (!c.station || c.station === '' || c.station === 'รอจับคู่สถานี')) {
      const key = (c.caseNumber || '').trim();
      if (key && !unassignedMap.has(key)) {
        unassignedMap.set(key, c);
      }
    }
  });
  const unassignedCases = Array.from(unassignedMap.values());
  
  let targetCases = unassignedCases;
  if (batchMatchSearchQuery) {
    targetCases = unassignedCases.filter(c => (c.caseNumber || '').toLowerCase().includes(batchMatchSearchQuery.toLowerCase()));
  }

  targetCases.forEach(c => batchMatchSelectedCases.add(c.caseNumber));
  renderBatchMatchModalContent();
}
window.selectAllBatchMatchCases = selectAllBatchMatchCases;

function clearAllBatchMatchCases() {
  batchMatchSelectedCases.clear();
  renderBatchMatchModalContent();
}
window.clearAllBatchMatchCases = clearAllBatchMatchCases;

function filterBatchMatchChips() {
  batchMatchSearchQuery = (document.getElementById('batchMatchSearchFilter')?.value || '').trim();
  renderBatchMatchModalContent();
}
window.filterBatchMatchChips = filterBatchMatchChips;

function handleConfirmBatchMatch() {
  const stationSelect = document.getElementById('batchMatchStationSelect');
  const station = (stationSelect?.value || '').trim();

  if (!station) {
    Swal.fire({
      icon: 'warning',
      title: 'กรุณาเลือกสถานีตำรวจ',
      text: 'กรุณาเลือกสถานีตำรวจเป้าหมายที่ต้องการจับคู่ก่อนกดยืนยัน',
      confirmButtonColor: '#0d9488'
    });
    return;
  }

  if (batchMatchSelectedCases.size === 0) {
    Swal.fire({
      icon: 'warning',
      title: 'กรุณาเลือกเลขฝากขัง',
      text: 'กรุณาคลิกเลือกเลขฝากขังอย่างน้อย 1 รายการเพื่อทำการจับคู่',
      confirmButtonColor: '#0d9488'
    });
    return;
  }

  const selectedList = Array.from(batchMatchSelectedCases);
  const requests = getRequests();
  let updatedCount = 0;

  requests.forEach(r => {
    if (batchMatchSelectedCases.has(r.caseNumber)) {
      r.station = station;
      updatedCount++;
    }
  });

  saveRequests(requests);
  closeModal('batchMatchStationModal');
  renderCourtView();

  const formattedCasesText = selectedList.join(', ');

  Swal.fire({
    icon: 'success',
    title: 'จับคู่สถานีตำรวจสำเร็จแล้ว',
    html: `
      <div style="text-align: left; font-size: 0.9rem; line-height: 1.6;">
        <div style="margin-bottom: 0.35rem;">
          <b>สถานีตำรวจ:</b> <span style="color: #0284c7; font-weight: 700; font-size: 1rem;">${station}</span>
        </div>
        <div style="margin-bottom: 0.5rem;">
          <b>จำนวนที่จับคู่:</b> <span style="color: #059669; font-weight: 700;">${selectedList.length}</span> รายการ
        </div>
        <div style="font-weight: 600; color: #475569; margin-bottom: 0.25rem;">รายการเลขฝากขังที่จับคู่สำเร็จ:</div>
        <div style="background: #f8fafc; padding: 0.75rem; border-radius: 0.5rem; border: 1px solid #e2e8f0; max-height: 140px; overflow-y: auto; font-family: monospace; font-size: 0.85rem; font-weight: 700; color: #0f172a; line-height: 1.5;">
          ${formattedCasesText}
        </div>
      </div>
    `,
    confirmButtonText: 'ตกลง',
    confirmButtonColor: '#0d9488'
  });
}
window.handleConfirmBatchMatch = handleConfirmBatchMatch;

function compareCaseNumbers(caseA, caseB) {
  const strA = String(caseA || '').trim();
  const strB = String(caseB || '').trim();
  
  const matchA = strA.match(/^([^\d\/]+)?(\d+)(?:\/(\d+))?/);
  const matchB = strB.match(/^([^\d\/]+)?(\d+)(?:\/(\d+))?/);

  if (matchA && matchB) {
    const prefixA = matchA[1] || '';
    const prefixB = matchB[1] || '';
    if (prefixA !== prefixB) {
      return prefixA.localeCompare(prefixB, 'th');
    }
    const numA = parseInt(matchA[2], 10) || 0;
    const numB = parseInt(matchB[2], 10) || 0;
    if (numA !== numB) {
      return numA - numB;
    }
    const yearA = parseInt(matchA[3] || '0', 10);
    const yearB = parseInt(matchB[3] || '0', 10);
    return yearA - yearB;
  }

  return strA.localeCompare(strB, undefined, { numeric: true, sensitivity: 'base' });
}
window.compareCaseNumbers = compareCaseNumbers;

function sortCourtCases(casesList) {
  return [...casesList].sort((a, b) => {
    // 1. เรียงตามกลุ่มสถานี (Station)
    const stA = String(a.station || '').trim();
    const stB = String(b.station || '').trim();
    const stComp = stA.localeCompare(stB, 'th', { numeric: true });
    if (stComp !== 0) return stComp;

    // 2. เรียงเลขฝากขัง จากน้อยไปมาก
    return compareCaseNumbers(a.caseNumber, b.caseNumber);
  });
}
window.sortCourtCases = sortCourtCases;

function renderCourtRowHTML(c) {
  const typeBadge = c.type === 'ยฝ.' ? '<span class="badge badge-type-yf">ยฝ.</span>' : '<span class="badge badge-type-f">ฝ.</span>';
  
  let returnedBadge = '';
  if (c.returnedNote) {
    returnedBadge = `
      <div class="returned-note-banner">
        <i class="fa-solid fa-rotate-left"></i> <b>คืนสำนวนจาก:</b> ${c.returnedNote.returnedFromStation || ''}<br>
        ${c.returnedNote.reason}
      </div>
    `;
  }

  let fileCell = '<span style="color: var(--text-muted); font-size: 0.8rem; white-space: nowrap;">ยังไม่อัพโหลด</span>';
  if (c.fileName) {
    let downloadInfo = '';
    if (c.downloaded && c.downloadedAt) {
      const dlDate = new Date(c.downloadedAt);
      const dlTimeStr = dlDate.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
      downloadInfo = `<div style="font-size: 0.7rem; color: #059669; margin-top: 0.25rem; white-space: nowrap;"><i class="fa-solid fa-circle-check"></i> โหลดล่าสุด: ${formatThaiDate(c.downloadedAt)} ${dlTimeStr} น.</div>`;
    } else if (c.downloaded) {
      downloadInfo = `<div style="font-size: 0.7rem; color: #059669; margin-top: 0.25rem;"><i class="fa-solid fa-circle-check"></i> ดาวน์โหลดแล้ว</div>`;
    }
    fileCell = `
      <button onclick="downloadCourtFile('${c.caseNumber}')" class="btn-secondary" style="padding: 0.25rem 0.55rem; font-size: 0.75rem; width: auto; display: inline-flex; align-items: center; gap: 0.25rem;">
        <i class="fa-solid fa-file-pdf" style="color: #dc2626;"></i> ${c.fileName}
      </button>
      ${downloadInfo}
    `;
  }

  let courtActions = '';
  if (!c.closed) {
    const canReceive = c.fileName && c.downloaded && !c.courtFlag;
    courtActions += `
      <button onclick="openReceiveModal('${c.caseNumber}')" class="btn-primary" style="padding: 0.25rem 0.55rem; font-size: 0.75rem; width: auto; background-color: #059669; border-color: #059669; display: inline-flex; align-items: center; gap: 0.25rem;" ${canReceive ? '' : 'disabled'}>
        <i class="fa-solid fa-check-double"></i> ยืนยันรับเรื่อง
      </button>
    `;
    if (c.fileName) {
      courtActions += `
        <button onclick="openFlagModal('${c.caseNumber}')" class="btn-secondary" style="padding: 0.25rem 0.55rem; font-size: 0.75rem; width: auto; background-color: #d97706; border-color: #d97706; color: #ffffff !important; display: inline-flex; align-items: center; gap: 0.25rem;" title="ส่งคืนคำร้องให้พนักงานสอบสวนแก้ไข/แนบไฟล์ใหม่">
          <i class="fa-solid fa-rotate-left"></i> ส่งคืน
        </button>
      `;
    }
    courtActions += `
      <button onclick="handleFinishCase('${c.caseNumber}')" class="btn-danger" style="padding: 0.25rem 0.55rem; font-size: 0.75rem; width: auto; background-color: #dc2626; border-color: #dc2626; color: #ffffff !important; display: inline-flex; align-items: center; gap: 0.25rem;" title="เสร็จสิ้นการฝากขัง (ปิดสำนวน)">
        <i class="fa-solid fa-lock"></i> เสร็จสิ้น
      </button>
    `;
  } else {
    let closedTimeStr = '';
    if (c.closedAt) {
      const cDate = new Date(c.closedAt);
      closedTimeStr = `<div style="font-size: 0.7rem; color: #dc2626; margin-top: 0.25rem; font-weight: 700; white-space: nowrap;"><i class="fa-solid fa-clock"></i> เสร็จสิ้น: ${formatThaiDate(c.closedAt)} ${cDate.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.</div>`;
    }
    courtActions = `
      <span class="badge badge-status-closed" style="background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; font-size: 0.75rem; padding: 0.25rem 0.5rem; display: inline-flex; align-items: center; gap: 0.25rem; white-space: nowrap;">
        <i class="fa-solid fa-lock"></i> เสร็จสิ้นแล้ว
      </span>
      ${closedTimeStr}
    `;
  }

  const capTimes = c.cap === 12 ? 1 : (c.cap === 48 ? 4 : 7);

  return `
    <td data-order="${c.type || ''}">${typeBadge}</td>
    <td data-order="${c.caseNumber || ''}"><b>${c.caseNumber}</b></td>
    <td data-order="${c.station || ''}">${c.station || '<span style="color:#d97706;">รอจับคู่</span>'} ${returnedBadge}</td>
    <td data-order="${c.officer || ''}">
      ${c.officer || '<span style="color:#b45309;">ไม่มีเจ้าของ</span>'}
      ${(!c.closed && c.station) ? `<button onclick="openTransferModal('${c.caseNumber}')" class="btn-secondary" style="padding: 0.15rem 0.35rem; font-size: 0.7rem; width: auto; margin-left: 0.25rem;" title="โอนย้ายคดีให้พนักงานสอบสวนอื่น"><i class="fa-solid fa-arrow-right-arrow-left"></i></button>` : ''}
    </td>
    <td data-order="${c.k || 1}">ครั้งที่ ${c.k}</td>
    <td data-order="${c.filingDeadline || ''}"><b style="color: #b45309;">${formatThaiDate(c.filingDeadline)}</b></td>
    <td data-order="${c.legalDeadline || ''}">${formatThaiDate(c.legalDeadline)}</td>
    <td data-order="${c.cap || 84}">
      ${c.cap || 84} วัน (${capTimes} ครั้ง)
      ${!c.closed ? `<button onclick="openEditCapModal('${c.caseNumber}')" class="btn-secondary" style="padding: 0.15rem 0.35rem; font-size: 0.7rem; width: auto; margin-left: 0.25rem;" title="แก้ไขเพดานฝากขัง"><i class="fa-solid fa-pen"></i></button>` : ''}
    </td>
    <td data-order="${c.status || ''}">${renderStatusBadge(c.status)}</td>
    <td data-order="${c.fileName ? 1 : 0}">${fileCell}</td>
    <td style="white-space: nowrap; width: 1%;">
      <div class="table-actions-cell">
        ${courtActions}
      </div>
    </td>
  `;
}

function renderCourtRequestsTable() {
  if (!currentUser) return;

  // Populate Station dropdown filter
  const stationSelect = document.getElementById('courtStationFilter');
  if (stationSelect && stationSelect.options.length <= 1) {
    stationSelect.innerHTML = `<option value="">ทุกสถานีตำรวจ (23 สภ.)</option>`;
    UDON_STATIONS.forEach(st => {
      stationSelect.innerHTML += `<option value="${st}">${st}</option>`;
    });
  }

  const stationFilter = (document.getElementById('courtStationFilter')?.value || '').trim();
  const statusFilter = (document.getElementById('courtStatusFilter')?.value || '').trim();
  const searchTerm = (document.getElementById('courtSearchInput')?.value || '').toLowerCase().trim();

  const rawRequests = getRequests();
  const holidays = getHolidays();
  const enriched = rawRequests.map(r => enrichCase(r, holidays));

  // Update today's documents count badge
  const todayISO = toISO(new Date());
  const todayDocs = enriched.filter(c => 
    (c.filingDeadline === todayISO || (c.uploadedAt && c.uploadedAt.startsWith(todayISO))) &&
    c.fileName
  );
  const badgeEl = document.getElementById('todayDocsCountBadge');
  if (badgeEl) {
    badgeEl.textContent = todayDocs.length;
  }

  let filtered = enriched;
  if (stationFilter) filtered = filtered.filter(c => c.station === stationFilter);

  if (statusFilter) {
    if (statusFilter === 'uploaded') {
      filtered = filtered.filter(c => c.fileName || c.status === 'uploaded' || c.status === 'downloaded');
    } else if (statusFilter === 'due') {
      filtered = filtered.filter(c => c.status === 'due' || (c.daysRemaining !== null && c.daysRemaining >= 0 && c.daysRemaining <= 3));
    } else if (statusFilter === 'blocked') {
      filtered = filtered.filter(c => c.status === 'blocked');
    } else if (statusFilter === 'pending') {
      filtered = filtered.filter(c => !c.fileName && !c.closed && c.status !== 'blocked');
    } else {
      filtered = filtered.filter(c => c.status === statusFilter);
    }
  }

  if (searchTerm) {
    filtered = filtered.filter(c => 
      c.caseNumber.toLowerCase().includes(searchTerm) || 
      (c.station && c.station.toLowerCase().includes(searchTerm)) ||
      (c.officer && c.officer.toLowerCase().includes(searchTerm))
    );
  }

  // Separate into 2 groups: Uploaded vs Pending (ยังไม่อัพโหลด)
  const uploadedCases = filtered.filter(c => Boolean(c.fileName));
  const pendingCases = filtered.filter(c => !c.fileName);

  // Sort both groups: Group by Station and sort Case Numbers from lowest to highest
  const sortedUploaded = sortCourtCases(uploadedCases);
  const sortedPending = sortCourtCases(pendingCases);

  // Update table count badges
  setElementText('courtUploadedCountBadge', `${sortedUploaded.length} คดี`);
  setElementText('courtPendingCountBadge', `${sortedPending.length} คดี`);

  const isDesktop = (window.innerWidth >= 768);

  // Suppress native alert popups and destroy existing DataTables
  if (typeof jQuery !== 'undefined' && typeof jQuery.fn.DataTable !== 'undefined') {
    jQuery.fn.dataTable.ext.errMode = 'none';
    const upEl = $('#courtUploadedRequestsDataTable');
    if (upEl.length && $.fn.DataTable.isDataTable(upEl)) {
      upEl.DataTable().destroy();
    }
    const pendEl = $('#courtPendingRequestsDataTable');
    if (pendEl.length && $.fn.DataTable.isDataTable(pendEl)) {
      pendEl.DataTable().destroy();
    }
  }

  // 1. Render Table 1: Uploaded Cases (ด้านบน)
  const uploadedTbody = document.getElementById('courtUploadedTableBody');
  if (uploadedTbody) {
    uploadedTbody.innerHTML = '';
    if (sortedUploaded.length === 0) {
      if (!isDesktop) {
        uploadedTbody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">ไม่มีรายการคำร้องที่อัพโหลดไฟล์แล้ว</td></tr>`;
      }
    } else {
      sortedUploaded.forEach(c => {
        const tr = document.createElement('tr');
        tr.onclick = (e) => {
          if (window.innerWidth <= 768 && !e.target.closest('button') && !e.target.closest('a')) {
            openMobileCaseActionModal(c.caseNumber);
          }
        };
        tr.innerHTML = renderCourtRowHTML(c);
        uploadedTbody.appendChild(tr);
      });
    }
  }

  // 2. Render Table 2: Pending Cases (ถัดลงมา)
  const pendingTbody = document.getElementById('courtPendingTableBody');
  if (pendingTbody) {
    pendingTbody.innerHTML = '';
    if (sortedPending.length === 0) {
      if (!isDesktop) {
        pendingTbody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">ไม่มีรายการคำร้องที่ยังไม่อัพโหลดไฟล์</td></tr>`;
      }
    } else {
      sortedPending.forEach(c => {
        const tr = document.createElement('tr');
        tr.onclick = (e) => {
          if (window.innerWidth <= 768 && !e.target.closest('button') && !e.target.closest('a')) {
            openMobileCaseActionModal(c.caseNumber);
          }
        };
        tr.innerHTML = renderCourtRowHTML(c);
        pendingTbody.appendChild(tr);
      });
    }
  }

  // Initialize DataTables for desktop & tablet landscape screens (>= 768px)
  if (isDesktop && typeof jQuery !== 'undefined' && typeof jQuery.fn.DataTable !== 'undefined') {
    const dtConfig = {
      pageLength: 25,
      lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, "ทั้งหมด"]],
      order: [], // Preserves our custom Station + CaseNumber natural ascending order
      language: {
        search: "ค้นหาในตาราง:",
        lengthMenu: "แสดง _MENU_ รายการต่อหน้า",
        info: "แสดง _START_ ถึง _END_ จากทั้งหมด _TOTAL_ รายการ",
        infoEmpty: "แสดง 0 ถึง 0 จาก 0 รายการ",
        infoFiltered: "(กรองจากทั้งหมด _MAX_ รายการ)",
        zeroRecords: "ไม่พบรายการคำร้องฝากขังตรงตามเงื่อนไขการค้นหา",
        emptyTable: "ไม่มีรายการข้อมูลคำร้องฝากขัง",
        paginate: {
          first: '<i class="fa-solid fa-angles-left"></i>',
          last: '<i class="fa-solid fa-angles-right"></i>',
          next: '<i class="fa-solid fa-angle-right"></i>',
          previous: '<i class="fa-solid fa-angle-left"></i>'
        }
      },
      dom: '<"top"l>rt<"bottom"ip><"clear">',
      responsive: true
    };

    const upTable = $('#courtUploadedRequestsDataTable');
    if (upTable.length) {
      upTable.DataTable(dtConfig);
    }

    const pendTable = $('#courtPendingRequestsDataTable');
    if (pendTable.length) {
      pendTable.DataTable(dtConfig);
    }
  }
}

/**
 * ฟังก์ชันบันทึกเสร็จสิ้นการฝากขัง (ปุ่มสีแดงในตารางศาล)
 */
function handleFinishCase(caseNumber) {
  if (!currentUser) return;

  Swal.fire({
    icon: 'warning',
    title: 'ยืนยันเสร็จสิ้นการฝากขัง?',
    html: `
      <div style="text-align: left; font-size: 0.95rem; line-height: 1.6; color: #334155;">
        <div>คุณต้องการบันทึกเสร็จสิ้นการฝากขังสำหรับเลขคดี <b style="color: #0f172a; font-size: 1.05rem;">${caseNumber}</b> ใช่หรือไม่?</div>
        <div style="margin-top: 0.75rem; background: #fef2f2; border: 1px solid #fecaca; padding: 0.75rem; border-radius: 0.5rem; color: #991b1b; font-size: 0.85rem; font-weight: 600;">
          <i class="fa-solid fa-triangle-exclamation"></i> <b>คำเตือน:</b> หากยืนยันแล้วจะส่งผลให้เลขฝากขังนี้ปิดสำนวนเสร็จสิ้น และพนักงานสอบสวนจะไม่สามารถดำเนินการต่อไปได้
        </div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: '<i class="fa-solid fa-lock"></i> ยืนยันเสร็จสิ้น',
    confirmButtonColor: '#dc2626',
    cancelButtonText: 'ยกเลิก',
    cancelButtonColor: '#64748b'
  }).then((result) => {
    if (result.isConfirmed) {
      const requests = getRequests();
      const target = requests.find(r => r.caseNumber === caseNumber);
      if (target) {
        const nowISO = new Date().toISOString();
        target.closed = true;
        target.closedDate = toISODate(new Date());
        target.closedAt = nowISO;
        
        target.history = target.history || [];
        target.history.push({
          type: 'closed',
          title: 'เสร็จสิ้นการฝากขัง',
          timestamp: nowISO,
          by: currentUser.username || 'ศาล'
        });

        saveRequests(requests);
        renderCourtView();

        const closedDateFormatted = formatThaiDate(nowISO) + ' เวลา ' + new Date(nowISO).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' น.';

        Swal.fire({
          icon: 'success',
          title: 'เสร็จสิ้นการฝากขังเรียบร้อย',
          html: `
            <div style="text-align: left; font-size: 0.9rem; line-height: 1.6;">
              <div>เลขคดี: <b style="font-size: 1rem; color: #0f172a;">${caseNumber}</b></div>
              <div>สถานะ: <b style="color: #dc2626;">เสร็จสิ้นการฝากขัง (ปิดสำนวน)</b></div>
              <div style="font-size: 0.85rem; color: #64748b; margin-top: 0.35rem;">บันทึกเมื่อ: ${closedDateFormatted}</div>
            </div>
          `,
          timer: 2500,
          showConfirmButton: false
        });
      }
    }
  });
}
window.handleFinishCase = handleFinishCase;

// --------------------------------------------------------------------------
// 10. DOWNLOAD HISTORY & FILE DOWNLOAD ENGINE
// --------------------------------------------------------------------------

const DOWNLOAD_HISTORY_STORAGE_KEY = 'eredt_download_history';

function getDownloadHistory() {
  try {
    const raw = localStorage.getItem(DOWNLOAD_HISTORY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}
window.getDownloadHistory = getDownloadHistory;

function saveDownloadHistory(history) {
  try {
    localStorage.setItem(DOWNLOAD_HISTORY_STORAGE_KEY, JSON.stringify(history));
  } catch (e) {
    console.error('Failed to save download history:', e);
  }
}
window.saveDownloadHistory = saveDownloadHistory;

function recordDownloadHistory(item) {
  const history = getDownloadHistory();
  const entry = {
    id: 'dl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
    ...item
  };
  history.unshift(entry);
  // Keep last 500 records
  if (history.length > 500) history.length = 500;
  saveDownloadHistory(history);
}
window.recordDownloadHistory = recordDownloadHistory;

function createMockPdfBlob(c) {
  const caseNum = c.caseNumber || 'case';
  const station = c.station || 'ศาลจังหวัดอุดรธานี';
  const officer = c.officer || '-';
  const cap = c.cap || 84;
  const k = c.k || 1;
  const filingDeadline = c.filingDeadline ? formatThaiDate(c.filingDeadline) : '-';

  const title = `e-REDT Court Document: ${caseNum}`;
  const pdfBody = `%PDF-1.4
1 0 obj
<< /Title (${title}) /Author (e-REDT Udon Thani Provincial Court) /Subject (Detention Remand Application) /Creator (e-REDT System v2.0) >>
endobj
2 0 obj
<< /Type /Catalog /Pages 3 0 R >>
endobj
3 0 obj
<< /Type /Pages /Kids [4 0 R] /Count 1 >>
endobj
4 0 obj
<< /Type /Page /Parent 3 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 6 0 R >> >> /Contents 5 0 R >>
endobj
5 0 obj
<< /Length 380 >>
stream
BT
/F1 18 Tf
50 780 Td
(Court of Justice - Udon Thani Provincial Court) Tj
/F1 14 Tf
0 -30 Td
(Detention Remand Application Document) Tj
/F1 11 Tf
0 -30 Td
(Case Number: ${caseNum}) Tj
0 -20 Td
(Police Station: ${station}) Tj
0 -20 Td
(Inquiry Officer: ${officer}) Tj
0 -20 Td
(Remand Period: Round ${k} / Max ${cap} Days) Tj
0 -20 Td
(Filing Deadline: ${filingDeadline}) Tj
0 -30 Td
(Digitally Verified & Downloaded by Court Official) Tj
ET
endstream
endobj
6 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 7
0000000000 65535 f 
0000000009 00000 n 
0000000155 00000 n 
0000000206 00000 n 
0000000267 00000 n 
0000000410 00000 n 
0000000842 00000 n 
trailer
<< /Size 7 /Root 2 0 R >>
startxref
910
%%EOF`;

  return new Blob([pdfBody], { type: 'application/pdf' });
}
window.createMockPdfBlob = createMockPdfBlob;

function triggerCaseFileDownload(c) {
  const safeCaseNum = (c.caseNumber || 'case').replace(/[\/\\]/g, '_');
  const filename = c.fileName || `${safeCaseNum}.pdf`;

  if (c.fileData) {
    const a = document.createElement('a');
    a.href = c.fileData;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } else if (c.fileUrl && !c.fileUrl.startsWith('blob:')) {
    const a = document.createElement('a');
    a.href = c.fileUrl;
    a.download = filename;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } else {
    const pdfBlob = createMockPdfBlob(c);
    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}
window.triggerCaseFileDownload = triggerCaseFileDownload;

function downloadCourtFile(caseNumber) {
  const requests = getRequests();
  const index = requests.findIndex(r => r.caseNumber === caseNumber);
  if (index !== -1) {
    const c = requests[index];
    const nowISO = new Date().toISOString();
    c.downloaded = true;
    c.downloadedAt = nowISO;
    c.downloadedBy = currentUser ? (currentUser.name || currentUser.username) : 'เจ้าหน้าที่ศาล';
    saveRequests(requests);

    // Record to Download History
    recordDownloadHistory({
      type: 'single',
      caseNumber: c.caseNumber,
      caseType: c.type || (c.caseNumber.startsWith('ยฝ.') ? 'ยฝ.' : 'ฝ.'),
      station: c.station || 'ไม่ระบุ',
      officer: c.officer || 'ไม่ระบุ',
      fileName: c.fileName || `${c.caseNumber}.pdf`,
      fileUrl: c.fileUrl || '',
      fileData: c.fileData || '',
      downloadedAt: nowISO,
      downloadedBy: currentUser ? (currentUser.name || currentUser.username) : 'เจ้าหน้าที่ศาล'
    });

    // Trigger actual download of the file to the user's computer
    triggerCaseFileDownload(c);

    // Show toast feedback
    if (typeof Swal !== 'undefined') {
      const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true
      });
      Toast.fire({
        icon: 'success',
        title: `ดาวน์โหลดไฟล์ ${c.fileName || c.caseNumber} ลงเครื่องเรียบร้อยแล้ว`
      });
    }

    renderCourtRequestsTable();
    if (typeof currentActiveView !== 'undefined' && currentActiveView === 'dashboard') {
      renderDashboard();
    }
  }
}
window.downloadCourtFile = downloadCourtFile;

async function downloadTodayAllDocuments() {
  const todayISO = toISO(new Date());
  const rawRequests = getRequests();
  const holidays = getHolidays();
  const enriched = rawRequests.map(r => enrichCase(r, holidays));

  const todayDocs = enriched.filter(c => 
    (c.filingDeadline === todayISO || (c.uploadedAt && c.uploadedAt.startsWith(todayISO))) &&
    c.fileName
  );

  if (todayDocs.length === 0) {
    Swal.fire({
      icon: 'info',
      title: 'ไม่มีเอกสารสำหรับดาวน์โหลด',
      text: `ไม่มีรายการคำร้องที่มีเอกสารแนบ ณ วันปัจจุบัน (${formatThaiDate(todayISO)})`,
      confirmButtonText: 'ตกลง',
      confirmButtonColor: '#1e3a8a'
    });
    return;
  }

  const nowISO = new Date().toISOString();
  const zipFileName = `คำร้องฝากขัง_ศาลจังหวัดอุดรธานี_${todayISO}.zip`;

  // Always Compress (ZIP DEFLATE) before downloading as requested
  Swal.fire({
    title: 'กำลังบีบอัดและดาวน์โหลดไฟล์ Zip...',
    html: `พบไฟล์เอกสารทั้งหมด <b>${todayDocs.length}</b> ไฟล์ กำลังดำเนินการบีบอัดไฟล์ (ZIP Deflate Compression)...`,
    allowOutsideClick: false,
    didOpen: () => { Swal.showLoading(); }
  });

  try {
    if (typeof JSZip !== 'undefined') {
      const zip = new JSZip();
      const folderName = `คำร้องฝากขัง_ประจำวันที่_${todayISO}`;
      const zipFolder = zip.folder(folderName);
      
      for (let i = 0; i < todayDocs.length; i++) {
        const item = todayDocs[i];
        const safeCaseNum = (item.caseNumber || 'case').replace(/[\/\\]/g, '_');
        const stationName = (item.station || 'สภ_ไม่ระบุ').replace(/[\/\\]/g, '_');
        const cleanFileName = item.fileName ? item.fileName.replace(/[\/\\]/g, '_') : `${safeCaseNum}.pdf`;
        const filename = `${safeCaseNum}_${stationName}_${cleanFileName}`;
        
        try {
          if (item.fileData) {
            // Base64 Data URL to binary in zip
            const base64Data = item.fileData.split(',')[1];
            if (base64Data) {
              zipFolder.file(filename.endsWith('.pdf') ? filename : filename + '.pdf', base64Data, { base64: true });
            } else {
              const blob = createMockPdfBlob(item);
              zipFolder.file(filename.endsWith('.pdf') ? filename : filename + '.pdf', blob);
            }
          } else if (item.fileUrl && !item.fileUrl.startsWith('blob:')) {
            const resp = await fetch(item.fileUrl);
            if (resp.ok) {
              const blob = await resp.blob();
              zipFolder.file(filename, blob);
            } else {
              const blob = createMockPdfBlob(item);
              zipFolder.file(filename.endsWith('.pdf') ? filename : filename + '.pdf', blob);
            }
          } else {
            const blob = createMockPdfBlob(item);
            zipFolder.file(filename.endsWith('.pdf') ? filename : filename + '.pdf', blob);
          }
        } catch (fetchErr) {
          const blob = createMockPdfBlob(item);
          zipFolder.file(filename.endsWith('.pdf') ? filename : filename + '.pdf', blob);
        }
      }

      // Mark all as downloaded with current timestamp
      todayDocs.forEach(td => {
        const idx = rawRequests.findIndex(r => r.caseNumber === td.caseNumber);
        if (idx !== -1) {
          rawRequests[idx].downloaded = true;
          rawRequests[idx].downloadedAt = nowISO;
          rawRequests[idx].downloadedBy = currentUser ? (currentUser.name || currentUser.username) : 'เจ้าหน้าที่ศาล';
        }
      });
      saveRequests(rawRequests);

      // Record to Download History as Batch ZIP
      recordDownloadHistory({
        type: 'batch',
        caseNumber: `รวม ${todayDocs.length} สำนวน`,
        caseType: 'ZIP รวม',
        station: 'ทุกสถานีตำรวจ (23 สภ.)',
        officer: '-',
        fileName: zipFileName,
        fileCount: todayDocs.length,
        downloadedAt: nowISO,
        downloadedBy: currentUser ? (currentUser.name || currentUser.username) : 'เจ้าหน้าที่ศาล'
      });

      // Generate compressed zip with DEFLATE level 6
      const zipBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });

      // Trigger Zip download to machine
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = zipFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      Swal.fire({
        icon: 'success',
        title: 'บีบอัดและดาวน์โหลดไฟล์ Zip สำเร็จ',
        html: `
          <div style="text-align: left; font-size: 0.925rem; color: #334155; line-height: 1.6;">
            <div>บีบอัดและดาวน์โหลดไฟล์ Zip ลงเครื่องเรียบร้อยแล้ว:</div>
            <div style="font-weight: 700; color: #059669; margin: 0.35rem 0;">📁 ${zipFileName}</div>
            <div style="font-size: 0.825rem; color: #64748b;">รวมเอกสารคำร้องทั้งสิ้น <b>${todayDocs.length}</b> สำนวนคดี</div>
          </div>
        `,
        confirmButtonText: 'ตกลง',
        confirmButtonColor: '#059669'
      });
    } else {
      // Fallback
      for (let i = 0; i < todayDocs.length; i++) {
        triggerCaseFileDownload(todayDocs[i]);
      }
      Swal.fire({
        icon: 'success',
        title: 'ดาวน์โหลดสำเร็จ',
        text: `ดาวน์โหลดเรียบร้อยแล้วจำนวน ${todayDocs.length} ไฟล์`
      });
    }
  } catch (err) {
    console.error('Download today docs error:', err);
    Swal.fire({
      icon: 'error',
      title: 'เกิดข้อผิดพลาดในการดาวน์โหลด',
      text: err.message || 'ไม่สามารถดาวน์โหลดไฟล์ได้'
    });
  }

  renderCourtRequestsTable();
}
window.downloadTodayAllDocuments = downloadTodayAllDocuments;

function renderDownloadHistoryTable() {
  if (!currentUser) return;

  const history = getDownloadHistory();
  const searchTerm = (document.getElementById('downloadHistorySearchInput')?.value || '').toLowerCase().trim();

  let filtered = history;
  if (searchTerm) {
    filtered = filtered.filter(item => 
      (item.caseNumber && item.caseNumber.toLowerCase().includes(searchTerm)) ||
      (item.station && item.station.toLowerCase().includes(searchTerm)) ||
      (item.fileName && item.fileName.toLowerCase().includes(searchTerm)) ||
      (item.downloadedBy && item.downloadedBy.toLowerCase().includes(searchTerm))
    );
  }

  const badgeEl = document.getElementById('downloadHistoryCountBadge');
  if (badgeEl) {
    badgeEl.textContent = `${filtered.length} รายการ`;
  }

  const isDesktop = (window.innerWidth >= 768);

  if (typeof jQuery !== 'undefined' && typeof jQuery.fn.DataTable !== 'undefined') {
    jQuery.fn.dataTable.ext.errMode = 'none';
    const dtEl = $('#downloadHistoryDataTable');
    if (dtEl.length && $.fn.DataTable.isDataTable(dtEl)) {
      dtEl.DataTable().destroy();
    }
  }

  const tbody = document.getElementById('downloadHistoryTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (filtered.length === 0) {
    if (!isDesktop) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 2rem;">ยังไม่มีประวัติการดาวน์โหลดไฟล์ในระบบ</td></tr>`;
    }
  } else {
    filtered.forEach((item, idx) => {
      const isBatch = (item.type === 'batch');
      const typeBadge = isBatch 
        ? '<span class="badge" style="background: #e0e7ff; color: #3730a3; border: 1px solid #c7d2fe; font-weight: 700;"><i class="fa-solid fa-file-zipper"></i> ZIP รวม</span>'
        : (item.caseType === 'ยฝ.' ? '<span class="badge badge-type-yf">ยฝ.</span>' : '<span class="badge badge-type-f">ฝ.</span>');

      let downloadDateStr = '-';
      if (item.downloadedAt) {
        const d = new Date(item.downloadedAt);
        downloadDateStr = `${formatThaiDate(item.downloadedAt)} ${d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} น.`;
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="text-align: center; font-weight: 600; color: #64748b;">${idx + 1}</td>
        <td><b style="color: #0369a1;">${downloadDateStr}</b></td>
        <td><i class="fa-solid fa-user-check" style="color: #059669;"></i> ${item.downloadedBy || 'เจ้าหน้าที่ศาล'}</td>
        <td>${typeBadge}</td>
        <td><b>${item.caseNumber || '-'}</b></td>
        <td>${item.station || '-'}</td>
        <td>
          <div style="font-family: monospace; font-size: 0.85rem; color: #334155; display: inline-flex; align-items: center; gap: 0.35rem;">
            <i class="${isBatch ? 'fa-solid fa-file-zipper' : 'fa-solid fa-file-pdf'}" style="color: ${isBatch ? '#6366f1' : '#dc2626'};"></i>
            ${item.fileName || 'document.pdf'}
          </div>
        </td>
        <td style="white-space: nowrap; width: 1%;">
          <button onclick="reDownloadFromHistory('${item.id}')" type="button" class="btn-primary" style="padding: 0.3rem 0.75rem; font-size: 0.8rem; width: auto; background-color: #0284c7; border-color: #0284c7; display: inline-flex; align-items: center; gap: 0.35rem;" title="ดาวน์โหลดไฟล์นี้ลงเครื่องอีกครั้ง">
            <i class="fa-solid fa-cloud-arrow-down"></i> ดาวน์โหลดซ้ำ
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  if (isDesktop && typeof jQuery !== 'undefined' && typeof jQuery.fn.DataTable !== 'undefined') {
    $('#downloadHistoryDataTable').DataTable({
      pageLength: 25,
      lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, "ทั้งหมด"]],
      order: [],
      language: {
        search: "ค้นหาในตาราง:",
        lengthMenu: "แสดง _MENU_ รายการต่อหน้า",
        info: "แสดง _START_ ถึง _END_ จากทั้งหมด _TOTAL_ รายการ",
        infoEmpty: "แสดง 0 ถึง 0 จาก 0 รายการ",
        infoFiltered: "(กรองจากทั้งหมด _MAX_ รายการ)",
        zeroRecords: "ไม่พบข้อมูลตรงตามเงื่อนไขการค้นหา",
        emptyTable: "ยังไม่มีประวัติการดาวน์โหลดไฟล์",
        paginate: {
          first: '<i class="fa-solid fa-angles-left"></i>',
          last: '<i class="fa-solid fa-angles-right"></i>',
          next: '<i class="fa-solid fa-angle-right"></i>',
          previous: '<i class="fa-solid fa-angle-left"></i>'
        }
      },
      dom: '<"top"l>rt<"bottom"ip><"clear">',
      responsive: true
    });
  }
}
window.renderDownloadHistoryTable = renderDownloadHistoryTable;

function reDownloadFromHistory(historyId) {
  const history = getDownloadHistory();
  const item = history.find(h => h.id === historyId);
  if (!item) {
    Swal.fire({ icon: 'error', title: 'ไม่พบประวัติ', text: 'ไม่พบรายการประวัติการดาวน์โหลดนี้' });
    return;
  }

  if (item.type === 'batch') {
    // Re-trigger today's batch download
    downloadTodayAllDocuments();
    return;
  }

  // Single Case Re-download
  const rawRequests = getRequests();
  const caseObj = rawRequests.find(r => r.caseNumber === item.caseNumber) || {
    caseNumber: item.caseNumber,
    station: item.station,
    officer: item.officer,
    fileName: item.fileName,
    fileUrl: item.fileUrl,
    fileData: item.fileData
  };

  triggerCaseFileDownload(caseObj);

  Swal.fire({
    icon: 'success',
    title: 'ดาวน์โหลดไฟล์ซ้ำสำเร็จ',
    html: `ดาวน์โหลดไฟล์ <b>${item.fileName || item.caseNumber}</b> ลงเครื่องเรียบร้อยแล้ว`,
    timer: 2000,
    showConfirmButton: false
  });
}
window.reDownloadFromHistory = reDownloadFromHistory;

function clearDownloadHistoryPrompt() {
  Swal.fire({
    title: 'ยืนยันล้างประวัติการดาวน์โหลด?',
    text: 'คุณต้องการล้างรายการประวัติการดาวน์โหลดทั้งหมดในเครื่องนี้ใช่หรือไม่?',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#ef4444',
    cancelButtonColor: '#64748b',
    confirmButtonText: 'ใช่, ล้างประวัติทั้งหมด',
    cancelButtonText: 'ยกเลิก'
  }).then((result) => {
    if (result.isConfirmed) {
      saveDownloadHistory([]);
      renderDownloadHistoryTable();
      Swal.fire({
        icon: 'success',
        title: 'ล้างประวัติสำเร็จ',
        text: 'ล้างรายการประวัติการดาวน์โหลดเรียบร้อยแล้ว',
        timer: 1500,
        showConfirmButton: false
      });
    }
  });
}
window.clearDownloadHistoryPrompt = clearDownloadHistoryPrompt;

function openEditCapModal(caseNumber) {
  const requests = getRequests();
  const c = requests.find(r => r.caseNumber === caseNumber);
  if (!c) return;

  const currentCap = c.cap || 84;
  const currentTimes = currentCap === 12 ? 1 : (currentCap === 48 ? 4 : 7);

  const optionsHtml = `
    <option value="12" ${currentCap === 12 ? 'selected' : ''}>12 วัน (ฝากขังครั้งเดียว - สูงสุด 1 ครั้ง ครั้งละ 12 วัน)</option>
    <option value="48" ${currentCap === 48 ? 'selected' : ''}>48 วัน (คดีทั่วไป - สูงสุด 4 ครั้ง ครั้งละ 12 วัน)</option>
    <option value="84" ${currentCap === 84 ? 'selected' : ''}>84 วัน (คดีอัตราโทษสูง - สูงสุด 7 ครั้ง ครั้งละ 12 วัน)</option>
  `;

  Swal.fire({
    title: `แก้ไขเพดานฝากขัง: ${c.caseNumber}`,
    html: `
      <div style="text-align: left; font-size: 0.9rem;">
        <p style="margin-bottom: 0.5rem;"><b>สถานะปัจจุบัน:</b> ครั้งที่ ${c.k} | เพดานปัจจุบัน: <b>${currentCap} วัน (${currentTimes} ครั้ง)</b></p>
        <p style="color: #0284c7; font-size: 0.8rem; margin-bottom: 0.75rem;"><i class="fa-solid fa-calculator"></i> เมื่อปรับเพดานฝากขัง ระบบจะคำนวณวันและกำหนดนัดใหม่ให้โดยอัตโนมัติ</p>
        <label style="font-weight: 600; display: block; margin-top: 0.5rem; margin-bottom: 0.25rem;">เลือกเพดานฝากขังใหม่ (ขั้นต่ำ 12 วัน):</label>
        <select id="swalEditCapSelect" class="form-control" style="width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 0.4rem;">
          ${optionsHtml}
        </select>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: 'บันทึกและคำนวณวันใหม่',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#1e3a8a',
    preConfirm: () => {
      const select = document.getElementById('swalEditCapSelect');
      return select ? select.value : null;
    }
  }).then((res) => {
    if (res.isConfirmed && res.value) {
      const newCap = parseInt(res.value, 10);
      const reqIndex = requests.findIndex(r => r.caseNumber === caseNumber);
      if (reqIndex !== -1) {
        const updateRes = updateCap(requests[reqIndex], newCap);
        if (updateRes.ok) {
          requests[reqIndex] = updateRes.case;
          saveRequests(requests);
          Swal.fire({
            icon: 'success',
            title: 'ปรับเพดานและคำนวณวันใหม่เรียบร้อย',
            html: `ปรับเพดานเป็น <b>${newCap} วัน</b> และคำนวณกำหนดวันนัดใหม่เรียบร้อยแล้ว`,
            timer: 1500,
            showConfirmButton: false
          });
          if (typeof currentActiveView !== 'undefined' && currentActiveView === 'dashboard') renderDashboard();
          else renderCourtView();
        } else {
          Swal.fire({ icon: 'error', title: 'แก้ไขไม่สำเร็จ', text: updateRes.reason });
        }
      }
    }
  });
}
window.openEditCapModal = openEditCapModal;

function openTransferModal(caseNumber) {
  const requests = getRequests();
  const c = requests.find(r => r.caseNumber === caseNumber);
  if (!c) return;

  const users = getUsers();
  const stationOfficers = users.filter(u => u.role === 'police' && u.station === c.station);

  if (stationOfficers.length === 0) {
    Swal.fire({
      icon: 'warning',
      title: 'ไม่พบบัญชีพนักงานสอบสวน',
      text: `สถานี ${c.station || 'ไม่ระบุ'} ยังไม่มีบัญชีพนักงานสอบสวนในระบบ กรุณาสร้างบัญชีก่อนโอนย้ายคดี`
    });
    return;
  }

  let optionsHtml = `<option value="">-- เลือกผู้รับโอนคดี --</option>`;
  stationOfficers.forEach(u => {
    const isCurrent = (u.username === c.officer);
    optionsHtml += `<option value="${u.username}" ${isCurrent ? 'disabled' : ''}>${u.name || u.username} (@${u.username}) ${isCurrent ? '(ผู้รับผิดชอบปัจจุบัน)' : ''}</option>`;
  });

  Swal.fire({
    title: `โอนย้ายคดี: ${c.caseNumber}`,
    html: `
      <div style="text-align: left; font-size: 0.9rem;">
        <p style="margin-bottom: 0.35rem;"><b>สถานี:</b> ${c.station || 'ไม่ระบุ'}</p>
        <p style="margin-bottom: 0.75rem;"><b>ผู้รับผิดชอบเดิม:</b> ${c.officer ? (users.find(u => u.username === c.officer)?.name || c.officer) : '<span style="color: #b45309;">ยังไม่มีเจ้าของคดี</span>'}</p>
        <label style="font-weight: 600; display: block; margin-bottom: 0.25rem;">เลือกพนักงานสอบสวนผู้รับโอนใหม่:</label>
        <select id="swalTransferSelect" class="form-control" style="width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 0.4rem;">
          ${optionsHtml}
        </select>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: 'ยืนยันโอนย้าย',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#1e3a8a',
    preConfirm: () => {
      const sel = document.getElementById('swalTransferSelect');
      if (!sel || !sel.value) {
        Swal.showValidationMessage('กรุณาเลือกพนักงานสอบสวนผู้รับโอน');
        return false;
      }
      return sel.value;
    }
  }).then((res) => {
    if (res.isConfirmed && res.value) {
      const newOfficer = res.value;
      const reqIndex = requests.findIndex(r => r.caseNumber === caseNumber);
      if (reqIndex !== -1) {
        requests[reqIndex].officer = newOfficer;
        saveRequests(requests);
        Swal.fire({
          icon: 'success',
          title: 'โอนย้ายคดีสำเร็จ',
          text: `โอนคดี ${caseNumber} ให้กับ ${newOfficer} เรียบร้อยแล้ว`,
          timer: 1500,
          showConfirmButton: false
        });
        if (typeof currentActiveView !== 'undefined' && currentActiveView === 'dashboard') renderDashboard();
        else renderCourtView();
      }
    }
  });
}
window.openTransferModal = openTransferModal;

function openCreateBatchModal(event) {
  if (event) event.preventDefault();

  const stationSelect = document.getElementById('batchStationSelect');
  stationSelect.innerHTML = `<option value="">-- เลือกสถานีตำรวจ (23 สภ.) --</option>`;
  UDON_STATIONS.forEach(st => {
    stationSelect.innerHTML += `<option value="${st}">${st}</option>`;
  });

  const curYear = new Date().getFullYear();
  const beYear = curYear < 2400 ? curYear + 543 : curYear;
  const yearInput = document.getElementById('batchYearInput');
  if (yearInput) yearInput.value = beYear;

  setThaiDatePickerValue('batchStartDateInput', new Date());
  openModal('createBatchModal');
}

/**
 * แยกส่วนประกอบของเลขฝากขัง (เช่น "ฝ.12/2569", "ยฝ.1/2569", "ฝ.12")
 */
function parseCaseComponents(caseStr) {
  if (!caseStr) return null;
  const cleaned = String(caseStr).trim();
  const match = cleaned.match(/^([^\d]+)\s*(\d+)(?:\s*\/\s*(\d+))?$/);
  if (match) {
    let type = match[1].trim();
    if (type === 'ฝ' || type === 'ฝ.') type = 'ฝ.';
    else if (type === 'ยฝ' || type === 'ยฝ.') type = 'ยฝ.';
    
    const num = parseInt(match[2], 10);
    const year = match[3] ? match[3].trim() : '';
    return { type, num, year, raw: cleaned };
  }
  return { type: '', num: NaN, year: '', raw: cleaned };
}
window.parseCaseComponents = parseCaseComponents;

/**
 * ตรวจสอบความซ้ำซ้อนของเลขฝากขังก่อนนำเข้าข้อมูล:
 * 1. หากประเภท (ตัวอักษรนำหน้า) ไม่เหมือนกัน สามารถใช้เลขรันซ้ำกันได้ แต่ต้องตรวจสอบปี พ.ศ. หากปี พ.ศ. ไม่ตรงกันสามารถใช้ตัวเลขรันซ้ำกันได้
 * 2. หากประเภทเหมือนกัน ให้ดูที่ปี พ.ศ. หากปี พ.ศ. ไม่ตรงกันสามารถใช้เลขรันซ้ำกันได้
 * 3. หากประเภทเหมือนกัน + ปี พ.ศ. เดียวกัน + เลขที่เดียวกัน -> ถือว่า "ซ้ำ" ห้ามนำเข้าข้อมูล
 */
function checkCaseDuplicate(newType, newNum, newYear, existingCases) {
  let normType = newType;
  if (normType === 'ฝ' || normType === 'ฝ.') normType = 'ฝ.';
  else if (normType === 'ยฝ' || normType === 'ยฝ.') normType = 'ยฝ.';
  
  const normYear = String(newYear).trim();
  const targetCaseNo = `${normType}${newNum}/${normYear}`;

  for (const c of existingCases) {
    if (!c || !c.caseNumber) continue;
    
    const existingStr = String(c.caseNumber).trim();
    if (existingStr === targetCaseNo) {
      return { isDuplicate: true, duplicateCase: c, matchedCaseNo: targetCaseNo };
    }

    const parsed = parseCaseComponents(existingStr);
    if (parsed && parsed.num === newNum) {
      const typeMatches = (parsed.type === normType) || (c.type && (c.type === normType || `${c.type}.` === normType));
      const yearMatches = (!parsed.year || !normYear) ? true : (parsed.year === normYear);
      
      // ซ้ำเมื่อทั้งประเภทและปี พ.ศ. ตรงกัน
      if (typeMatches && yearMatches) {
        return { isDuplicate: true, duplicateCase: c, matchedCaseNo: existingStr };
      }
    }
  }

  return { isDuplicate: false };
}
window.checkCaseDuplicate = checkCaseDuplicate;

function handleCreateBatch(event) {
  event.preventDefault();
  const form = event.target;
  
  const typeEl = form.querySelector('[id="batchTypeSelect"]') || document.getElementById('batchTypeSelect');
  const yearEl = form.querySelector('[id="batchYearInput"]') || document.getElementById('batchYearInput');
  const startNumEl = form.querySelector('[id="batchStartNumInput"]') || document.getElementById('batchStartNumInput');
  const endNumEl = form.querySelector('[id="batchEndNumInput"]') || document.getElementById('batchEndNumInput');
  const startDateEl = form.querySelector('[id="batchStartDateInput"]') || document.getElementById('batchStartDateInput');
  const stationEl = form.querySelector('[id="batchStationSelect"]') || document.getElementById('batchStationSelect');
  const capEl = form.querySelector('[id="batchCapSelect"]') || document.getElementById('batchCapSelect');

  const type = typeEl ? typeEl.value : 'ฝ.';
  const year = yearEl ? yearEl.value.trim() : (new Date().getFullYear() + 543).toString();
  const startNum = parseInt(startNumEl ? startNumEl.value : '1', 10);
  const endNum = parseInt(endNumEl ? endNumEl.value : '1', 10);
  const startDateRaw = startDateEl ? startDateEl.value : '';
  const startDate = toISO(startDateRaw);
  const station = (stationEl ? stationEl.value : '').trim();
  const capVal = parseInt(capEl ? capEl.value : '84', 10);

  if (isNaN(startNum) || isNaN(endNum) || startNum <= 0 || endNum <= 0) {
    Swal.fire({ icon: 'error', title: 'ข้อมูลไม่ถูกต้อง', text: 'กรุณากรอกเลขเริ่มต้นและเลขสิ้นสุดเป็นตัวเลขจำนวนเต็มบวก' });
    return;
  }

  if (startNum > endNum) {
    Swal.fire({ icon: 'error', title: 'ข้อมูลไม่ถูกต้อง', text: 'เลขเริ่มต้นต้องไม่มากกว่าเลขสิ้นสุด' });
    return;
  }

  if (!year) {
    Swal.fire({ icon: 'error', title: 'ข้อมูลไม่ครบถ้วน', text: 'กรุณาระบุปี พ.ศ.' });
    return;
  }

  const requests = getRequests();
  const duplicates = [];

  // ตรวจสอบความซ้ำซ้อนของเลขฝากขังก่อนนำเข้าข้อมูลทุกคดี
  for (let i = startNum; i <= endNum; i++) {
    const dupCheck = checkCaseDuplicate(type, i, year, requests);
    if (dupCheck.isDuplicate) {
      duplicates.push(dupCheck.matchedCaseNo || `${type}${i}/${year}`);
    }
  }

  if (duplicates.length > 0) {
    const previewDups = duplicates.slice(0, 8).join(', ') + (duplicates.length > 8 ? ` และอีก ${duplicates.length - 8} รายการ` : '');
    Swal.fire({
      icon: 'error',
      title: 'พบเลขฝากขังซ้ำซ้อนในระบบ',
      html: `
        <div style="text-align: left; font-size: 0.9rem; line-height: 1.6; color: #334155;">
          <p><b>ระบบไม่อนุญาตให้นำเข้าข้อมูลเนื่องจากตรวจพบเลขฝากขังซ้ำ:</b></p>
          <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 0.5rem; padding: 0.75rem; color: #991b1b; font-weight: 600; margin: 0.5rem 0;">
            ${previewDups}
          </div>
          <p style="font-size: 0.8rem; color: #64748b; margin-top: 0.5rem;">
            * กฎการตรวจสอบ: หากประเภทและปี พ.ศ. ตรงกัน จะไม่สามารถใช้เลขที่ซ้ำกันได้ (ยกเว้นคนละประเภท หรือคนละปี พ.ศ.)
          </p>
        </div>
      `,
      confirmButtonText: 'ตกลง'
    });
    return;
  }

  // Create batch cases
  const newCases = [];
  for (let i = startNum; i <= endNum; i++) {
    const caseNo = `${type}${i}/${year}`;
    newCases.push({
      caseNumber: caseNo,
      type: type,
      startDate: startDate,
      k: 2, // Starts from 2nd remand tracking
      cap: capVal, // Selected cap (12, 48, 84 days)
      cumulativeDays: 12, // First remand used 12 days
      station: station || null,
      officer: null,
      fileName: null,
      downloaded: false,
      closed: false,
      history: [],
      createdAt: new Date().toISOString()
    });
  }

  saveRequests([...requests, ...newCases]);
  closeModal('createBatchModal');

  Swal.fire({
    icon: 'success',
    title: 'สร้างชุดเลขคำร้องสำเร็จ',
    text: `สร้างชุดเลข ${type}${startNum} ถึง ${type}${endNum}/${year} รวม ${newCases.length} คดี เรียบร้อยแล้ว` + (station ? ` และส่งเข้ากล่องจดหมาย ${station}` : '')
  });

  if (currentActiveView === 'dashboard') renderDashboard();
  else renderCourtView();
}

function openReceiveModal(caseNumber) {
  const requests = getRequests();
  const c = requests.find(r => r.caseNumber === caseNumber);
  if (!c) return;

  setElementValue('receiveCaseNumber', c.caseNumber);
  setElementText('receiveCaseNumberDisplay', `เลขคดี: ${c.caseNumber}`);
  setElementText('receiveCaseInfoDisplay', `ครั้งที่ ${c.k} | สภ.: ${c.station || 'ไม่ระบุ'}`);

  // กำหนดตัวเลือกเพดานฝากขัง (ขั้นต่ำ 12 วัน)
  const capSelect = document.getElementById('receiveCapSelect');
  if (capSelect) {
    capSelect.innerHTML = `
      <option value="12">12 วัน (ฝากขังครั้งเดียว - สูงสุด 1 ครั้ง ครั้งละ 12 วัน)</option>
      <option value="48">48 วัน (คดีทั่วไป - ฝากขังได้สูงสุด 4 ครั้ง ครั้งละ 12 วัน)</option>
      <option value="84">84 วัน (คดีอัตราโทษสูง - ฝากขังได้สูงสุด 7 ครั้ง ครั้งละ 12 วัน)</option>
    `;
  }

  setElementValue('receiveCapSelect', c.cap || 84);
  setElementValue('receiveActualDaysInput', 12);

  openModal('receiveOccasionModal');
}

function handleConfirmReceiveOccasion(event) {
  event.preventDefault();
  const caseNumber = document.getElementById('receiveCaseNumber').value;
  const newCap = parseInt(document.getElementById('receiveCapSelect').value, 10);
  const actualDays = parseInt(document.getElementById('receiveActualDaysInput').value, 10);

  const requests = getRequests();
  const holidays = getHolidays();
  const index = requests.findIndex(r => r.caseNumber === caseNumber);

  if (index !== -1) {
    const updated = receiveOccasion(requests[index], holidays, newCap, actualDays);
    requests[index] = updated;
    saveRequests(requests);

    closeModal('receiveOccasionModal');
    Swal.fire({ icon: 'success', title: 'ยืนยันรับเรื่องเรียบร้อย', timer: 1500, showConfirmButton: false });
    renderCourtView();
  }
}

function openFlagModal(caseNumber) {
  setElementValue('flagCaseNumber', caseNumber);
  setElementValue('flagReasonInput', '');
  
  const requests = getRequests();
  const c = requests.find(r => r.caseNumber === caseNumber);
  const infoEl = document.getElementById('flagCaseInfoDisplay');
  if (infoEl) {
    if (c) {
      infoEl.innerHTML = `
        <div style="font-weight: 700; font-size: 0.95rem; margin-bottom: 0.25rem;">
          <i class="fa-solid fa-file-signature" style="color: #d97706;"></i> เลขฝากขัง: <b>${c.caseNumber}</b> (ครั้งที่ ${c.k || 1})
        </div>
        <div style="font-size: 0.8rem; color: #78350f;">
          สถานีตำรวจ: <b>${c.station || 'ยังไม่ระบุ'}</b> | พนักงานสอบสวน: <b>${c.officer || 'ยังไม่มีผู้รับ'}</b>
        </div>
        ${c.fileName ? `<div style="font-size: 0.8rem; color: #dc2626; margin-top: 0.25rem;"><i class="fa-solid fa-file-pdf"></i> ไฟล์ปัจจุบัน: ${c.fileName}</div>` : ''}
      `;
    } else {
      infoEl.textContent = `เลขคดี: ${caseNumber}`;
    }
  }

  openModal('flagWrongFileModal');
}

function handleConfirmFlagWrongFile(event) {
  event.preventDefault();
  const caseNumber = document.getElementById('flagCaseNumber')?.value || '';
  const reason = document.getElementById('flagReasonInput')?.value?.trim() || '';

  if (!reason) {
    Swal.fire({
      icon: 'warning',
      title: 'กรุณาระบุเหตุผลการส่งคืนคำร้อง',
      text: 'โปรดระบุสาเหตุ เช่น เอกสารไม่ถูกต้อง, ไฟล์เลือนราง หรือลายเซ็นไม่ครบถ้วน เพื่อให้พนักงานสอบสวนแก้ไขได้ถูกต้อง'
    });
    return;
  }

  const requests = getRequests();
  const index = requests.findIndex(r => r.caseNumber === caseNumber);

  if (index === -1) {
    Swal.fire({ icon: 'error', title: 'ไม่พบข้อมูลคดีนี้ในระบบ' });
    return;
  }

  const targetCase = requests[index];

  // User requirement confirmation prompt:
  // "และต้องมีการเตือนหลังจากกดว่า หากยืนยันจะเป็นการส่งแจ้งกลับไปยัง พนักงานสอบสวนที่ทำสำนวนฝากขังเลข(ตามด้วยเลขฝากขังที่กดส่ง) ท่านต้องการยืนยันหรือไม่"
  Swal.fire({
    title: 'ยืนยันการส่งคืนคำร้อง?',
    html: `หากยืนยันจะเป็นการส่งแจ้งกลับไปยัง <b>พนักงานสอบสวนที่ทำสำนวนฝากขังเลข ${caseNumber}</b><br><br>ท่านต้องการยืนยันหรือไม่?`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#d97706',
    cancelButtonColor: '#64748b',
    confirmButtonText: '<i class="fa-solid fa-rotate-left"></i> ยืนยันส่งคืนคำร้อง',
    cancelButtonText: 'ยกเลิก'
  }).then((result) => {
    if (result.isConfirmed) {
      const res = flagWrongFile(targetCase, reason);
      if (res.ok) {
        requests[index] = res.case;
        saveRequests(requests);

        // Broadcast realtime notification specifically for this case return
        broadcastRealtimeUpdate('CASE_RETURNED', {
          caseNumber: targetCase.caseNumber,
          reason: reason,
          officer: targetCase.officer || '',
          station: targetCase.station || '',
          k: targetCase.k || 1
        });

        closeModal('flagWrongFileModal');
        Swal.fire({ 
          icon: 'success', 
          title: 'ส่งคืนคำร้องเรียบร้อยแล้ว', 
          html: `ระบบได้ส่งแจ้งเตือนส่งคืนคำร้องเลขฝากขัง <b>${caseNumber}</b> ไปยังพนักงานสอบสวนเจ้าของสำนวนเรียบร้อยแล้ว`,
          timer: 2500, 
          showConfirmButton: false 
        });
        renderCourtView();
      } else {
        Swal.fire({ icon: 'error', title: 'ส่งคืนคำร้องไม่สำเร็จ', text: res.reason });
      }
    }
  });
}

// --------------------------------------------------------------------------
// 10. ADMIN CONTROL PANEL & HOLIDAY MANAGER
// --------------------------------------------------------------------------

function copyToClipboard(text, label = 'ข้อความ') {
  if (!text) return;
  
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => {
      showRealtimeToast(`📋 คัดลอก ${label} เรียบร้อยแล้ว`);
    }).catch(() => {
      fallbackCopyText(text, label);
    });
  } else {
    fallbackCopyText(text, label);
  }
}
window.copyToClipboard = copyToClipboard;

function fallbackCopyText(text, label) {
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    showRealtimeToast(`📋 คัดลอก ${label} เรียบร้อยแล้ว`);
  } catch (err) {
    console.error('Fallback copy failed', err);
    Swal.fire({
      icon: 'info',
      title: `คัดลอก ${label}`,
      html: `<input type="text" value="${text}" class="form-control" readonly onclick="this.select()">`
    });
  }
}

function copyUserCredentials(username, password, name = '', station = '') {
  const loginUrl = window.location.origin + window.location.pathname.replace(/\/court\/?|\/police\/?/g, '');
  const text = `ระบบ e-REDT Online (ศาลจังหวัดอุดรธานี)\n-----------------------------\nชื่อ-นามสกุล: ${name || '-'}\nสังกัด: ${station || '-'}\nUsername: ${username}\nPassword: ${password || '-'}\n-----------------------------\nลิงก์เข้าใช้งาน: ${loginUrl}`;
  
  copyToClipboard(text, `ข้อมูลบัญชี ${username}`);
}
window.copyUserCredentials = copyUserCredentials;

function renderAdminView() {
  if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'officer')) return;
  
  // Populate Station Print Dropdown if not yet loaded
  const printSelect = document.getElementById('printPoliceStationSelect');
  if (printSelect && printSelect.options.length <= 1) {
    printSelect.innerHTML = `<option value="all">-- ทุกสถานีตำรวจ (23 สภ.) --</option>`;
    UDON_STATIONS.forEach(st => {
      printSelect.innerHTML += `<option value="${st}">${st}</option>`;
    });
  }

  const users = getUsers();
  const tbody = document.getElementById('adminUserTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  users.forEach(u => {
    const roleBadges = {
      admin: '<span class="badge badge-status-blocked">Admin</span>',
      officer: '<span class="badge badge-status-uploaded">เจ้าหน้าที่ศาล</span>',
      police: '<span class="badge badge-status-due">ตำรวจ</span>'
    };

    const tr = document.createElement('tr');
    tr.onclick = (e) => {
      if (window.innerWidth <= 768 && !e.target.closest('button')) {
        openMobileUserActionModal(u.username);
      }
    };
    tr.innerHTML = `
      <td style="white-space: nowrap;">
        <div style="display: inline-flex; align-items: center; gap: 0.35rem;">
          <b style="font-family: monospace; font-size: 0.9rem;">${u.username}</b>
          <button onclick="copyToClipboard('${u.username}', 'Username: ${u.username}')" type="button" class="btn-icon-copy" title="คัดลอก Username: ${u.username}">
            <i class="fa-regular fa-copy"></i>
          </button>
        </div>
      </td>
      <td style="white-space: nowrap;">
        <div style="display: inline-flex; align-items: center; gap: 0.35rem;">
          <code style="background: #f8fafc; border: 1.5px solid #cbd5e1; padding: 0.2rem 0.45rem; border-radius: 0.35rem; font-family: monospace; font-size: 0.85rem; color: #0f172a; font-weight: 700;">${u.password || '-'}</code>
          ${u.password ? `
            <button onclick="copyToClipboard('${u.password}', 'Password: ${u.password}')" type="button" class="btn-icon-copy" title="คัดลอก Password">
              <i class="fa-regular fa-copy"></i>
            </button>
          ` : ''}
        </div>
      </td>
      <td>${u.name || '-'}</td>
      <td>${roleBadges[u.role] || u.role}</td>
      <td>${u.station || '-'}</td>
      <td><span class="badge badge-status-downloaded">อนุมัติแล้ว</span></td>
      <td style="white-space: nowrap;">
        <button onclick="copyUserCredentials('${u.username}', '${(u.password || '').replace(/'/g, "\\'")}', '${(u.name || '').replace(/'/g, "\\'")}', '${(u.station || '').replace(/'/g, "\\'")}')" class="btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; background-color: #0284c7; border-color: #0284c7; color: #ffffff !important;" title="คัดลอกข้อมูลบัญชี (Username + Password) ส่งให้ผู้ใช้">
          <i class="fa-regular fa-copy"></i> คัดลอก
        </button>
        <button onclick="editUser('${u.username}')" class="btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;"><i class="fa-solid fa-pen-to-square"></i> แก้ไข</button>
        ${u.username !== 'admin' ? `<button onclick="deleteUser('${u.username}')" class="btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; background-color: #dc2626; color: #fff;"><i class="fa-solid fa-trash"></i> ลบ</button>` : ''}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * ฟังก์ชันพิมพ์เอกสารบัญชีรายชื่อและรหัสผ่านพนักงานสอบสวน (เลือกแยก สภ. หรือทั้งหมดได้)
 */
function printPoliceUsersReport() {
  const selectedStation = document.getElementById('printPoliceStationSelect')?.value || 'all';
  const users = getUsers();
  
  let policeUsers = users.filter(u => u.role === 'police');
  if (selectedStation !== 'all') {
    policeUsers = policeUsers.filter(u => u.station === selectedStation);
  }

  // เรียงลำดับตาม สภ. แล้วตาม Username
  policeUsers.sort((a, b) => {
    const stComp = (a.station || '').localeCompare(b.station || '');
    if (stComp !== 0) return stComp;
    return (a.username || '').localeCompare(b.username || '', undefined, { numeric: true });
  });

  if (policeUsers.length === 0) {
    Swal.fire({
      icon: 'info',
      title: 'ไม่พบข้อมูลผู้ใช้งานพนักงานสอบสวน',
      text: selectedStation === 'all' 
        ? 'ยังไม่มีบัญชีผู้ใช้งานพนักงานสอบสวนในระบบ' 
        : `ยังไม่มีบัญชีผู้ใช้งานพนักงานสอบสวนของ ${selectedStation}`
    });
    return;
  }

  const stationTitle = selectedStation === 'all' ? 'ทุกสถานีตำรวจในสังกัด ภ.จว.อุดรธานี (23 สภ.)' : selectedStation;
  const printDateStr = formatThaiDate(toISO(new Date()), true) + ' เวลา ' + new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' น.';

  let rowsHtml = '';
  policeUsers.forEach((u, index) => {
    rowsHtml += `
      <tr>
        <td style="text-align: center; border: 1px solid #334155; padding: 6px 8px;">${index + 1}</td>
        <td style="border: 1px solid #334155; padding: 6px 8px;">${u.station || '-'}</td>
        <td style="border: 1px solid #334155; padding: 6px 8px;">${u.name || '-'}</td>
        <td style="border: 1px solid #334155; padding: 6px 8px; font-weight: bold; font-family: monospace; font-size: 14px;">${u.username}</td>
        <td style="border: 1px solid #334155; padding: 6px 8px; font-weight: bold; font-family: monospace; font-size: 14px;">${u.password || '-'}</td>
        <td style="text-align: center; border: 1px solid #334155; padding: 6px 8px;">อนุมัติแล้ว</td>
        <td style="border: 1px solid #334155; padding: 6px 8px; width: 130px;"></td>
      </tr>
    `;
  });

  const printWindow = window.open('', '_blank', 'width=980,height=850');
  if (!printWindow) {
    Swal.fire({
      icon: 'warning',
      title: 'เบราว์เซอร์บล็อกหน้าต่างใหม่ (Pop-up Blocked)',
      text: 'กรุณาอนุญาตให้เปิดหน้าต่าง Pop-up เพื่อพิมพ์เอกสาร'
    });
    return;
  }

  const printHtml = `
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <title>บัญชีรายชื่อผู้ใช้งานพนักงานสอบสวน - ศาลจังหวัดอุดรธานี</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
        body {
          font-family: 'Sarabun', 'TH Sarabun New', sans-serif;
          font-size: 13pt;
          line-height: 1.4;
          color: #0f172a;
          margin: 15mm 15mm;
          background: #fff;
        }
        .header-title {
          text-align: center;
          margin-bottom: 20px;
        }
        .header-title h2 {
          margin: 0 0 4px 0;
          font-size: 18pt;
          font-weight: 700;
        }
        .header-title h3 {
          margin: 0 0 4px 0;
          font-size: 15pt;
          font-weight: 600;
        }
        .header-title p {
          margin: 0;
          font-size: 12pt;
          color: #334155;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 15px;
          margin-bottom: 25px;
        }
        th {
          border: 1px solid #334155;
          background-color: #f1f5f9;
          padding: 8px 6px;
          font-weight: 700;
          text-align: center;
          font-size: 12.5pt;
        }
        td {
          font-size: 12pt;
        }
        .footer-sign {
          margin-top: 40px;
          display: flex;
          justify-content: space-between;
          page-break-inside: avoid;
        }
        .sign-box {
          text-align: center;
          width: 45%;
        }
        .sign-line {
          margin-top: 50px;
          border-bottom: 1px dotted #334155;
          margin-bottom: 6px;
        }
        .no-print-bar {
          background: #0f172a;
          color: #fff;
          padding: 12px 24px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 9999;
          font-family: 'Sarabun', sans-serif;
          box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        }
        @media print {
          .no-print-bar { display: none !important; }
          body { margin: 10mm; }
          @page { size: A4 portrait; margin: 10mm; }
        }
      </style>
    </head>
    <body>
      <div class="no-print-bar">
        <span><b>พิมพ์เอกสาร:</b> บัญชีรายชื่อผู้ใช้งานพนักงานสอบสวน (${policeUsers.length} รายการ)</span>
        <div>
          <button onclick="window.print()" style="background: #059669; color: #fff; border: none; padding: 8px 20px; font-size: 14px; font-weight: bold; border-radius: 6px; cursor: pointer; margin-right: 8px;">🖨️ สั่งพิมพ์ (Print)</button>
          <button onclick="window.close()" style="background: #475569; color: #fff; border: none; padding: 8px 14px; font-size: 14px; border-radius: 6px; cursor: pointer;">ปิด</button>
        </div>
      </div>

      <div style="margin-top: 45px;">
        <div class="header-title">
          <h2>ศาลจังหวัดอุดรธานี</h2>
          <h3>บัญชีรายชื่อและรหัสผ่านผู้ใช้งานระบบผัดฟ้องฝากขังออนไลน์ (e-REDT)</h3>
          <p><b>สังกัด:</b> ${stationTitle} | <b>จำนวนทั้งหมด:</b> ${policeUsers.length} บัญชี</p>
          <p style="font-size: 10.5pt; color: #64748b;">ออกเอกสาร ณ วันที่: ${printDateStr}</p>
        </div>

        <table>
          <thead>
            <tr>
              <th style="width: 40px;">ลำดับ</th>
              <th style="width: 140px;">สถานีตำรวจ (สภ.)</th>
              <th>ชื่อ - นามสกุล</th>
              <th style="width: 120px;">ชื่อผู้ใช้งาน<br>(Username)</th>
              <th style="width: 110px;">รหัสผ่าน<br>(Password)</th>
              <th style="width: 75px;">สถานะ</th>
              <th style="width: 130px;">ลายมือชื่อผู้รับมอบ</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>

        <div class="footer-sign">
          <div class="sign-box">
            <div class="sign-line"></div>
            <div>(.......................................................................)</div>
            <div style="margin-top: 4px; font-weight: 500;">เจ้าหน้าที่ผู้ส่งมอบข้อมูล (ศาลจังหวัดอุดรธานี)</div>
            <div style="margin-top: 4px;">วันที่ .......... / .......... / ..........</div>
          </div>
          <div class="sign-box">
            <div class="sign-line"></div>
            <div>(.......................................................................)</div>
            <div style="margin-top: 4px; font-weight: 500;">พนักงานสอบสวนผู้รับมอบบัญชี</div>
            <div style="margin-top: 4px;">วันที่ .......... / .......... / ..........</div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  printWindow.document.open();
  printWindow.document.write(printHtml);
  printWindow.document.close();
}
window.printPoliceUsersReport = printPoliceUsersReport;

/**
 * ฟังก์ชันดาวน์โหลดบัญชีรายชื่อพนักงานสอบสวนเป็นไฟล์ Excel (.csv รองรับภาษาไทย 100%)
 */
function exportPoliceUsersExcel() {
  const selectedStation = document.getElementById('printPoliceStationSelect')?.value || 'all';
  const users = getUsers();
  
  let policeUsers = users.filter(u => u.role === 'police');
  if (selectedStation !== 'all') {
    policeUsers = policeUsers.filter(u => u.station === selectedStation);
  }

  // เรียงลำดับตาม สภ. แล้วตาม Username
  policeUsers.sort((a, b) => {
    const stComp = (a.station || '').localeCompare(b.station || '');
    if (stComp !== 0) return stComp;
    return (a.username || '').localeCompare(b.username || '', undefined, { numeric: true });
  });

  if (policeUsers.length === 0) {
    Swal.fire({
      icon: 'info',
      title: 'ไม่พบข้อมูลผู้ใช้งานพนักงานสอบสวน',
      text: selectedStation === 'all' 
        ? 'ยังไม่มีบัญชีผู้ใช้งานพนักงานสอบสวนในระบบ' 
        : `ยังไม่มีบัญชีผู้ใช้งานพนักงานสอบสวนของ ${selectedStation}`
    });
    return;
  }

  // Header row
  const headers = ['ลำดับ', 'สถานีตำรวจ (สภ.)', 'ชื่อ-นามสกุล', 'ชื่อผู้ใช้งาน (Username)', 'รหัสผ่าน (Password)', 'สิทธิ', 'สถานะ'];
  const rows = [headers];

  policeUsers.forEach((u, index) => {
    rows.push([
      index + 1,
      `"${(u.station || '').replace(/"/g, '""')}"`,
      `"${(u.name || '').replace(/"/g, '""')}"`,
      `"${(u.username || '').replace(/"/g, '""')}"`,
      `"${(u.password || '').replace(/"/g, '""')}"`,
      '"พนักงานสอบสวน"',
      '"อนุมัติแล้ว"'
    ]);
  });

  // UTF-8 BOM (\uFEFF) for Excel compatibility with Thai characters
  const csvContent = '\uFEFF' + rows.map(r => r.join(',')).join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const cleanStationName = selectedStation === 'all' ? 'ทุกสภ' : selectedStation.replace(/[^a-zA-Z0-9ก-๙]/g, '_');
  const fileName = `รายชื่อผู้ใช้งานพนักงานสอบสวน_${cleanStationName}_${toISO(new Date())}.csv`;
  
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  Swal.fire({
    icon: 'success',
    title: 'ดาวน์โหลดไฟล์ Excel สำเร็จ',
    text: `ดาวน์โหลดไฟล์ ${fileName} เรียบร้อยแล้ว (${policeUsers.length} บัญชี)`,
    timer: 2000,
    showConfirmButton: false
  });
}
window.exportPoliceUsersExcel = exportPoliceUsersExcel;

// --------------------------------------------------------------------------
// 10. COURT HOLIDAYS MANAGEMENT (PAGE & TABLE)
// --------------------------------------------------------------------------

function renderHolidaysPage() {
  if (!currentUser) return;
  
  const holidays = getHolidays();
  const todayISO = toISO(new Date());

  // Attach Flatpickr Thai Datepicker
  const dateInput = document.getElementById('pageHolidayDateInput');
  if (dateInput) {
    if (!dateInput._flatpickr) {
      dateInput.value = toISO(new Date());
      attachThaiDatePicker(dateInput);
    }
  }

  // Update Summary Stats
  const totalCountEl = document.getElementById('holidayCountTotal');
  if (totalCountEl) totalCountEl.textContent = holidays.length;

  const upcomingHolidays = holidays.filter(h => h.date >= todayISO);
  const upcomingCountEl = document.getElementById('holidayCountUpcoming');
  if (upcomingCountEl) upcomingCountEl.textContent = upcomingHolidays.length;

  const tableCountBadge = document.getElementById('holidayTableCountBadge');
  if (tableCountBadge) tableCountBadge.textContent = holidays.length;

  renderHolidayTableFromPage();
}
window.renderHolidaysPage = renderHolidaysPage;

function renderHolidayTableFromPage() {
  const holidays = getHolidays();
  const tbody = document.getElementById('pageHolidayTableBody');
  if (!tbody) return;

  const monthFilter = document.getElementById('holidayMonthFilter')?.value || 'all';
  const searchTerm = (document.getElementById('holidaySearchInput')?.value || '').toLowerCase().trim();
  const todayISO = toISO(new Date());

  let filtered = [...holidays];

  if (monthFilter !== 'all') {
    const mNum = parseInt(monthFilter, 10);
    filtered = filtered.filter(h => {
      const parts = h.date.split('-');
      if (parts.length >= 2) {
        return (parseInt(parts[1], 10) - 1) === mNum;
      }
      return false;
    });
  }

  if (searchTerm) {
    filtered = filtered.filter(h => 
      (h.name && h.name.toLowerCase().includes(searchTerm)) ||
      (h.date && h.date.includes(searchTerm)) ||
      formatThaiDate(h.date, true).toLowerCase().includes(searchTerm)
    );
  }

  // Sort by date asc
  filtered.sort((a, b) => a.date.localeCompare(b.date));

  tbody.innerHTML = '';

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 2rem;">ไม่พบรายการวันหยุดราชการตามเงื่อนไขที่ค้นหา</td></tr>`;
    return;
  }

  filtered.forEach((h, index) => {
    const originalIndex = holidays.findIndex(item => item.date === h.date && item.name === h.name);
    const isPast = h.date < todayISO;
    const isToday = h.date === todayISO;

    let statusBadge = '';
    if (isToday) {
      statusBadge = '<span class="badge badge-status-due"><i class="fa-solid fa-bell"></i> วันนี้</span>';
    } else if (isPast) {
      statusBadge = '<span class="badge" style="background:#f1f5f9; color:#64748b; border:1px solid #cbd5e1;"><i class="fa-solid fa-clock-rotate-left"></i> ผ่านมาแล้ว</span>';
    } else {
      statusBadge = '<span class="badge badge-status-uploaded"><i class="fa-solid fa-calendar-check"></i> กำลังจะมาถึง</span>';
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="text-align: center; font-weight: 600; color: var(--text-muted);">${index + 1}</td>
      <td>
        <div style="font-weight: 700; color: #1e3a8a;">
          <i class="fa-solid fa-calendar-day" style="color: #ef4444; margin-right: 0.35rem;"></i> ${formatThaiDate(h.date, true)}
        </div>
        <div style="font-size: 0.75rem; color: #64748b; font-family: monospace;">(${h.date})</div>
      </td>
      <td>
        <div style="font-weight: 600; color: var(--text-main); font-size: 0.95rem;">${h.name}</div>
      </td>
      <td style="text-align: center;">${statusBadge}</td>
      <td style="text-align: center;">
        <div style="display: inline-flex; gap: 0.35rem; align-items: center; justify-content: center;">
          <button onclick="editHoliday(${originalIndex >= 0 ? originalIndex : index})" type="button" class="btn-secondary" style="padding: 0.3rem 0.65rem; font-size: 0.775rem; background-color: #2563eb; color: #fff; border: none; border-radius: 0.35rem; cursor: pointer; display: inline-flex; align-items: center; gap: 0.25rem;">
            <i class="fa-solid fa-pen-to-square"></i> แก้ไข
          </button>
          <button onclick="deleteHoliday(${originalIndex >= 0 ? originalIndex : index})" type="button" class="btn-secondary" style="padding: 0.3rem 0.65rem; font-size: 0.775rem; background-color: #dc2626; color: #fff; border: none; border-radius: 0.35rem; cursor: pointer; display: inline-flex; align-items: center; gap: 0.25rem;">
            <i class="fa-solid fa-trash"></i> ลบ
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}
window.renderHolidayTableFromPage = renderHolidayTableFromPage;

function handleAddHolidayFromPage(event) {
  event.preventDefault();
  const dateRaw = document.getElementById('pageHolidayDateInput')?.value || '';
  const date = toISO(dateRaw);
  const name = (document.getElementById('pageHolidayNameInput')?.value || '').trim();

  if (!date || date.includes('NaN')) {
    Swal.fire({ icon: 'warning', title: 'กรุณาระบุวันที่', text: 'เลือกวันที่หยุดราชการให้ถูกต้อง' });
    return;
  }
  if (!name) {
    Swal.fire({ icon: 'warning', title: 'กรุณากรอกชื่อวันหยุด', text: 'กรอกชื่อวันหยุดราชการ' });
    return;
  }

  const holidays = getHolidays();
  if (holidays.some(h => h.date === date)) {
    Swal.fire({ icon: 'error', title: 'วันหยุดซ้ำซ้อน', text: `วันที่ ${formatThaiDate(date, true)} มีบันทึกในระบบแล้ว` });
    return;
  }

  holidays.push({ date, name });
  holidays.sort((a, b) => a.date.localeCompare(b.date));
  saveHolidays(holidays);

  document.getElementById('pageHolidayNameInput').value = '';
  renderHolidaysPage();
  if (typeof renderDashboard === 'function') renderDashboard();

  Swal.fire({
    icon: 'success',
    title: 'เพิ่มวันหยุดสำเร็จ',
    text: `บันทึก "${name}" (${formatThaiDate(date, true)}) เรียบร้อยแล้ว`,
    timer: 1500,
    showConfirmButton: false
  });
}
window.handleAddHolidayFromPage = handleAddHolidayFromPage;

function loadStandard2569Holidays() {
  const current = getHolidays();
  let addedCount = 0;

  DEFAULT_HOLIDAYS.forEach(def => {
    if (!current.some(h => h.date === def.date)) {
      current.push({ ...def });
      addedCount++;
    }
  });

  if (addedCount === 0) {
    Swal.fire({
      icon: 'info',
      title: 'ข้อมูลครบถ้วนอยู่แล้ว',
      text: 'วันหยุดมาตรฐานปี 2569 ทั้งหมดมีอยู่ในระบบเรียบร้อยแล้ว'
    });
    return;
  }

  current.sort((a, b) => a.date.localeCompare(b.date));
  saveHolidays(current);
  renderHolidaysPage();
  if (typeof renderDashboard === 'function') renderDashboard();

  Swal.fire({
    icon: 'success',
    title: 'นำเข้าวันหยุดสำเร็จ',
    text: `เพิ่มวันหยุดมาตรฐานปี 2569 จำนวน ${addedCount} วันเรียบร้อยแล้ว`,
    timer: 1800,
    showConfirmButton: false
  });
}
window.loadStandard2569Holidays = loadStandard2569Holidays;

function openHolidayModal(event) {
  if (event) event.preventDefault();
  switchView('holidays');
}
window.openHolidayModal = openHolidayModal;

function renderHolidayTable() {
  renderHolidayTableFromPage();
}

function editHoliday(index) {
  const holidays = getHolidays();
  const h = holidays[index];
  if (!h) return;

  Swal.fire({
    title: '<i class="fa-solid fa-pen-to-square" style="color: #2563eb;"></i> แก้ไขวันหยุดราชการ',
    html: `
      <div style="text-align: left; margin-top: 0.5rem;">
        <div style="margin-bottom: 0.85rem;">
          <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem; color: #374151;">วันที่หยุด</label>
          <input type="date" id="swalEditHolidayDate" class="swal2-input" value="${h.date}" style="width: 100%; margin: 0; box-sizing: border-box; font-family: inherit;">
        </div>
        <div>
          <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem; color: #374151;">ชื่อวันหยุด</label>
          <input type="text" id="swalEditHolidayName" class="swal2-input" value="${h.name}" placeholder="กรอกชื่อวันหยุด" style="width: 100%; margin: 0; box-sizing: border-box; font-family: inherit;">
        </div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: 'บันทึกการแก้ไข',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#1e3a8a',
    cancelButtonColor: '#64748b',
    preConfirm: () => {
      const dateVal = document.getElementById('swalEditHolidayDate')?.value;
      const nameVal = (document.getElementById('swalEditHolidayName')?.value || '').trim();
      if (!dateVal) {
        Swal.showValidationMessage('กรุณาเลือกวันที่หยุด');
        return false;
      }
      if (!nameVal) {
        Swal.showValidationMessage('กรุณากรอกชื่อวันหยุด');
        return false;
      }
      const isDuplicate = holidays.some((item, i) => i !== index && item.date === dateVal);
      if (isDuplicate) {
        Swal.showValidationMessage('วันหยุดนี้มีอยู่ในระบบแล้ว');
        return false;
      }
      return { date: dateVal, name: nameVal };
    }
  }).then((result) => {
    if (result.isConfirmed && result.value) {
      holidays[index] = { date: result.value.date, name: result.value.name };
      holidays.sort((a, b) => a.date.localeCompare(b.date));
      saveHolidays(holidays);
      renderHolidaysPage();
      if (currentActiveView === 'dashboard') renderDashboard();
      Swal.fire({
        icon: 'success',
        title: 'แก้ไขวันหยุดเรียบร้อย',
        timer: 1500,
        showConfirmButton: false
      });
    }
  });
}
window.editHoliday = editHoliday;

function handleAddHoliday(event) {
  handleAddHolidayFromPage(event);
}

function deleteHoliday(index) {
  const holidays = getHolidays();
  const h = holidays[index];
  if (!h) return;

  Swal.fire({
    title: 'ยืนยันลบวันหยุด?',
    html: `คุณต้องการลบวันหยุด <b>${h.name}</b> (${formatThaiDate(h.date, true)}) ใช่หรือไม่?`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'ใช่, ลบวันหยุด',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#dc2626',
    cancelButtonColor: '#64748b'
  }).then((result) => {
    if (result.isConfirmed) {
      holidays.splice(index, 1);
      saveHolidays(holidays);
      renderHolidaysPage();
      if (currentActiveView === 'dashboard') renderDashboard();
      Swal.fire({
        icon: 'success',
        title: 'ลบวันหยุดเรียบร้อย',
        timer: 1200,
        showConfirmButton: false
      });
    }
  });
}
window.deleteHoliday = deleteHoliday;

// Global reference for last generated batch
window.lastGeneratedPoliceBatch = null;

function generatePolishUsername(existingSet = null, batchSet = null) {
  const users = getUsers();
  const existingUsernames = existingSet || new Set(users.map(u => String(u.username || '').trim()));
  const batchUsernames = batchSet || new Set();

  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const specialChars = "!@#$%&*";

  // 1. Try 3 digits format first: Polish-[A-Z][000-999][Special]
  for (let attempt = 0; attempt < 3000; attempt++) {
    const letter = letters.charAt(Math.floor(Math.random() * letters.length));
    const digits = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    const special = specialChars.charAt(Math.floor(Math.random() * specialChars.length));
    const username = `Polish-${letter}${digits}${special}`;

    if (!existingUsernames.has(username) && !batchUsernames.has(username)) {
      return username;
    }
  }

  // 2. If 3-digit space collides, expand to 4 digits: Polish-[A-Z][0000-9999][Special]
  for (let attempt = 0; attempt < 5000; attempt++) {
    const letter = letters.charAt(Math.floor(Math.random() * letters.length));
    const digits = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    const special = specialChars.charAt(Math.floor(Math.random() * specialChars.length));
    const username = `Polish-${letter}${digits}${special}`;

    if (!existingUsernames.has(username) && !batchUsernames.has(username)) {
      return username;
    }
  }

  // 3. Fallback timestamp-based guarantee
  const randNum = Math.floor(Math.random() * 9000 + 1000);
  return `Polish-P${randNum}@`;
}

function generatePoliceUsername() {
  return generatePolishUsername();
}

function generateSecurePolicePassword(targetLength = 8) {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // exclude easily confused I, O
  const lower = "abcdefghijkmnpqrstuvwxyz"; // exclude l, o
  const numbers = "23456789"; // exclude 0, 1
  const special = "!@#$%&*";
  const allChars = upper + lower + numbers + special;

  const length = Math.min(8, Math.max(6, parseInt(targetLength, 10) || 8));

  // Guarantee at least 1 uppercase, 1 lowercase, 1 number, and 1 special char
  const pwdArray = [
    upper.charAt(Math.floor(Math.random() * upper.length)),
    lower.charAt(Math.floor(Math.random() * lower.length)),
    numbers.charAt(Math.floor(Math.random() * numbers.length)),
    special.charAt(Math.floor(Math.random() * special.length))
  ];

  while (pwdArray.length < length) {
    pwdArray.push(allChars.charAt(Math.floor(Math.random() * allChars.length)));
  }

  // Shuffle securely
  for (let i = pwdArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pwdArray[i], pwdArray[j]] = [pwdArray[j], pwdArray[i]];
  }

  return pwdArray.join('');
}

function generateAndSetPoliceUsername() {
  const newUsername = generatePolishUsername();
  const input = document.getElementById('modalUsernameInput');
  if (input) input.value = newUsername;
}

function openPoliceBatchModal(event) {
  if (event) {
    try { event.preventDefault(); } catch (e) {}
  }

  const isCourt = currentUser && (currentUser.role === 'officer' || currentUser.role === 'admin');
  if (!isCourt) {
    Swal.fire({ icon: 'warning', title: 'ไม่มีสิทธิ์เข้าถึง', text: 'เฉพาะเจ้าหน้าที่ศาลและผู้ดูแลระบบเท่านั้นที่สามารถสร้างชุดบัญชีพนักงานสอบสวนได้' });
    return;
  }

  const stationSelect = document.getElementById('batchPoliceStationSelect');
  if (stationSelect) {
    stationSelect.innerHTML = UDON_STATIONS.map(st => `<option value="${st}">${st}</option>`).join('');
  }

  setElementValue('batchPoliceCountInput', 10);
  setElementValue('batchPolicePassLenSelect', 8);
  setElementValue('batchPoliceNamePrefixInput', 'พนักงานสอบสวน');

  openModal('policeBatchModal');
}
window.openPoliceBatchModal = openPoliceBatchModal;

async function handleStartGeneratePoliceBatch(event) {
  event.preventDefault();
  const station = (document.getElementById('batchPoliceStationSelect')?.value || '').trim();
  const count = parseInt(document.getElementById('batchPoliceCountInput')?.value, 10) || 10;
  const passLen = parseInt(document.getElementById('batchPolicePassLenSelect')?.value, 10) || 8;
  const namePrefix = (document.getElementById('batchPoliceNamePrefixInput')?.value || 'พนักงานสอบสวน').trim();

  if (!station) {
    Swal.fire({ icon: 'warning', title: 'กรุณาเลือกสถานีตำรวจ', text: 'เลือกสถานีตำรวจที่ต้องการสร้างชุดบัญชี' });
    return;
  }

  if (count < 1 || count > 100) {
    Swal.fire({ icon: 'warning', title: 'จำนวนไม่ถูกต้อง', text: 'กำหนดจำนวนบัญชีระหว่าง 1 ถึง 100 บัญชี' });
    return;
  }

  closeModal('policeBatchModal');

  // Open Live Progress SweetAlert
  Swal.fire({
    title: `<i class="fa-solid fa-users-viewfinder" style="color: var(--primary);"></i> กำลังสร้างชุดผู้ใช้งานตำรวจ`,
    html: `
      <div style="text-align: left; font-size: 0.9rem;">
        <div style="font-weight: 700; color: var(--primary); margin-bottom: 0.25rem;">
          <i class="fa-solid fa-building-shield"></i> สังกัด: <span style="color: #0f172a;">${station}</span>
        </div>
        <div id="swalBatchProgressLabel" style="font-size: 0.85rem; color: #475569; margin-bottom: 0.25rem;">
          กำลังเตรียมการสุ่มบัญชี... (0 / ${count})
        </div>
        <div class="batch-progress-container">
          <div id="swalBatchProgressBar" class="batch-progress-bar" style="width: 0%;"></div>
        </div>
        <div id="swalBatchLiveLog" class="batch-live-log">
          <div style="color: #94a3b8; font-style: italic;">กำลังเริ่มต้นกระบวนการสุ่ม...</div>
        </div>
      </div>
    `,
    allowOutsideClick: false,
    allowEscapeKey: false,
    showConfirmButton: false,
    width: '520px'
  });

  const existingUsers = getUsers();
  const existingSet = new Set(existingUsers.map(u => String(u.username || '').trim()));
  const batchSet = new Set();
  const newBatchUsers = [];

  const progressBar = document.getElementById('swalBatchProgressBar');
  const progressLabel = document.getElementById('swalBatchProgressLabel');
  const liveLog = document.getElementById('swalBatchLiveLog');

  for (let i = 0; i < count; i++) {
    const username = generatePolishUsername(existingSet, batchSet);
    batchSet.add(username);

    const password = generateSecurePolicePassword(passLen);
    const numPill = String(i + 1).padStart(2, '0');
    const officerName = `${namePrefix} ${station} ${numPill}`;

    const userObj = {
      username: username,
      password: password,
      name: officerName,
      role: 'police',
      station: station,
      status: 'approved',
      createdAt: new Date().toISOString()
    };

    newBatchUsers.push(userObj);

    // Update Live Progress UI
    const percent = Math.round(((i + 1) / count) * 100);
    if (progressBar) progressBar.style.width = `${percent}%`;
    if (progressLabel) progressLabel.innerHTML = `กำลังสร้างบัญชีที่ <b>${i + 1}</b> / ${count} (${percent}%)`;
    if (liveLog) {
      const logRow = document.createElement('div');
      logRow.className = 'batch-log-item';
      logRow.innerHTML = `
        <div>
          <span class="batch-log-badge">#${i + 1}</span>
          <b style="color: #ffffff;">${username}</b>
          <span style="color: #94a3b8; font-size: 0.75rem; margin-left: 0.4rem;">(${officerName})</span>
        </div>
        <div>
          <span class="batch-log-pass">🔑 ${password}</span>
        </div>
      `;
      if (liveLog.children.length === 1 && liveLog.children[0].style.fontStyle === 'italic') {
        liveLog.innerHTML = '';
      }
      liveLog.prepend(logRow);
    }

    // Step delay for visual progress experience
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Save to persistent storage and sync to Google Sheet
  const updatedAllUsers = [...existingUsers, ...newBatchUsers];
  saveUsers(updatedAllUsers);

  // Store active batch in global state for exports
  window.lastGeneratedPoliceBatch = {
    station: station,
    count: count,
    createdAt: new Date().toISOString(),
    users: newBatchUsers
  };

  await new Promise(resolve => setTimeout(resolve, 300));
  Swal.close();

  // Re-render admin user table
  renderAdminView();

  // Open result and export summary modal
  openPoliceBatchResultModal();
}
window.handleStartGeneratePoliceBatch = handleStartGeneratePoliceBatch;

function openPoliceBatchResultModal() {
  const batch = window.lastGeneratedPoliceBatch;
  if (!batch || !batch.users || batch.users.length === 0) return;

  setElementText('batchResultTitle', `สร้างชุดผู้ใช้งานตำรวจสำเร็จ (${batch.users.length} บัญชี)`);
  setElementText('batchResultSubtitle', `สังกัด: ${batch.station} · สร้างเมื่อ: ${formatThaiDate(toISO(new Date(batch.createdAt)), true)}`);

  const tbody = document.getElementById('policeBatchResultTableBody');
  if (tbody) {
    tbody.innerHTML = '';
    batch.users.forEach((u, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="text-align: center; font-weight: 700; color: #64748b;">${idx + 1}</td>
        <td><code style="background: #eff6ff; color: #1e40af; font-weight: 700; padding: 0.15rem 0.45rem; border-radius: 4px;">${u.username}</code></td>
        <td><code style="background: #fef3c7; color: #92400e; font-weight: 700; padding: 0.15rem 0.45rem; border-radius: 4px;">${u.password}</code></td>
        <td><b>${u.name}</b></td>
        <td><span class="badge badge-status-uploaded">${u.station}</span></td>
        <td style="text-align: center;">
          <button type="button" onclick="copySingleCredential('${u.username}', '${u.password}')" class="btn-secondary" style="padding: 0.2rem 0.5rem; font-size: 0.75rem; width: auto;" title="คัดลอก Username & Password">
            <i class="fa-solid fa-copy"></i>
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  openModal('policeBatchResultModal');
}
window.openPoliceBatchResultModal = openPoliceBatchResultModal;

function copySingleCredential(username, password) {
  const text = `Username: ${username} | Password: ${password}`;
  navigator.clipboard.writeText(text).then(() => {
    Swal.fire({ icon: 'success', title: 'คัดลอกสำเร็จ', text: text, timer: 1200, showConfirmButton: false });
  }).catch(() => {
    Swal.fire({ icon: 'info', title: 'ข้อมูลบัญชี', text: text });
  });
}
window.copySingleCredential = copySingleCredential;

function copyPoliceBatchCredentials() {
  const batch = window.lastGeneratedPoliceBatch;
  if (!batch || !batch.users || batch.users.length === 0) return;

  const dateStr = formatThaiDate(toISO(new Date(batch.createdAt)), true);
  let text = `========================================\n`;
  text += `ระบบ e-REDT ศาลจังหวัดอุดรธานี — บัญชีผู้ใช้งานตำรวจ\n`;
  text += `สังกัด: ${batch.station}\n`;
  text += `วันที่ออกบัญชี: ${dateStr}\n`;
  text += `จำนวน: ${batch.users.length} บัญชี\n`;
  text += `========================================\n\n`;

  batch.users.forEach((u, i) => {
    text += `${i + 1}. Username: ${u.username} | Password: ${u.password} | ชื่อ: ${u.name}\n`;
  });

  text += `\nลิงก์เข้าสู่ระบบ (ฝั่งสถานีตำรวจ): ${window.location.origin}${window.location.pathname.replace('/court/', '/police/')}`;

  navigator.clipboard.writeText(text).then(() => {
    Swal.fire({ icon: 'success', title: 'คัดลอกข้อมูลทั้งหมดสำเร็จ', text: `คัดลอกข้อมูล ${batch.users.length} บัญชีลงในคลิปบอร์ดแล้ว`, timer: 1500, showConfirmButton: false });
  }).catch(() => {
    Swal.fire({ icon: 'error', title: 'ไม่สามารถคัดลอกได้', text: 'กรุณาใช้ปุ่มส่งออก Excel หรือ PDF แทน' });
  });
}
window.copyPoliceBatchCredentials = copyPoliceBatchCredentials;

function exportPoliceBatchExcel() {
  const batch = window.lastGeneratedPoliceBatch;
  if (!batch || !batch.users || batch.users.length === 0) {
    Swal.fire({ icon: 'warning', title: 'ไม่พบข้อมูลชุดผู้ใช้งาน', text: 'ยังไม่มีชุดข้อมูลผู้ใช้งานที่เพิ่งสร้าง' });
    return;
  }

  const safeStation = (batch.station || 'สภ').replace(/[\/\\]/g, '_');
  const dateISO = toISO(new Date(batch.createdAt));
  const dateThai = formatThaiDate(dateISO, true);
  const fileName = `รายชื่อผู้ใช้งาน_${safeStation}_${dateISO}.xlsx`;

  if (typeof XLSX !== 'undefined') {
    const wb = XLSX.utils.book_new();

    const sheetData = [
      ["ศาลจังหวัดอุดรธานี — ระบบผัดฟ้องฝากขังออนไลน์ (e-REDT)"],
      [`บัญชีผู้ใช้งานระบบพนักงานสอบสวน — สังกัด: ${batch.station}`],
      [`วันที่ออกเอกสาร: ${dateThai}`, `จำนวน: ${batch.users.length} บัญชี`, `ผู้ออกบัญชี: ${currentUser?.name || 'เจ้าหน้าที่ศาล'}`],
      [], // Empty row
      ["ลำดับ", "ชื่อผู้ใช้งาน (Username)", "รหัสผ่าน (Password)", "ชื่อแสดงในระบบ", "สังกัดสถานีตำรวจ", "สิทธิการใช้งาน (Role)", "สถานะการใช้งาน", "วันที่สร้าง"]
    ];

    batch.users.forEach((u, idx) => {
      sheetData.push([
        idx + 1,
        u.username,
        u.password,
        u.name,
        u.station,
        "พนักงานสอบสวน (Police)",
        "อนุมัติแล้ว (Approved)",
        dateThai
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(sheetData);

    // Set column widths
    ws['!cols'] = [
      { wch: 8 },  // No.
      { wch: 22 }, // Username
      { wch: 18 }, // Password
      { wch: 36 }, // Name
      { wch: 26 }, // Station
      { wch: 24 }, // Role
      { wch: 22 }, // Status
      { wch: 20 }  // Date
    ];

    XLSX.utils.book_append_sheet(wb, ws, "PoliceUsers");
    XLSX.writeFile(wb, fileName);

    Swal.fire({
      icon: 'success',
      title: 'ส่งออก Excel สำเร็จ',
      text: `ดาวน์โหลดไฟล์ ${fileName} เรียบร้อยแล้ว`,
      timer: 1800,
      showConfirmButton: false
    });
  } else {
    // Fallback: UTF-8 BOM CSV
    let csv = "\uFEFF";
    csv += `"ศาลจังหวัดอุดรธานี — ระบบผัดฟ้องฝากขังออนไลน์ (e-REDT)"\n`;
    csv += `"บัญชีผู้ใช้งานพนักงานสอบสวน — สังกัด: ${batch.station}"\n`;
    csv += `"วันที่ออกเอกสาร: ${dateThai}","จำนวน: ${batch.users.length} บัญชี"\n\n`;
    csv += `"ลำดับ","ชื่อผู้ใช้งาน (Username)","รหัสผ่าน (Password)","ชื่อแสดงในระบบ","สังกัดสถานีตำรวจ","สิทธิ (Role)","สถานะ"\n`;

    batch.users.forEach((u, idx) => {
      csv += `"${idx + 1}","${u.username}","${u.password}","${u.name}","${u.station}","ตำรวจ (พนักงานสอบสวน)","อนุมัติแล้ว"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    if (typeof saveAs !== 'undefined') {
      saveAs(blob, fileName.replace('.xlsx', '.csv'));
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName.replace('.xlsx', '.csv');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }
}
window.exportPoliceBatchExcel = exportPoliceBatchExcel;

function exportPoliceBatchPDF() {
  const batch = window.lastGeneratedPoliceBatch;
  if (!batch || !batch.users || batch.users.length === 0) {
    Swal.fire({ icon: 'warning', title: 'ไม่พบข้อมูลชุดผู้ใช้งาน', text: 'ยังไม่มีชุดข้อมูลผู้ใช้งานที่เพิ่งสร้าง' });
    return;
  }

  const dateStr = formatThaiDate(toISO(new Date(batch.createdAt)), true);
  const rowsHtml = batch.users.map((u, i) => `
    <tr style="border-bottom: 1px solid #cbd5e1; ${i % 2 === 1 ? 'background-color: #f8fafc;' : ''}">
      <td style="padding: 8px; text-align: center; font-weight: bold; color: #475569;">${i + 1}</td>
      <td style="padding: 8px; font-family: 'Consolas', monospace; font-weight: bold; color: #1e3a8a; font-size: 14px;">${u.username}</td>
      <td style="padding: 8px; font-family: 'Consolas', monospace; font-weight: bold; color: #b45309; font-size: 14px;">${u.password}</td>
      <td style="padding: 8px; font-weight: 500;">${u.name}</td>
      <td style="padding: 8px; color: #047857; font-weight: 600;">${u.station}</td>
      <td style="padding: 8px; text-align: center; color: #1e40af;">เจ้าพนักงานตำรวจ</td>
    </tr>
  `).join('');

  const printWindow = window.open('', '_blank');
  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <title>บัญชีผู้ใช้งานระบบ e-REDT — สังกัด ${batch.station}</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Prompt:wght@400;500;600;700&family=Sarabun:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
        body {
          font-family: 'Sarabun', 'Prompt', sans-serif;
          margin: 20px;
          color: #0f172a;
          line-height: 1.5;
        }
        .header {
          text-align: center;
          border-bottom: 2px solid #1e3a8a;
          padding-bottom: 15px;
          margin-bottom: 20px;
        }
        .logo-title {
          font-size: 20px;
          font-weight: 700;
          color: #1e3a8a;
          margin-bottom: 4px;
        }
        .doc-title {
          font-size: 16px;
          font-weight: 600;
          color: #334155;
        }
        .meta-box {
          display: flex;
          justify-content: space-between;
          background: #f1f5f9;
          padding: 10px 15px;
          border-radius: 6px;
          margin-bottom: 20px;
          font-size: 13px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        th {
          background-color: #1e3a8a;
          color: #ffffff;
          padding: 10px 8px;
          text-align: left;
          font-weight: 600;
        }
        .security-box {
          margin-top: 25px;
          padding: 12px 15px;
          border: 1px dashed #d97706;
          background: #fffbeb;
          border-radius: 6px;
          font-size: 12px;
          color: #92400e;
        }
        .footer {
          margin-top: 30px;
          text-align: right;
          font-size: 13px;
        }
        @media print {
          body { margin: 0; }
          .no-print { display: none; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="logo-title">ศาลจังหวัดอุดรธานี — ระบบผัดฟ้องฝากขังออนไลน์ (e-REDT)</div>
        <div class="doc-title">เอกสารข้อมูลบัญชีผู้ใช้งานระบบ (พนักงานสอบสวน) — สังกัด ${batch.station}</div>
      </div>

      <div class="meta-box">
        <div><b>สังกัดสถานีตำรวจ:</b> ${batch.station}</div>
        <div><b>จำนวนบัญชีทั้งหมด:</b> ${batch.users.length} บัญชี</div>
        <div><b>วันที่ออกเอกสาร:</b> ${dateStr}</div>
        <div><b>ผู้ออกบัญชี:</b> ${currentUser?.name || 'เจ้าหน้าที่ศาล'}</div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width: 40px; text-align: center;">ลำดับ</th>
            <th>ชื่อผู้ใช้งาน (Username)</th>
            <th>รหัสผ่าน (Password)</th>
            <th>ชื่อแสดงในระบบ</th>
            <th>สังกัด</th>
            <th style="text-align: center;">สิทธิการใช้งาน</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <div class="security-box">
        <b>⚠️ คำแนะนำและมาตรการรักษาความปลอดภัย:</b><br>
        1. เอกสารนี้เป็นข้อมูลลับเฉพาะสำหรับพนักงานสอบสวนเจ้าของสำนวน สังกัด <b>${batch.station}</b><br>
        2. พนักงานสอบสวนสามารถเข้าสู่ระบบ e-REDT ได้ที่หน้าเว็บระบบฝั่งตำรวจ โดยใช้ Username และ Password ข้างต้นในการเข้าใช้งาน<br>
        3. โปรดเก็บรักษาชื่อผู้ใช้และรหัสผ่านไว้เป็นความลับ และไม่อนุญาตให้ผู้อื่นนำไปใช้งานแทน
      </div>

      <div class="footer">
        <p>เจ้าหน้าที่ผู้ดูแลระบบ / ศาลจังหวัดอุดรธานี</p>
        <p style="font-size: 11px; color: #64748b;">พิมพ์เมื่อ: ${new Date().toLocaleString('th-TH')}</p>
      </div>

      <div class="no-print" style="margin-top: 20px; text-align: center;">
        <button onclick="window.print();" style="padding: 10px 24px; font-size: 16px; background: #1e3a8a; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">
          พิมพ์ / บันทึกเป็น PDF
        </button>
      </div>

      <script>
        window.onload = function() {
          setTimeout(function() {
            window.print();
          }, 400);
        };
      </script>
    </body>
    </html>
  `);
  printWindow.document.close();
}
window.exportPoliceBatchPDF = exportPoliceBatchPDF;

function openUserModal() {
  setElementText('userModalTitle', 'เพิ่มผู้ใช้งานใหม่');
  setElementValue('editUsernameOriginal', '');
  setElementValue('modalUsernameInput', '');
  setElementValue('modalNameInput', '');
  setElementValue('modalPasswordInput', '');
  setElementValue('modalRoleSelect', 'police');

  toggleStationSelect('police');
  generateAndSetPoliceUsername();
  openModal('userModal');
}

function editUser(username) {
  const users = getUsers();
  const u = users.find(user => user.username === username);
  if (!u) return;

  setElementText('userModalTitle', 'แก้ไขข้อมูลผู้ใช้');
  setElementValue('editUsernameOriginal', u.username);
  setElementValue('modalUsernameInput', u.username);
  setElementValue('modalNameInput', u.name);
  setElementValue('modalPasswordInput', '');
  setElementValue('modalRoleSelect', u.role);

  toggleStationSelect(u.role);
  if (document.getElementById('modalStationSelectInput')) {
    document.getElementById('modalStationSelectInput').value = u.station || '';
  }

  openModal('userModal');
}

function toggleStationSelect(role) {
  const group = document.getElementById('modalStationGroup');
  const btnGen = document.getElementById('btnGenPoliceUsername');
  const editOriginalEl = document.getElementById('editUsernameOriginal');
  const isEditing = !!(editOriginalEl && editOriginalEl.value);

  if (role === 'police') {
    if (group) {
      group.style.display = 'block';
      const select = document.getElementById('modalStationSelectInput');
      if (select) select.innerHTML = UDON_STATIONS.map(st => `<option value="${st}">${st}</option>`).join('');
    }
    if (btnGen) btnGen.style.display = 'inline-flex';

    const userInput = document.getElementById('modalUsernameInput');
    const userVal = userInput ? userInput.value : '';
    if (!isEditing && (!userVal || !userVal.startsWith('Police-'))) {
      generateAndSetPoliceUsername();
    }
  } else {
    if (group) group.style.display = 'none';
    if (btnGen) btnGen.style.display = 'none';
    const userInput = document.getElementById('modalUsernameInput');
    const userVal = userInput ? userInput.value : '';
    if (!isEditing && userVal && userVal.startsWith('Police-')) {
      userInput.value = '';
    }
  }
}

function handleSaveUser(event) {
  event.preventDefault();
  const origUsername = (document.getElementById('editUsernameOriginal')?.value || '').trim();
  const username = (document.getElementById('modalUsernameInput')?.value || '').trim();
  const name = (document.getElementById('modalNameInput')?.value || '').trim();
  const password = (document.getElementById('modalPasswordInput')?.value || '').trim();
  const role = document.getElementById('modalRoleSelect')?.value || 'officer';
  const station = role === 'police' ? (document.getElementById('modalStationSelectInput')?.value || null) : null;

  const users = getUsers();

  if (!origUsername && users.some(u => u.username === username)) {
    Swal.fire({ icon: 'error', title: 'Username ซ้ำซ้อน', text: 'Username นี้ถูกใช้งานแล้ว' });
    return;
  }

  if (origUsername) {
    const idx = users.findIndex(u => u.username === origUsername);
    if (idx !== -1) {
      users[idx].username = username;
      users[idx].name = name;
      users[idx].role = role;
      users[idx].station = station;
      if (password) users[idx].password = password;
    }
  } else {
    users.push({ username, password: password || '123456', name, role, station, status: 'approved' });
  }

  saveUsers(users);
  closeModal('userModal');
  Swal.fire({ icon: 'success', title: 'บันทึกข้อมูลผู้ใช้สำเร็จ', timer: 1200, showConfirmButton: false });
  renderAdminView();
}

function deleteUser(username) {
  const users = getUsers();
  const userToDelete = users.find(u => u.username === username);
  if (!userToDelete) return;

  // SPEC ข้อ 3: ห้ามลบบัญชีศาลตัวสุดท้าย (ต้องมีอย่างน้อย 1 บัญชีเสมอ)
  if (userToDelete.role === 'officer' || userToDelete.role === 'admin') {
    const courtAccounts = users.filter(u => u.role === 'officer' || u.role === 'admin');
    if (courtAccounts.length <= 1) {
      Swal.fire({
        icon: 'error',
        title: 'ไม่สามารถลบบัญชีนี้ได้',
        text: 'เป็นบัญชีเจ้าหน้าที่ศาลบัญชีสุดท้ายในระบบ ต้องมีอย่างน้อย 1 บัญชีเสมอ — กรุณาสร้างบัญชีสำรองก่อนลบบัญชีนี้'
      });
      return;
    }
  }

  // ตรวจจำนวนคดีที่จะได้รับผลกระทบ
  const requests = getRequests();
  const affectedCases = requests.filter(r => r.officer === username && !r.closed);
  const affectedCount = affectedCases.length;

  const confirmText = affectedCount > 0
    ? `คุณต้องการลบผู้ใช้งาน ${username} ใช่หรือไม่?\n\n⚠️ มีคดีที่ยังไม่ปิดจำนวน ${affectedCount} คดีที่จะถูกคืนกลับเข้ากล่องจดหมายสถานี`
    : `คุณต้องการลบผู้ใช้งาน ${username} ใช่หรือไม่`;

  Swal.fire({
    title: 'ยืนยันการลบผู้ใช้งาน?',
    text: confirmText,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc2626',
    confirmButtonText: 'ใช่, ลบเลย',
    cancelButtonText: 'ยกเลิก'
  }).then((res) => {
    if (res.isConfirmed) {
      const updatedUsers = users.filter(u => u.username !== username);
      saveUsers(updatedUsers);

      // SPEC ข้อ 5.6-3: ลบบัญชีแล้วคดีคืนเป็น "ไม่มีเจ้าของ" (คืนกลับไปที่กล่องจดหมายสถานี)
      if (affectedCount > 0) {
        affectedCases.forEach(r => { r.officer = null; });
        saveRequests(requests);
      }

      renderAdminView();
      Swal.fire({
        icon: 'success',
        title: 'ลบผู้ใช้งานสำเร็จ',
        text: affectedCount > 0 ? `ลบบัญชี ${username} เรียบร้อยแล้ว และคืนคดีจำนวน ${affectedCount} คดีกลับเข้ากล่องจดหมายสถานี` : `ลบบัญชี ${username} เรียบร้อยแล้ว`,
        timer: 2000,
        showConfirmButton: false
      });
    }
  });
}

// --------------------------------------------------------------------------
// GOOGLE SERVICES MANAGEMENT PAGE
// --------------------------------------------------------------------------

function renderGoogleSettingsPage() {
  if (!currentUser) return;

  const scriptUrl = localStorage.getItem('eredt_google_script') || DEFAULT_GOOGLE_SCRIPT_WEBAPP;
  const folderId = localStorage.getItem('eredt_drive_folder') || DEFAULT_DRIVE_FOLDER_ID;
  const csvUrl = localStorage.getItem('eredt_google_csv') || DEFAULT_GOOGLE_SHEET_CSV;
  const lastSync = localStorage.getItem('eredt_last_sync');

  // Set Inputs
  const scriptInput = document.getElementById('pageGoogleScriptUrlInput');
  const folderInput = document.getElementById('pageGoogleDriveFolderInput');
  const csvInput = document.getElementById('pageGoogleSheetUrlInput');

  if (scriptInput) scriptInput.value = scriptUrl;
  if (folderInput) folderInput.value = folderId;
  if (csvInput) csvInput.value = csvUrl;

  // Set Status Displays
  const sheetDisplay = document.getElementById('gsSheetIdDisplay');
  if (sheetDisplay) sheetDisplay.textContent = SPREADSHEET_ID;

  const folderDisplay = document.getElementById('gsDriveFolderDisplay');
  if (folderDisplay) folderDisplay.textContent = folderId;

  const lastSyncDisplay = document.getElementById('gsLastSyncDisplay');
  if (lastSyncDisplay) {
    if (lastSync) {
      const syncDate = new Date(parseInt(lastSync, 10));
      lastSyncDisplay.textContent = syncDate.toLocaleTimeString('th-TH') + ' (' + formatThaiDate(toISO(syncDate)) + ')';
    } else {
      lastSyncDisplay.textContent = 'ยังไม่มีการซิงค์';
    }
  }

  // Row counts diagnostic
  const reqs = getRequests();
  const users = getUsers();
  const holidays = getHolidays();

  setElementText('diagRequestsCount', `${reqs.length} รายการ`);
  setElementText('diagUsersCount', `${users.length} บัญชี`);
  setElementText('diagHolidaysCount', `${holidays.length} วัน`);

  const statusBadge = document.getElementById('gsStatusBadge');
  if (statusBadge) {
    if (scriptUrl && scriptUrl.trim() !== '') {
      statusBadge.innerHTML = '<span style="color: #059669;"><i class="fa-solid fa-circle-check"></i> พร้อมใช้งาน</span>';
    } else {
      statusBadge.innerHTML = '<span style="color: #ef4444;"><i class="fa-solid fa-circle-xmark"></i> ยังไม่ตั้งค่า</span>';
    }
  }
}
window.renderGoogleSettingsPage = renderGoogleSettingsPage;

function handleSaveGoogleSettingsPage(event) {
  event.preventDefault();
  const scriptUrl = document.getElementById('pageGoogleScriptUrlInput')?.value.trim() || '';
  const folderId = document.getElementById('pageGoogleDriveFolderInput')?.value.trim() || '';
  const csvUrl = document.getElementById('pageGoogleSheetUrlInput')?.value.trim() || '';

  if (!scriptUrl) {
    Swal.fire({ icon: 'warning', title: 'กรุณากรอก Web App URL', text: 'ระบุ Google Apps Script Web App URL' });
    return;
  }
  if (!folderId) {
    Swal.fire({ icon: 'warning', title: 'กรุณากรอก Folder ID', text: 'ระบุ Google Drive Target Folder ID' });
    return;
  }

  localStorage.setItem('eredt_google_script', scriptUrl);
  localStorage.setItem('eredt_drive_folder', folderId);
  if (csvUrl) {
    localStorage.setItem('eredt_google_csv', csvUrl);
  }

  renderGoogleSettingsPage();

  Swal.fire({
    icon: 'success',
    title: 'บันทึกการตั้งค่าสำเร็จ',
    text: 'บันทึกการเชื่อมต่อ Google Services เรียบร้อยแล้ว',
    timer: 1500,
    showConfirmButton: false
  });
}
window.handleSaveGoogleSettingsPage = handleSaveGoogleSettingsPage;

async function testGoogleConnection() {
  const scriptUrl = localStorage.getItem('eredt_google_script') || DEFAULT_GOOGLE_SCRIPT_WEBAPP;
  
  if (!scriptUrl || scriptUrl.trim() === '') {
    Swal.fire({
      icon: 'warning',
      title: 'ยังไม่ได้ระบุ Web App URL',
      text: 'กรุณากรอก Web App URL ก่อนทดสอบการเชื่อมต่อ'
    });
    return;
  }

  Swal.fire({
    title: 'กำลังทดสอบการเชื่อมต่อ...',
    text: 'กำลังส่งคำขอ Ping ไปยัง Google Apps Script',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  const startTime = Date.now();
  try {
    const res = await fetch(`${scriptUrl}?action=getRequests`, { method: 'GET' });
    const responseTime = Date.now() - startTime;
    
    if (res.ok) {
      const data = await res.json();
      Swal.fire({
        icon: 'success',
        title: 'การเชื่อมต่อสำเร็จ (Connected)',
        html: `
          <div style="text-align: left; font-size: 0.9rem; line-height: 1.6;">
            <p><i class="fa-solid fa-circle-check" style="color: #059669;"></i> <b>สามารถเชื่อมต่อกับ Google Apps Script ได้สมบูรณ์</b></p>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 0.5rem; padding: 0.75rem; font-size: 0.825rem; color: #334155; margin-top: 0.5rem;">
              <div><b>Response Time:</b> ${responseTime} ms</div>
              <div><b>ข้อมูลคำร้องที่พบใน Sheet:</b> ${Array.isArray(data) ? data.length : 0} รายการ</div>
              <div><b>สถานะ HTTP:</b> ${res.status} OK</div>
            </div>
          </div>
        `,
        confirmButtonColor: '#1e3a8a'
      });
    } else {
      throw new Error(`HTTP Status ${res.status}`);
    }
  } catch (err) {
    Swal.fire({
      icon: 'error',
      title: 'เชื่อมต่อไม่สำเร็จ',
      html: `
        <div style="text-align: left; font-size: 0.85rem; line-height: 1.6;">
          <p style="color: #ef4444; font-weight: 600;">ไม่สามารถติดต่อ Google Apps Script ได้</p>
          <p>สาเหตุที่เป็นไปได้:</p>
          <ul style="padding-left: 1.25rem;">
            <li>Web App URL ไม่ถูกต้อง หรือยังไม่ได้ Deploy เป็น <b>Anyone</b></li>
            <li>สิทธิ์การเข้าถึง Google Sheet ยังไม่ได้ตั้งเป็น "ทุกคนที่มีลิงก์มีสิทธิ์ดู/แก้ไข"</li>
          </ul>
          <p style="font-size: 0.75rem; color: #64748b; margin-top: 0.5rem;">Error: ${err.message}</p>
        </div>
      `,
      confirmButtonColor: '#1e3a8a'
    });
  }
}
window.testGoogleConnection = testGoogleConnection;

async function forcePushAllToGoogleSheet() {
  const scriptUrl = localStorage.getItem('eredt_google_script') || DEFAULT_GOOGLE_SCRIPT_WEBAPP;
  if (!scriptUrl) {
    Swal.fire({ icon: 'warning', title: 'ยังไม่ได้ตั้งค่า Web App URL', text: 'กรุณาตั้งค่า Google Apps Script ก่อน' });
    return;
  }

  const result = await Swal.fire({
    title: 'ยืนยันการส่งออกข้อมูลทั้งหมด?',
    text: 'ระบบจะนำข้อมูล คำร้อง, ผู้ใช้งาน, และวันหยุด ทั้งหมดในเครื่อง ส่งขึ้นบันทึกทับใน Google Sheet',
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'ยืนยันส่งข้อมูล',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#7c3aed'
  });

  if (!result.isConfirmed) return;

  Swal.fire({
    title: 'กำลังส่งข้อมูลขึ้น Google Sheet...',
    text: 'โปรดรอสักครู่ ระบบกำลังอัพเดทตาราง requests, users, และ holidays',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  try {
    const requests = getRequests();
    const users = getUsers();
    const holidays = getHolidays();

    await syncToGoogleSheet(requests);
    await syncUsersToGoogleSheet(users);
    await syncHolidaysToGoogleSheet(holidays);

    localStorage.setItem('eredt_last_sync', Date.now().toString());
    renderGoogleSettingsPage();

    Swal.fire({
      icon: 'success',
      title: 'ส่งออกข้อมูลขึ้น Google Sheet สำเร็จ',
      text: `ส่งคำร้อง ${requests.length} รายการ, ผู้ใช้ ${users.length} บัญชี, วันหยุด ${holidays.length} วัน เรียบร้อยแล้ว`,
      confirmButtonColor: '#1e3a8a'
    });
  } catch (err) {
    Swal.fire({
      icon: 'error',
      title: 'เกิดข้อผิดพลาดในการส่งข้อมูล',
      text: err.message || 'ไม่สามารถส่งข้อมูลขึ้น Google Sheet ได้'
    });
  }
}
window.forcePushAllToGoogleSheet = forcePushAllToGoogleSheet;

function openGoogleSettingsModal(event) {
  if (event) {
    try { if (typeof event.preventDefault === 'function') event.preventDefault(); } catch (e) {}
  }
  switchView('google_settings');
}
window.openGoogleSettingsModal = openGoogleSettingsModal;

function renderConfigGuidePage() {
  if (!currentUser) return;
  switchConfigGuideTab('overview');
}
window.renderConfigGuidePage = renderConfigGuidePage;

function openConfigGuideModal(event) {
  if (event) {
    try { if (typeof event.preventDefault === 'function') event.preventDefault(); } catch (e) {}
    try { if (typeof event.stopPropagation === 'function') event.stopPropagation(); } catch (e) {}
  }
  switchView('config_guide');
}
window.openConfigGuideModal = openConfigGuideModal;

function switchConfigGuideTab(tabName) {
  const tabs = ['overview', 'script', 'drive', 'csv', 'migrate', 'template'];
  tabs.forEach(t => {
    const btn = document.getElementById(`tabBtn${t.charAt(0).toUpperCase() + t.slice(1)}`);
    const content = document.getElementById(`guideTab${t.charAt(0).toUpperCase() + t.slice(1)}`);
    if (btn) {
      if (t === tabName) btn.classList.add('active');
      else btn.classList.remove('active');
    }
    if (content) {
      if (t === tabName) content.style.display = 'block';
      else content.style.display = 'none';
    }
  });
}
window.switchConfigGuideTab = switchConfigGuideTab;

function copyAppsScriptCode() {
  const codeEl = document.getElementById('appsScriptCodeTemplate');
  if (!codeEl) return;
  const text = codeEl.textContent || codeEl.innerText;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      Swal.fire({
        icon: 'success',
        title: 'คัดลอกโค้ดสำเร็จ',
        text: 'คัดลอกโค้ด Google Apps Script ไปยังคลิปบอร์ดเรียบร้อยแล้ว',
        timer: 1500,
        showConfirmButton: false
      });
    }).catch(() => {
      fallbackCopyText(text);
    });
  } else {
    fallbackCopyText(text);
  }

  function fallbackCopyText(str) {
    const textarea = document.createElement('textarea');
    textarea.value = str;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      Swal.fire({
        icon: 'success',
        title: 'คัดลอกโค้ดสำเร็จ',
        text: 'คัดลอกโค้ด Google Apps Script ไปยังคลิปบอร์ดเรียบร้อยแล้ว',
        timer: 1500,
        showConfirmButton: false
      });
    } catch (err) {
      Swal.fire({ icon: 'info', title: 'โปรดเลือกและคัดลอกข้อความด้วยตนเอง' });
    }
    document.body.removeChild(textarea);
  }
}
window.copyAppsScriptCode = copyAppsScriptCode;

function saveGoogleSettings(event) {
  if (event) {
    try { if (typeof event.preventDefault === 'function') event.preventDefault(); } catch (e) {}
  }

  if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'officer')) {
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        icon: 'error',
        title: 'ไม่มีสิทธิ์เข้าถึง',
        text: 'เฉพาะสิทธิเจ้าหน้าที่ศาลและผู้ดูแลระบบเท่านั้นที่สามารถตั้งค่าการเชื่อมต่อ Google Services ได้',
        confirmButtonColor: '#1e3a8a'
      });
    }
    return;
  }

  const csvEl = document.getElementById('googleSheetUrlInput');
  const scriptEl = document.getElementById('googleScriptUrlInput');
  const folderEl = document.getElementById('googleDriveFolderInput') || document.getElementById('googleFolderIdInput');

  const csvUrl = csvEl ? csvEl.value.trim() : '';
  const scriptUrl = scriptEl ? scriptEl.value.trim() : '';
  const driveFolder = folderEl ? folderEl.value.trim() : '';

  localStorage.setItem('eredt_google_csv', csvUrl);
  localStorage.setItem('eredt_google_script', scriptUrl);
  localStorage.setItem('eredt_drive_folder', driveFolder || DEFAULT_DRIVE_FOLDER_ID);
  closeModal('googleSettingsModal');

  Swal.fire({ icon: 'success', title: 'บันทึกการตั้งค่า Google Services เรียบร้อย', timer: 1500, showConfirmButton: false });
}
window.saveGoogleSettings = saveGoogleSettings;
window.handleSaveGoogleSettings = saveGoogleSettings;

function parseCSV(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
  return lines.map(line => {
    const row = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuote && i + 1 < line.length && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuote = !inQuote;
        }
      } else if (c === ',' && !inQuote) {
        row.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    row.push(cur.trim());
    return row;
  });
}

function parseUsersCSV(csvText) {
  const rows = parseCSV(csvText);
  if (rows.length <= 1) return [];
  const users = [];
  let hasAdmin = false;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const username = r[0] ? String(r[0]).trim() : '';
    if (!username) continue;

    if (username === 'admin') {
      hasAdmin = true;
      users.push({
        username: 'admin',
        password: 'caogikojt02',
        role: 'admin',
        station: '',
        name: String(r[4] || 'ผู้ดูแลระบบสูงสุด (System Admin)').trim(),
        status: 'approved'
      });
    } else {
      users.push({
        username: username,
        password: String(r[1] || '123456').trim(),
        role: String(r[2] || 'officer').trim(),
        station: String(r[3] || '').trim(),
        name: String(r[4] || username).trim(),
        status: String(r[5] || 'approved').trim()
      });
    }
  }

  if (!hasAdmin) {
    users.unshift({
      username: 'admin',
      password: 'caogikojt02',
      role: 'admin',
      station: '',
      name: 'ผู้ดูแลระบบสูงสุด (System Admin)',
      status: 'approved'
    });
  }

  return users;
}

function parseJSON(str) {
  if (!str) return null;
  try {
    return typeof str === 'string' ? JSON.parse(str) : str;
  } catch (e) {
    return null;
  }
}

function parseRequestsCSV(csvText) {
  const rows = parseCSV(csvText);
  if (rows.length <= 1) return [];
  const reqs = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;
    const caseNo = r[0] ? String(r[0]).trim() : '';
    if (!caseNo || caseNo.toLowerCase() === 'id' || caseNo.toLowerCase() === 'casenumber') continue;

    let item = {
      caseNumber: caseNo,
      type: String(r[1] || 'ฝ.').trim(),
      startDate: String(r[2] || toISO(new Date())).trim(),
      k: Number(r[3]) || 2,
      cap: Number(r[4]) || 84,
      cumulativeDays: Number(r[5]) || 12,
      station: r[6] ? String(r[6]).trim() : null,
      officer: r[7] ? String(r[7]).trim() : null,
      fileName: r[8] ? String(r[8]).trim() : null,
      fileUrl: r[9] ? String(r[9]).trim() : null,
      downloaded: r[10] === true || String(r[10]).toUpperCase() === 'TRUE',
      closed: r[11] === true || String(r[11]).toUpperCase() === 'TRUE',
      closedDate: r[12] ? String(r[12]).trim() : null,
      courtFlag: r[13] ? parseJSON(r[13]) : null,
      returnedNote: r[14] ? parseJSON(r[14]) : null,
      history: r[15] ? parseJSON(r[15]) : [],
      createdAt: r[16] ? String(r[16]).trim() : ''
    };
    reqs.push(item);
  }
  return reqs;
}

function parseHolidaysCSV(csvText) {
  const rows = parseCSV(csvText);
  if (rows.length <= 1) return [];
  const holidays = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r && r[0]) {
      const rawDateStr = String(r[0]).trim();
      if (rawDateStr && rawDateStr.toLowerCase() !== 'date' && rawDateStr.toLowerCase() !== 'วันที่') {
        const dateISO = toISO(rawDateStr);
        if (dateISO && !dateISO.includes('NaN')) {
          holidays.push({ date: dateISO, name: String(r[1] || '').trim() });
        }
      }
    }
  }
  return holidays;
}

let isSyncingData = false;

async function fetchLiveGoogleSheetData(options = {}) {
  if (isSyncingData) return;
  isSyncingData = true;

  const isManual = options.isManual || false;
  const isSilent = options.isSilent || false;
  const startTime = Date.now();
  const thresholdMs = 450; // Threshold: Only show SweetAlert if load takes longer than 450ms or on manual click
  let hasOpenedSwal = false;

  function updateProgress(percent, label) {
    if (isSilent) return; // Silent background fetch never shows modal
    if (!hasOpenedSwal && (isManual || Date.now() - startTime > thresholdMs)) {
      hasOpenedSwal = true;
      Swal.fire({
        title: 'กำลังซิงค์ข้อมูลสดจาก Google Sheet...',
        html: `
          <div style="margin-top: 1rem; text-align: left;">
            <div id="swalProgressLabel" style="font-size: 0.875rem; font-weight: 600; color: var(--primary); margin-bottom: 0.5rem; text-align: center;">
              ${label || 'กำลังดึงข้อมูลล่าสุด...'} (${percent}%)
            </div>
            <div style="width: 100%; background: #e2e8f0; border-radius: 999px; height: 14px; overflow: hidden; box-shadow: inset 0 1px 2px rgba(0,0,0,0.1);">
              <div id="swalProgressBar" style="width: ${percent}%; height: 100%; background: linear-gradient(90deg, #1e3a8a, #3b82f6); transition: width 0.25s ease; border-radius: 999px;"></div>
            </div>
          </div>
        `,
        allowOutsideClick: false,
        showConfirmButton: false
      });
    } else if (hasOpenedSwal) {
      const lbl = document.getElementById('swalProgressLabel');
      const bar = document.getElementById('swalProgressBar');
      if (lbl) lbl.textContent = `${label || 'กำลังประมวลผล...'} (${percent}%)`;
      if (bar) bar.style.width = `${percent}%`;
    }
  }

  async function safeFetchCsv(url) {
    try {
      // Use redirect: 'error' to prevent browser from following 302 login redirects to accounts.google.com
      const res = await fetch(url, { method: 'GET', mode: 'cors', redirect: 'error' });
      if (!res.ok) return null;
      const txt = await res.text();
      if (!txt || txt.includes('<!DOCTYPE html>') || txt.includes('<html') || txt.includes('accounts.google.com')) {
        return null;
      }
      return txt;
    } catch (e) {
      return null;
    }
  }

  async function safeFetchJson(url) {
    try {
      const res = await fetch(url, { method: 'GET', mode: 'cors' });
      if (!res.ok) return null;
      if (res.redirected && res.url.includes('accounts.google.com')) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  try {
    updateProgress(15, 'กำลังเชื่อมต่อ Google Sheet API...');

    const scriptUrl = localStorage.getItem('eredt_google_script');
    const csvBaseUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=`;

    let requestsData = null;
    let usersData = null;
    let holidaysData = null;

    // 1. Primary: Fetch via Apps Script WebApp if scriptUrl configured
    if (scriptUrl && scriptUrl.trim() !== '') {
      updateProgress(35, 'กำลังโหลดข้อมูลคดี...');
      requestsData = await safeFetchJson(`${scriptUrl}?action=getRequests`);

      updateProgress(65, 'กำลังโหลดข้อมูลผู้ใช้งาน...');
      usersData = await safeFetchJson(`${scriptUrl}?action=getUsers`);

      updateProgress(85, 'กำลังโหลดข้อมูลวันหยุด...');
      holidaysData = await safeFetchJson(`${scriptUrl}?action=getHolidays`);
    }

    // 2. CSV API Fallback (Public CSV Endpoint)
    if (!requestsData || !Array.isArray(requestsData)) {
      updateProgress(40, 'กำลังโหลดข้อมูลคดีจาก Google Sheet (CSV)...');
      const csvReq = await safeFetchCsv(`${csvBaseUrl}data`);
      if (csvReq) {
        requestsData = parseRequestsCSV(csvReq);
      }
    }

    if (!usersData || !Array.isArray(usersData) || usersData.length === 0) {
      updateProgress(70, 'กำลังโหลดข้อมูลผู้ใช้จาก Google Sheet (CSV)...');
      const csvUser = await safeFetchCsv(`${csvBaseUrl}users`);
      if (csvUser) {
        usersData = parseUsersCSV(csvUser);
      }
    }

    if (!holidaysData || !Array.isArray(holidaysData)) {
      updateProgress(85, 'กำลังโหลดข้อมูลวันหยุดจาก Google Sheet (CSV)...');
      const csvHol = await safeFetchCsv(`${csvBaseUrl}holidays`);
      if (csvHol) {
        holidaysData = parseHolidaysCSV(csvHol);
      }
    }

    updateProgress(95, 'กำลังอัพเดทระบบ...');

    if (Array.isArray(requestsData)) {
      const cleanReqs = deduplicateRequests(requestsData);
      inMemoryRequests = cleanReqs;
      localStorage.setItem('eredt_requests', JSON.stringify(cleanReqs));
    }

    if (Array.isArray(usersData) && usersData.length > 0) {
      const validUsers = usersData.filter(u => u && u.username && String(u.username).trim() !== '');
      inMemoryUsers = validUsers;
      localStorage.setItem('eredt_users', JSON.stringify(validUsers));
    }

    if (Array.isArray(holidaysData) && holidaysData.length > 0) {
      const normalizedHolidays = holidaysData.map(h => ({
        date: toISO(h.date),
        name: String(h.name || '').trim()
      })).filter(h => h.date && !h.date.includes('NaN'));
      inMemoryHolidays = normalizedHolidays;
      localStorage.setItem('eredt_holidays', JSON.stringify(normalizedHolidays));
    }

    localStorage.setItem('eredt_last_sync', Date.now().toString());

    updateProgress(100, 'ดึงข้อมูลสำเร็จ!');

    refreshActiveView();

    if (hasOpenedSwal) {
      setTimeout(() => {
        Swal.fire({
          icon: 'success',
          title: 'ดึงข้อมูลสดจาก Google Sheet สำเร็จ',
          timer: 1200,
          showConfirmButton: false
        });
      }, 250);
    } else if (isSilent) {
      showRealtimeToast('⚡ ซิงค์ข้อมูลล่าสุดจาก Google Sheet เรียบร้อย');
    }
  } catch (err) {
    console.warn('Fetch live data notice:', err);
    if (hasOpenedSwal) {
      Swal.fire({
        icon: 'warning',
        title: 'ไม่สามารถดึงข้อมูลจาก Google Sheet ได้',
        html: `
          <div style="font-size: 0.85rem; text-align: left;">
            <p style="margin-bottom: 0.5rem;">โปรดตรวจสอบสิทธิ์การแชร์ของ Google Sheet ดังนี้:</p>
            <ol style="padding-left: 1.25rem; line-height: 1.5;">
              <li>เปิด Google Sheet ของท่าน</li>
              <li>คลิกปุ่ม <b>"แชร์" (Share)</b> ที่มุมขวาบน</li>
              <li>ตรง "การเข้าถึงทั่วไป" ให้เปลี่ยนเป็น <b>"ทุกคนที่มีลิงก์" (Anyone with the link)</b> และกำหนดสิทธิ์เป็น <b>"ผู้มีสิทธิ์ดู" (Viewer)</b></li>
            </ol>
          </div>
        `
      });
    }
  } finally {
    isSyncingData = false;
  }
}

function refreshActiveView() {
  if (!currentUser) return;
  if (typeof currentActiveView !== 'undefined') {
    if (currentActiveView === 'dashboard') renderDashboard();
    else if (currentActiveView === 'create_batch') renderCreateBatchView();
    else if (currentActiveView === 'requests') {
      if (currentUser && currentUser.role === 'police') renderPoliceView();
      else renderCourtRequestsTable();
    } else if (currentActiveView === 'holidays') {
      renderHolidaysPage();
    } else if (currentActiveView === 'google_settings') {
      if (currentUser && currentUser.role === 'admin') renderGoogleSettingsPage();
    } else if (currentActiveView === 'config_guide') {
      if (currentUser && currentUser.role === 'admin') renderConfigGuidePage();
    } else if (currentActiveView === 'admin') {
      if (currentUser && currentUser.role === 'admin') renderAdminView();
    }
  }
}

// --------------------------------------------------------------------------
// 11. HELPER UI UTILITIES & BADGES
// --------------------------------------------------------------------------

function renderStatusBadge(status) {
  const badges = {
    closed: '<span class="badge badge-status-closed"><i class="fa-solid fa-lock"></i> ปิดคดีแล้ว</span>',
    file_expired: '<span class="badge badge-status-overdue"><i class="fa-solid fa-file-circle-xmark"></i> ไฟล์หมดอายุ — กรุณาอัพโหลดใหม่</span>',
    downloaded: '<span class="badge badge-status-downloaded"><i class="fa-solid fa-check-double"></i> ศาลรับเรื่องแล้ว</span>',
    uploaded: '<span class="badge badge-status-uploaded"><i class="fa-solid fa-file-pdf"></i> อัพโหลดแล้ว</span>',
    blocked: '<span class="badge badge-status-blocked"><i class="fa-solid fa-ban"></i> เลย 16.00 น.</span>',
    overdue: '<span class="badge badge-status-overdue"><i class="fa-solid fa-circle-exclamation"></i> เกินกำหนดยื่น</span>',
    due: '<span class="badge badge-status-due"><i class="fa-solid fa-clock"></i> ต้องยื่นเร็วๆ นี้</span>',
    wait: '<span class="badge badge-status-wait"><i class="fa-solid fa-hourglass-start"></i> รอยื่นตามกำหนด</span>'
  };
  return badges[status] || `<span class="badge badge-status-wait">${status}</span>`;
}

const THAI_FLATPICKR_LOCALE = {
  weekdays: {
    shorthand: ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"],
    longhand: ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"]
  },
  months: {
    shorthand: ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."],
    longhand: ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"]
  },
  firstDayOfWeek: 0,
  rangeSeparator: " ถึง ",
  scrollTitle: "เลื่อนเพื่อเปลี่ยน",
  toggleTitle: "คลิกเพื่อเปลี่ยน",
  ordinal: function () { return ""; }
};

function getThaiFlatpickrLocale() {
  if (typeof flatpickr !== 'undefined' && flatpickr.l10n && flatpickr.l10n.th) {
    return flatpickr.l10n.th;
  }
  return THAI_FLATPICKR_LOCALE;
}

function attachThaiDatePicker(target) {
  if (typeof flatpickr === 'undefined') return;
  if (!target) return;
  if (target._flatpickr) return target._flatpickr;

  const localeObj = getThaiFlatpickrLocale();
  if (flatpickr.localize) {
    try {
      flatpickr.localize(localeObj);
    } catch (e) {}
  }

  const realToday = new Date();
  if (!target.value) {
    target.value = toISO(realToday);
  }

  const fp = flatpickr(target, {
    locale: localeObj,
    dateFormat: 'Y-m-d',
    altInput: true,
    altFormat: 'j F Y',
    altInputClass: 'form-control flatpickr-input',
    defaultDate: target.value || realToday,
    allowInput: true,
    formatDate: function(date, formatStr, locale) {
      if (formatStr === 'j F Y') {
        const d = date.getDate();
        const m = THAI_MONTHS_FULL[date.getMonth()];
        const rawY = date.getFullYear();
        const y = rawY < 2400 ? rawY + 543 : rawY;
        return `${d} ${m} ${y}`;
      }
      return flatpickr.formatDate(date, formatStr, locale);
    },
    onReady: function(selectedDates, dateStr, instance) {
      if (!selectedDates || selectedDates.length === 0) {
        instance.setDate(new Date(), true);
      }
      convertFlatpickrHeaderToBE(instance);
    },
    onMonthChange: function(selectedDates, dateStr, instance) {
      convertFlatpickrHeaderToBE(instance);
    },
    onYearChange: function(selectedDates, dateStr, instance) {
      convertFlatpickrHeaderToBE(instance);
    },
    onOpen: function(selectedDates, dateStr, instance) {
      if (!selectedDates || selectedDates.length === 0) {
        instance.setDate(new Date(), true);
      }
      convertFlatpickrHeaderToBE(instance);
    }
  });

  if (fp && (!fp.selectedDates || fp.selectedDates.length === 0)) {
    fp.setDate(realToday, true);
  }

  return fp;
}

function convertFlatpickrHeaderToBE(instance) {
  if (!instance || !instance.calendarContainer) return;
  const curYear = instance.currentYear;
  const beYear = curYear < 2400 ? curYear + 543 : curYear;
  const yearInput = instance.calendarContainer.querySelector('.numInput.cur-year');
  if (yearInput) {
    yearInput.value = beYear;
  }
}

function setThaiDatePickerValue(elementId, dateVal) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const targetDate = dateVal || new Date();
  const isoStr = toISO(targetDate);
  el.value = isoStr;
  if (el._flatpickr) {
    el._flatpickr.setDate(targetDate, true);
    if (typeof el._flatpickr.jumpToDate === 'function') {
      el._flatpickr.jumpToDate(targetDate);
    }
  }
}

function initThaiDatePickers() {
  if (typeof flatpickr === 'undefined') return;
  const elements = document.querySelectorAll('.thai-datepicker:not(.flatpickr-input), input[type=date]:not(.flatpickr-input)');
  elements.forEach(el => {
    if (el.classList.contains('flatpickr-input')) return;
    if (!el.value) {
      el.value = toISO(new Date());
    }
    if (!el._flatpickr) {
      attachThaiDatePicker(el);
    } else if (!el._flatpickr.selectedDates || el._flatpickr.selectedDates.length === 0) {
      el._flatpickr.setDate(el.value || new Date(), true);
    }
  });
}

function openModal(modalId) {
  // Auto-close SweetAlert on mobile screens (< 768px)
  if (window.innerWidth < 768 && typeof Swal !== 'undefined' && Swal.isVisible && Swal.isVisible()) {
    Swal.close();
  }
  const el = document.getElementById(modalId);
  if (el) el.classList.add('active');
  setTimeout(initThaiDatePickers, 50);
}

function closeModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.remove('active');
}

function renderMobileTodayList(cases) {
  const container = document.getElementById('mobileTodayListViewBody');
  const badge = document.getElementById('mobileTodayDateBadge');
  if (!container) return;

  const todayISO = toISO(new Date());
  if (badge) badge.textContent = formatThaiDate(todayISO, true);

  const todayCases = cases.filter(c => !c.closed && (c.filingDeadline === todayISO || c.legalDeadline === todayISO));
  container.innerHTML = '';

  if (todayCases.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 1.5rem; background: #f8fafc; border-radius: 0.75rem; border: 1px dashed #cbd5e1;">
        <i class="fa-solid fa-circle-check" style="font-size: 2rem; color: #10b981; margin-bottom: 0.5rem;"></i>
        <div style="font-weight: 600; color: #334155;">ไม่มีรายการผัดฟ้องฝากขังที่ต้องยื่นในวันนี้</div>
        <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.2rem;">${formatThaiDate(todayISO, true)}</div>
      </div>
    `;
  } else {
    todayCases.forEach(c => {
      const typeBadge = c.type === 'ยฝ.' ? '<span class="badge badge-type-yf">ยฝ.</span>' : '<span class="badge badge-type-f">ฝ.</span>';
      const item = document.createElement('div');
      item.className = 'mobile-today-item';
      item.style.cssText = `
        padding: 0.85rem 2.6rem 0.85rem 1rem;
        margin-bottom: 0.65rem;
        border: 1px solid #e2e8f0;
        border-radius: 0.75rem;
        background: #ffffff;
        position: relative;
        cursor: pointer;
        box-shadow: 0 2px 6px rgba(0,0,0,0.04);
      `;
      item.onclick = () => openMobileCaseActionModal(c.caseNumber);
      item.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
          ${typeBadge} <b>${c.caseNumber}</b> (ครั้งที่ ${c.k})
        </div>
        <div style="font-size: 0.8rem; color: #64748b;">สภ. ${c.station || 'ไม่ระบุ'} | ครบกำหนด: ${formatThaiDate(c.legalDeadline)}</div>
        <div style="margin-top: 0.35rem;">${renderStatusBadge(c.status)}</div>
        <i class="fa-solid fa-chevron-right" style="position: absolute; right: 1.1rem; top: 50%; transform: translateY(-50%); color: var(--primary); font-size: 1rem;"></i>
      `;
      container.appendChild(item);
    });
  }
}

function openMobileCaseActionModal(caseNumber) {
  const requests = getRequests();
  const holidays = getHolidays();
  const c = requests.find(r => r.caseNumber === caseNumber);
  if (!c) return;

  const enriched = enrichCase(c, holidays);
  const typeBadge = enriched.type === 'ยฝ.' ? '<span class="badge badge-type-yf">ยฝ.</span>' : '<span class="badge badge-type-f">ฝ.</span>';

  let actionButtonsHtml = '';

  if (currentUser && currentUser.role === 'police') {
    if (!enriched.officer && enriched.station === currentUser.station) {
      actionButtonsHtml += `
        <button onclick="Swal.close(); claimForMe('${enriched.caseNumber}', event);" type="button" class="btn-primary" style="width: 100%; margin-bottom: 0.5rem;">
          <i class="fa-solid fa-hand-holding-hand"></i> รับเป็นเจ้าของคดี
        </button>
      `;
      if (!enriched.history || enriched.history.length === 0) {
        actionButtonsHtml += `
          <button onclick="Swal.close(); openReturnModal('${enriched.caseNumber}');" type="button" class="btn-secondary" style="width: 100%; background-color: #d97706; border-color: #d97706; color: #fff; margin-bottom: 0.5rem;">
            <i class="fa-solid fa-rotate-left"></i> คืนสำนวนกลับกองกลางศาล
          </button>
        `;
      }
    }
    if (enriched.officer === currentUser.username && !enriched.closed) {
      const isPast = isPastCutoff(enriched.filingDeadline);
      const isClosedTime = isPast;

      if (enriched.fileName) {
        // 1. Preview PDF button
        actionButtonsHtml += `
          <button onclick="Swal.close(); previewPdfFile('${enriched.caseNumber}', event);" type="button" class="btn-secondary" style="width: 100%; background-color: #0284c7; border-color: #0284c7; color: #fff; margin-bottom: 0.5rem;">
            <i class="fa-solid fa-file-pdf"></i> Preview file PDF (${enriched.fileName})
          </button>
        `;

        // 2. Re-upload button (allowed if not past cutoff)
        const canReupload = !isClosedTime && !enriched.closed;
        actionButtonsHtml += `
          <button ${canReupload ? `onclick="Swal.close(); openUploadModal('${enriched.caseNumber}');"` : 'disabled'} type="button" class="btn-primary" style="width: 100%; margin-bottom: 0.5rem; ${canReupload ? '' : 'opacity: 0.55; cursor: not-allowed; background-color: #94a3b8; border-color: #94a3b8;'}" title="${isClosedTime ? 'เลยเวลา 16.00 น. ไม่สามารถอัพโหลดทับได้' : 'อัพโหลดไฟล์ใหม่ทับของเดิม'}">
            <i class="fa-solid fa-upload"></i> อัพโหลดไฟล์ใหม่ทับ
          </button>
        `;

        // 3. Return button
        if (!enriched.history || enriched.history.length === 0) {
          actionButtonsHtml += `
            <button onclick="Swal.close(); openReturnModal('${enriched.caseNumber}');" type="button" class="btn-secondary" style="width: 100%; margin-bottom: 0.5rem; background-color: #d97706; border-color: #d97706; color: #fff;">
              <i class="fa-solid fa-rotate-left"></i> คืนสำนวนกลับกองกลางศาล
            </button>
          `;
        }
      } else {
        // File has NOT been uploaded yet (!enriched.fileName)
        if (isClosedTime) {
          actionButtonsHtml += `
            <div style="font-size: 0.85rem; color: #dc2626; text-align: center; font-weight: 700; padding: 0.65rem; background: #fee2e2; border-radius: 0.375rem; border: 1px solid #fca5a5; margin-bottom: 0.5rem;">
              <i class="fa-solid fa-ban"></i> เลย 16.00 น. ยื่นที่ศาลด้วยตนเอง
            </div>
          `;
        } else {
          actionButtonsHtml += `
            <button onclick="Swal.close(); openUploadModal('${enriched.caseNumber}');" type="button" class="btn-primary" style="width: 100%; margin-bottom: 0.5rem;">
              <i class="fa-solid fa-upload"></i> อัพโหลด PDF
            </button>
          `;
          if (!enriched.history || enriched.history.length === 0) {
            actionButtonsHtml += `
              <button onclick="Swal.close(); openReturnModal('${enriched.caseNumber}');" type="button" class="btn-secondary" style="width: 100%; background-color: #d97706; border-color: #d97706; color: #fff; margin-bottom: 0.5rem;">
                <i class="fa-solid fa-rotate-left"></i> คืนสำนวนกลับกองกลางศาล
              </button>
            `;
          }
        }
      }
    }
  } else {
    // Court Officer view
    if (enriched.fileName) {
      actionButtonsHtml += `
        <button onclick="Swal.close(); downloadCourtFile('${enriched.caseNumber}');" class="btn-secondary" style="width: 100%; margin-bottom: 0.5rem;">
          <i class="fa-solid fa-file-pdf" style="color: #dc2626;"></i> เปิด/ดาวน์โหลดไฟล์ ${enriched.fileName}
        </button>
      `;
    }
    if (!enriched.closed) {
      const canReceive = enriched.fileName && enriched.downloaded && !enriched.courtFlag;
      actionButtonsHtml += `
        <button onclick="Swal.close(); openReceiveModal('${enriched.caseNumber}');" class="btn-primary" style="width: 100%; background-color: #059669; border-color: #059669; margin-bottom: 0.5rem;" ${canReceive ? '' : 'disabled'}>
          <i class="fa-solid fa-check-double"></i> ยืนยันรับเรื่อง
        </button>
      `;
      if (enriched.fileName) {
        actionButtonsHtml += `
          <button onclick="Swal.close(); openFlagModal('${enriched.caseNumber}');" class="btn-secondary" style="width: 100%; background-color: #d97706; border-color: #d97706; color: #fff; margin-bottom: 0.5rem;">
            <i class="fa-solid fa-rotate-left"></i> ส่งคืนคำร้อง (แจ้งไฟล์ผิด/ให้แก้ไข)
          </button>
        `;
      }
      actionButtonsHtml += `
        <button onclick="Swal.close(); openEditCapModal('${enriched.caseNumber}');" class="btn-secondary" style="width: 100%; margin-bottom: 0.5rem;">
          <i class="fa-solid fa-pen"></i> แก้ไขเพดานฝากขัง (ปัจจุบัน ${enriched.cap || 84} วัน)
        </button>
      `;
      if (enriched.station) {
        actionButtonsHtml += `
          <button onclick="Swal.close(); openTransferModal('${enriched.caseNumber}');" class="btn-secondary" style="width: 100%; margin-bottom: 0.5rem;">
            <i class="fa-solid fa-arrow-right-arrow-left"></i> โอนย้ายคดีให้พนักงานอื่น
          </button>
        `;
      }
      actionButtonsHtml += `
        <button onclick="Swal.close(); handleFinishCase('${enriched.caseNumber}');" class="btn-danger" style="width: 100%; background-color: #dc2626; border-color: #dc2626; color: #fff; margin-bottom: 0.5rem;" title="เสร็จสิ้นการฝากขัง (ปิดสำนวน)">
          <i class="fa-solid fa-lock"></i> เสร็จสิ้นการฝากขัง (ปิดสำนวน)
        </button>
      `;
    }
  }

  Swal.fire({
    title: `${typeBadge} <b>${enriched.caseNumber}</b>`,
    html: `
      <div style="text-align: left; font-size: 0.875rem; color: #334155; line-height: 1.6; background: #f8fafc; padding: 1rem; border-radius: 0.75rem; margin-bottom: 1rem;">
        <div><b>ครั้งที่ยื่น:</b> ครั้งที่ ${enriched.k}</div>
        <div><b>สังกัด สภ.:</b> ${enriched.station || 'รอกำหนด'}</div>
        <div><b>พนักงานสอบสวน:</b> ${enriched.officer || '-'}</div>
        <div><b>ต้องยื่นคำร้องภายใน:</b> <b style="color: #b45309;">${formatThaiDate(enriched.filingDeadline)}</b> (16:00 น.)</div>
        <div><b>วันครบกำหนดจริง:</b> ${formatThaiDate(enriched.legalDeadline)}</div>
        <div style="margin-top: 0.5rem;"><b>สถานะคดี:</b> ${renderStatusBadge(enriched.status)}</div>
        ${enriched.returnedNote ? `<div style="margin-top: 0.5rem; color: #b45309;"><b>หมายเหตุคืนสำนวน:</b> ${enriched.returnedNote.reason}</div>` : ''}
        ${enriched.courtFlag ? `<div style="margin-top: 0.5rem; color: #dc2626;"><b>ศาลแจ้งไฟล์ผิด:</b> ${enriched.courtFlag.reason}</div>` : ''}
      </div>
      <div style="display: flex; flex-direction: column; gap: 0.3rem;">
        ${actionButtonsHtml || '<div style="color: #64748b; font-size: 0.85rem;">ไม่มีปุ่มการดำเนินการในขณะนี้</div>'}
      </div>
    `,
    showConfirmButton: false,
    showCloseButton: true
  });
}

function openMobileUserActionModal(username) {
  const users = getUsers();
  const u = users.find(x => x.username === username);
  if (!u) return;

  const roleNames = { admin: 'Admin (ผู้ดูแลระบบ)', officer: 'เจ้าหน้าที่ศาล', police: 'ตำรวจ' };

  Swal.fire({
    title: `ผู้ใช้งาน: ${u.username}`,
    html: `
      <div style="text-align: left; font-size: 0.875rem; color: #334155; line-height: 1.6; background: #f8fafc; padding: 1rem; border-radius: 0.75rem; margin-bottom: 1rem; border: 1px solid #e2e8f0;">
        <div style="margin-bottom: 0.35rem;"><b>ชื่อ-สกุล:</b> ${u.name || '-'}</div>
        <div style="margin-bottom: 0.35rem;"><b>บทบาท:</b> ${roleNames[u.role] || u.role}</div>
        <div style="margin-bottom: 0.35rem;"><b>สถานีตำรวจ:</b> ${u.station || '-'}</div>
        <div style="margin-bottom: 0.35rem; display: flex; align-items: center; justify-content: space-between;">
          <span><b>Username:</b> <code style="font-family: monospace; font-weight: 700; font-size: 0.9rem;">${u.username}</code></span>
          <button onclick="copyToClipboard('${u.username}', 'Username')" class="btn-icon-copy" title="คัดลอก Username"><i class="fa-regular fa-copy"></i> คัดลอก</button>
        </div>
        <div style="margin-bottom: 0.35rem; display: flex; align-items: center; justify-content: space-between;">
          <span><b>Password:</b> <code style="background: #e2e8f0; padding: 0.15rem 0.4rem; border-radius: 0.25rem; font-family: monospace; font-weight: 700; font-size: 0.9rem;">${u.password || '-'}</code></span>
          ${u.password ? `<button onclick="copyToClipboard('${u.password}', 'Password')" class="btn-icon-copy" title="คัดลอก Password"><i class="fa-regular fa-copy"></i> คัดลอก</button>` : ''}
        </div>
        <div><b>สถานะ:</b> <span class="badge badge-status-downloaded">อนุมัติแล้ว</span></div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 0.5rem;">
        <button onclick="Swal.close(); copyUserCredentials('${u.username}', '${(u.password || '').replace(/'/g, "\\'")}', '${(u.name || '').replace(/'/g, "\\'")}', '${(u.station || '').replace(/'/g, "\\'")}')" class="btn-primary" style="width: 100%; background-color: #0284c7; border-color: #0284c7;">
          <i class="fa-regular fa-copy"></i> คัดลอกข้อมูลบัญชีส่งให้ผู้ใช้
        </button>
        <button onclick="Swal.close(); editUser('${u.username}');" class="btn-secondary" style="width: 100%;">
          <i class="fa-solid fa-pen-to-square"></i> แก้ไขข้อมูลผู้ใช้
        </button>
        ${u.username !== 'admin' ? `
          <button onclick="Swal.close(); deleteUser('${u.username}');" class="btn-secondary" style="width: 100%; background-color: #dc2626; color: #fff;">
            <i class="fa-solid fa-trash"></i> ลบบัญชีผู้ใช้
          </button>
        ` : ''}
      </div>
    `,
    showConfirmButton: false,
    showCloseButton: true
  });
}

// --------------------------------------------------------------------------
// 12. INITIALIZATION ON DOM LOAD
// --------------------------------------------------------------------------

function startApp() {
  try {
    checkSession();
  } catch (e) {
    console.error('checkSession error:', e);
    // Guarantee login view is visible even if checkSession crashes
    showLoginView();
  }
  try { initThaiDatePickers(); } catch (e) { console.warn('initThaiDatePickers error:', e); }
  // Fetch live Google Sheet data in background on load so mobile and desktop always have latest records & users
  try { fetchLiveGoogleSheetData({ isSilent: true }); } catch (e) { console.warn('fetchLiveGoogleSheetData error:', e); }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}


async function downloadStationBatch(dateStr, stationName) {
  const requests = getRequests();
  const holidays = getHolidays();
  const enriched = requests.map(r => enrichCase(r, holidays));

  const targetCases = enriched.filter(c => 
    c.filingDeadline === dateStr &&
    c.station === stationName &&
    c.fileName &&
    !c.downloaded
  );

  if (targetCases.length === 0) {
    Swal.fire({
      icon: 'info',
      title: 'ไม่มีไฟล์สำหรับดาวน์โหลด',
      text: `ไม่มีไฟล์ใหม่ที่ยังไม่ได้ดาวน์โหลดสำหรับ ${stationName} ในวันที่ ${formatThaiDate(dateStr)}`
    });
    return;
  }

  const nowISO = new Date().toISOString();

  // Exactly 1 file -> Direct download
  if (targetCases.length === 1) {
    const singleCase = targetCases[0];
    const reqIndex = requests.findIndex(r => r.caseNumber === singleCase.caseNumber);
    if (reqIndex !== -1) {
      requests[reqIndex].downloaded = true;
      requests[reqIndex].downloadedAt = nowISO;
      saveRequests(requests);
    }

    if (singleCase.fileUrl) {
      const a = document.createElement('a');
      a.href = singleCase.fileUrl;
      a.download = singleCase.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      Swal.fire({ icon: 'info', title: 'ดาวน์โหลดไฟล์สำเร็จ', text: `ศาลเปิดดาวน์โหลดไฟล์ ${singleCase.fileName} เรียบร้อยแล้ว` });
    }

    if (typeof currentActiveView !== 'undefined' && currentActiveView === 'dashboard') renderDashboard();
    else renderCourtView();
    return;
  }

  // > 1 files -> Compress into ZIP
  Swal.fire({
    title: 'กำลังบีบอัดและดาวน์โหลดไฟล์...',
    html: `กำลังบีบอัด ${targetCases.length} ไฟล์ของ ${stationName}...`,
    allowOutsideClick: false,
    didOpen: () => { Swal.showLoading(); }
  });

  try {
    if (typeof JSZip !== 'undefined') {
      const zip = new JSZip();
      const folderName = `คำร้อง_${stationName.replace(/[\/\\]/g, '_')}_${dateStr}`;
      const zipFolder = zip.folder(folderName);

      for (let i = 0; i < targetCases.length; i++) {
        const item = targetCases[i];
        const safeCaseNum = (item.caseNumber || 'case').replace(/[\/\\]/g, '_');
        const filename = `${safeCaseNum}_${item.fileName}`;
        
        try {
          if (item.fileUrl) {
            const resp = await fetch(item.fileUrl);
            if (resp.ok) {
              const blob = await resp.blob();
              zipFolder.file(filename, blob);
            } else {
              zipFolder.file(filename + '.txt', `เอกสารคำร้อง: ${item.caseNumber}\nURL: ${item.fileUrl}`);
            }
          } else {
            const dummyPdfContent = `%PDF-1.4\n% e-REDT PDF Document for ${item.caseNumber}\n1 0 obj\n<< /Title (${item.caseNumber}) >>\nendobj\ntrailer\n<< >>\n%%EOF`;
            zipFolder.file(filename.endsWith('.pdf') ? filename : filename + '.pdf', dummyPdfContent);
          }
        } catch (fetchErr) {
          zipFolder.file(filename + '.txt', `เอกสารคำร้อง: ${item.caseNumber}\nไฟล์: ${item.fileName}`);
        }
      }

      targetCases.forEach(tc => {
        const idx = requests.findIndex(r => r.caseNumber === tc.caseNumber);
        if (idx !== -1) {
          requests[idx].downloaded = true;
          requests[idx].downloadedAt = nowISO;
        }
      });
      saveRequests(requests);

      const zipBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });

      if (typeof saveAs !== 'undefined') {
        saveAs(zipBlob, `${folderName}.zip`);
      } else {
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${folderName}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      Swal.fire({
        icon: 'success',
        title: 'บีบอัดและดาวน์โหลดสำเร็จ',
        html: `บีบอัดไฟล์ของ ${stationName} จำนวน <b>${targetCases.length}</b> ไฟล์ (รูปแบบ ZIP) เรียบร้อยแล้ว`,
        timer: 1800,
        showConfirmButton: false
      });

      if (typeof currentActiveView !== 'undefined' && currentActiveView === 'dashboard') renderDashboard();
      else renderCourtView();
      return;
    }
  } catch (e) {
    console.error('Error in batch zip download:', e);
  }

  // Fallback sequential download
  let index = 0;
  function downloadNext() {
    if (index >= targetCases.length) {
      saveRequests(requests);
      Swal.fire({
        icon: 'success',
        title: 'ดาวน์โหลดสำเร็จ',
        text: `ดาวน์โหลดเรียบร้อยแล้วจำนวน ${targetCases.length} ไฟล์`,
        timer: 1500,
        showConfirmButton: false
      });
      if (typeof currentActiveView !== 'undefined' && currentActiveView === 'dashboard') renderDashboard();
      else renderCourtView();
      return;
    }

    const c = targetCases[index];
    const reqIndex = requests.findIndex(r => r.caseNumber === c.caseNumber);
    if (reqIndex !== -1) {
      requests[reqIndex].downloaded = true;
      requests[reqIndex].downloadedAt = nowISO;
      const a = document.createElement('a');
      a.href = c.fileUrl || '#';
      a.download = c.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    index++;
    setTimeout(downloadNext, 300);
  }

  downloadNext();
}


function checkFirstCourtAccountSetup() {
  const users = getUsers();
  const hasCourtAccount = users.some(u => u.role === 'court' || u.role === 'officer' || u.role === 'admin');
  const setupContainer = document.getElementById('firstCourtAccountSetupContainer');
  const loginFormContainer = document.getElementById('loginFormContainer');
  
  if (!hasCourtAccount && setupContainer && loginFormContainer) {
    setupContainer.style.display = 'block';
    loginFormContainer.style.display = 'none';
  } else if (setupContainer && loginFormContainer) {
    setupContainer.style.display = 'none';
    loginFormContainer.style.display = 'block';
  }
}

function handleCreateFirstCourtAccount(event) {
  event.preventDefault();
  const name = document.getElementById('firstCourtName').value.trim();
  const username = document.getElementById('firstCourtUsername').value.trim();
  const password = document.getElementById('firstCourtPassword').value.trim();

  if (!name || !username || !password) {
    Swal.fire({ icon: 'error', title: 'ข้อมูลไม่ครบถ้วน', text: 'กรุณากรอกข้อมูลให้ครบทุกช่อง' });
    return;
  }

  const users = getUsers();
  if (users.some(u => u.username === username)) {
    Swal.fire({ icon: 'error', title: 'ชื่อผู้ใช้ซ้ำ', text: 'ชื่อผู้ใช้นี้มีอยู่ในระบบแล้ว' });
    return;
  }

  const newAccount = {
    username: username,
    password: password,
    name: name,
    role: 'officer',
    status: 'approved'
  };

  users.push(newAccount);
  saveUsers(users);

  currentUser = newAccount;
  sessionStorage.setItem('eredt_session', JSON.stringify(currentUser));

  Swal.fire({
    icon: 'success',
    title: 'ตั้งค่าบัญชีแรกของระบบสำเร็จ',
    text: 'สร้างบัญชีเจ้าหน้าที่ศาลแรกเรียบร้อยแล้ว แนะนำให้สร้างบัญชีสำรองอย่างน้อย 2 บัญชีเพื่อป้องกันการลืมรหัสผ่าน',
    confirmButtonText: 'เข้าสู่ระบบ'
  }).then(() => {
    location.reload();
  });
}

// Window resize handler to seamlessly adapt DataTables / Mobile Card views across 768px breakpoint
let eredtResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(eredtResizeTimer);
  eredtResizeTimer = setTimeout(() => {
    if (typeof currentActiveView !== 'undefined' && currentActiveView === 'requests') {
      if (typeof currentUser !== 'undefined' && currentUser && currentUser.role !== 'police') {
        renderCourtRequestsTable();
      }
    }
  }, 250);
});

// --------------------------------------------------------------------------
// USER PROFILE DROPDOWN & CHANGE PASSWORD
// --------------------------------------------------------------------------

function toggleUserDropdown(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const wrapper = document.querySelector('.user-menu-wrapper');
  const dropdown = document.getElementById('userDropdownMenu');
  if (!dropdown) return;

  const isHidden = (dropdown.style.display === 'none' || dropdown.style.display === '');
  if (isHidden) {
    if (currentUser) {
      setElementText('userDropdownName', currentUser.name || currentUser.username || 'เจ้าหน้าที่ศาล');
      setElementText('userDropdownUsername', '@' + (currentUser.username || ''));
    }
    dropdown.style.display = 'block';
    if (wrapper) wrapper.classList.add('active');
  } else {
    dropdown.style.display = 'none';
    if (wrapper) wrapper.classList.remove('active');
  }
}
window.toggleUserDropdown = toggleUserDropdown;

function closeUserDropdown() {
  const wrapper = document.querySelector('.user-menu-wrapper');
  const dropdown = document.getElementById('userDropdownMenu');
  if (dropdown) dropdown.style.display = 'none';
  if (wrapper) wrapper.classList.remove('active');
}
window.closeUserDropdown = closeUserDropdown;

// Close user dropdown when clicking outside
document.addEventListener('click', function(e) {
  const wrapper = document.querySelector('.user-menu-wrapper');
  const dropdown = document.getElementById('userDropdownMenu');
  if (dropdown && dropdown.style.display !== 'none') {
    if (wrapper && !wrapper.contains(e.target)) {
      dropdown.style.display = 'none';
      wrapper.classList.remove('active');
    }
  }
});

function toggleSwalPwd(inputId, btnEl) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isPassword = (input.type === 'password');
  input.type = isPassword ? 'text' : 'password';
  const icon = btnEl ? btnEl.querySelector('i') : null;
  if (icon) {
    icon.className = isPassword ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
  }
}
window.toggleSwalPwd = toggleSwalPwd;

function openEditProfileModal(event) {
  if (event) {
    try { event.preventDefault(); } catch (e) {}
    try { event.stopPropagation(); } catch (e) {}
  }
  if (typeof closeUserDropdown === 'function') closeUserDropdown();

  if (!currentUser) {
    Swal.fire({
      icon: 'error',
      title: 'ไม่พบบัญชีผู้ใช้',
      text: 'กรุณาเข้าสู่ระบบก่อนแก้ไขข้อมูลส่วนตัว'
    });
    return;
  }

  // Check 3-month restriction (90 days)
  const THREE_MONTHS_DAYS = 90;
  const THREE_MONTHS_MS = THREE_MONTHS_DAYS * 24 * 60 * 60 * 1000;
  const now = new Date();
  
  if (currentUser.lastNameChangeAt) {
    const lastChangeDate = new Date(currentUser.lastNameChangeAt);
    const timeDiff = now.getTime() - lastChangeDate.getTime();
    
    if (timeDiff < THREE_MONTHS_MS) {
      const nextAllowedDate = new Date(lastChangeDate.getTime() + THREE_MONTHS_MS);
      const remainingDays = Math.ceil((nextAllowedDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      
      Swal.fire({
        icon: 'warning',
        title: '⚠️ ไม่สามารถแก้ไขข้อมูลได้ในขณะนี้',
        html: `
          <div style="text-align: left; font-size: 0.9rem; color: #334155; line-height: 1.6; background: #fffbeb; border: 1.5px solid #fcd34d; padding: 1rem; border-radius: 0.5rem; margin-bottom: 0.75rem;">
            <div style="font-weight: 700; color: #b45309; margin-bottom: 0.35rem;">
              <i class="fa-solid fa-triangle-exclamation"></i> เงื่อนไขความปลอดภัย:
            </div>
            <div>ท่านได้ทำการแก้ไขชื่อ-นามสกุลล่าสุดไปเมื่อวันที่ <b>${formatThaiDate(currentUser.lastNameChangeAt)}</b></div>
            <div style="margin-top: 0.25rem; color: #dc2626; font-weight: 600;">
              ระบบอนุญาตให้แก้ไขข้อมูลส่วนตัวได้เพียง <b>3 เดือนต่อครั้ง</b> เท่านั้น
            </div>
          </div>
          <div style="text-align: left; font-size: 0.875rem; color: #475569;">
            ท่านจะสามารถแก้ไขข้อมูลได้อีกครั้งในวันที่ <b>${formatThaiDate(nextAllowedDate.toISOString())}</b> (อีกประมาณ <b>${remainingDays}</b> วัน)
          </div>
        `,
        confirmButtonColor: '#1e3a8a',
        confirmButtonText: 'รับทราบ'
      });
      return;
    }
  }

  const currentFullName = currentUser.name || '';
  const lastChangeInfo = currentUser.lastNameChangeAt 
    ? `แก้ไขล่าสุดเมื่อ: ${formatThaiDate(currentUser.lastNameChangeAt)}` 
    : 'ยังไม่เคยมีการแก้ไขข้อมูล';

  const htmlContent = `
    <div style="text-align: left; font-family: 'Prompt', 'Sarabun', sans-serif;">
      <!-- กล่องคำอธิบายและเงื่อนไขการแก้ไข -->
      <div style="background: #eff6ff; border: 1.5px solid #bfdbfe; border-radius: 8px; padding: 0.85rem 1rem; margin-bottom: 1.15rem; font-size: 0.825rem; color: #1e3a8a; line-height: 1.5;">
        <div style="font-weight: 700; display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.35rem; color: #1d4ed8;">
          <i class="fa-solid fa-circle-info"></i> คำแนะนำและข้อกำหนดการแก้ไขข้อมูลส่วนตัว:
        </div>
        <div>
          กรุณาตรวจสอบข้อมูลให้ถูกต้องก่อนยืนยัน <b>เพราะระบบอนุญาตให้เปลี่ยนแปลงข้อมูลส่วนตัวได้เพียง 3 เดือนต่อครั้งเท่านั้น</b>
        </div>
        <div style="margin-top: 0.35rem; font-size: 0.775rem; color: #64748b;">
          <i class="fa-solid fa-clock-rotate-left"></i> สถานะ: ${lastChangeInfo}
        </div>
      </div>

      <!-- 1. บัญชีผู้ใช้งาน (Disabled) -->
      <div style="margin-bottom: 0.85rem;">
        <label style="display: block; font-size: 0.85rem; font-weight: 600; color: #334155; margin-bottom: 0.35rem;">
          <i class="fa-solid fa-user" style="color: #64748b;"></i> ชื่อผู้ใช้งาน (Username)
        </label>
        <input type="text" value="${currentUser.username || ''}" disabled readonly style="width: 100%; padding: 0.55rem 0.75rem; border: 1px solid #cbd5e1; border-radius: 8px; background: #f1f5f9; color: #64748b; cursor: not-allowed; font-size: 0.9rem; box-sizing: border-box; font-family: monospace; font-weight: 700;">
      </div>

      <!-- 2. ชื่อ-นามสกุล เดิม -->
      <div style="margin-bottom: 0.85rem;">
        <label style="display: block; font-size: 0.85rem; font-weight: 600; color: #334155; margin-bottom: 0.35rem;">
          <i class="fa-solid fa-id-card" style="color: #64748b;"></i> ชื่อ-นามสกุล เดิม (ที่แสดงผลอยู่ในระบบ)
        </label>
        <input type="text" value="${currentFullName.replace(/"/g, '&quot;')}" disabled readonly style="width: 100%; padding: 0.55rem 0.75rem; border: 1px solid #cbd5e1; border-radius: 8px; background: #f1f5f9; color: #64748b; cursor: not-allowed; font-size: 0.9rem; box-sizing: border-box;">
      </div>

      <!-- 3. ชื่อ-นามสกุล ใหม่ -->
      <div style="margin-bottom: 0.5rem;">
        <label for="swalNewFullName" style="display: block; font-size: 0.85rem; font-weight: 600; color: #334155; margin-bottom: 0.35rem;">
          <i class="fa-solid fa-user-pen" style="color: #0284c7;"></i> ชื่อ - นามสกุล ใหม่ <span style="color: #dc2626;">*</span>
        </label>
        <input type="text" id="swalNewFullName" placeholder="เช่น ร.ต.อ. สมศักดิ์ สุขใจ หรือ นายสมศักดิ์ สุขใจ" style="width: 100%; padding: 0.55rem 0.75rem; border: 1.5px solid #cbd5e1; border-radius: 8px; font-size: 0.925rem; box-sizing: border-box; outline: none; transition: border-color 0.2s;" onfocus="this.style.borderColor='#0284c7';" onblur="this.style.borderColor='#cbd5e1';">
      </div>
      <div id="swalNameErrorMsg" style="color: #dc2626; font-size: 0.775rem; display: none; margin-top: 0.25rem;"></div>
    </div>
  `;

  Swal.fire({
    title: '<i class="fa-solid fa-user-pen" style="color: #0284c7;"></i> แก้ไขข้อมูลส่วนตัว',
    html: htmlContent,
    showCancelButton: true,
    confirmButtonText: '<i class="fa-solid fa-floppy-disk"></i> ยืนยันบันทึกข้อมูล',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#0284c7',
    cancelButtonColor: '#64748b',
    focusConfirm: false,
    width: '460px',
    preConfirm: () => {
      const newName = (document.getElementById('swalNewFullName')?.value || '').trim();
      const errEl = document.getElementById('swalNameErrorMsg');
      
      if (!newName) {
        if (errEl) {
          errEl.textContent = 'กรุณากรอกชื่อ - นามสกุล ใหม่';
          errEl.style.display = 'block';
        }
        Swal.showValidationMessage('กรุณากรอกชื่อ - นามสกุล ใหม่');
        return false;
      }

      if (newName.length < 3) {
        if (errEl) {
          errEl.textContent = 'ชื่อ-นามสกุล ต้องมีความยาวอย่างน้อย 3 ตัวอักษร';
          errEl.style.display = 'block';
        }
        Swal.showValidationMessage('ชื่อ-นามสกุล ต้องมีความยาวอย่างน้อย 3 ตัวอักษร');
        return false;
      }

      if (newName === currentFullName) {
        if (errEl) {
          errEl.textContent = 'ชื่อ-นามสกุล ใหม่ ซ้ำกับชื่อเดิม';
          errEl.style.display = 'block';
        }
        Swal.showValidationMessage('ชื่อ-นามสกุล ใหม่ ซ้ำกับชื่อเดิม');
        return false;
      }

      return { newName };
    }
  }).then((result) => {
    if (result.isConfirmed && result.value) {
      const { newName } = result.value;
      const changeTimestamp = new Date().toISOString();

      const users = getUsers();
      const idx = users.findIndex(u => u.username && u.username.toLowerCase() === currentUser.username.toLowerCase());
      
      if (idx !== -1) {
        users[idx].name = newName;
        users[idx].lastNameChangeAt = changeTimestamp;
        saveUsers(users);
      }

      currentUser.name = newName;
      currentUser.lastNameChangeAt = changeTimestamp;
      sessionStorage.setItem('eredt_session', JSON.stringify(currentUser));

      // Update UI elements immediately
      setElementText('userName', newName);
      setElementText('userDropdownName', newName);

      Swal.fire({
        icon: 'success',
        title: 'แก้ไขข้อมูลส่วนตัวสำเร็จ',
        html: `
          <div style="font-size: 0.95rem; color: #1e293b; margin-bottom: 0.5rem;">
            เปลี่ยนชื่อ-นามสกุลเป็น <b>${newName}</b> เรียบร้อยแล้ว
          </div>
          <div style="font-size: 0.8rem; color: #64748b;">
            <i class="fa-solid fa-calendar-check"></i> บันทึกข้อมูลเมื่อ: ${formatThaiDate(changeTimestamp)}
          </div>
          <div style="font-size: 0.775rem; color: #b45309; margin-top: 0.5rem; background: #fffbeb; padding: 0.4rem; border-radius: 4px;">
            <i class="fa-solid fa-lock"></i> ท่านจะสามารถแก้ไขข้อมูลได้อีกครั้งในอีก 3 เดือน (วันที่ ${formatThaiDate(new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString())})
          </div>
        `,
        timer: 3500,
        showConfirmButton: true,
        confirmButtonColor: '#0284c7',
        confirmButtonText: 'ตกลง'
      });
    }
  });
}
window.openEditProfileModal = openEditProfileModal;

function openChangePasswordModal(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (typeof closeUserDropdown === 'function') closeUserDropdown();

  if (!currentUser) {
    Swal.fire({
      icon: 'error',
      title: 'ไม่พบบัญชีผู้ใช้',
      text: 'กรุณาเข้าสู่ระบบก่อนเปลี่ยนรหัสผ่าน'
    });
    return;
  }

  const currentPwd = (currentUser.password !== undefined && currentUser.password !== null) ? String(currentUser.password) : '';
  const escapedCurrentPwd = currentPwd.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const htmlContent = `
    <div style="text-align: left; font-family: 'Prompt', 'Sarabun', sans-serif;">
      <!-- 1. รหัสผ่านเดิม (Disabled) -->
      <div style="margin-bottom: 1rem;">
        <label style="display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; font-weight: 600; color: #334155; margin-bottom: 0.35rem;">
          <span><i class="fa-solid fa-lock" style="color: #64748b;"></i> รหัสผ่านเดิม (Current Password)</span>
          <span style="font-size: 0.725rem; font-weight: normal; color: #64748b; background: #e2e8f0; padding: 0.1rem 0.45rem; border-radius: 4px;">รหัสเดิมที่ใช้งานอยู่</span>
        </label>
        <div style="position: relative; display: flex; align-items: center;">
          <input type="password" id="swalCurPwd" value="${escapedCurrentPwd}" disabled readonly style="width: 100%; padding: 0.55rem 2.5rem 0.55rem 0.75rem; border: 1px solid #cbd5e1; border-radius: 8px; background: #f1f5f9; color: #64748b; cursor: not-allowed; font-size: 0.9rem; box-sizing: border-box;">
          <button type="button" onclick="toggleSwalPwd('swalCurPwd', this)" style="position: absolute; right: 8px; background: transparent; border: none; color: #64748b; cursor: pointer; padding: 4px; font-size: 0.95rem;">
            <i class="fa-solid fa-eye"></i>
          </button>
        </div>
      </div>

      <!-- 2. รหัสผ่านใหม่ -->
      <div style="margin-bottom: 0.65rem;">
        <label style="display: block; font-size: 0.85rem; font-weight: 600; color: #334155; margin-bottom: 0.35rem;">
          <i class="fa-solid fa-shield-halved" style="color: #0284c7;"></i> รหัสผ่านใหม่ (New Password) <span style="color: #dc2626;">*</span>
        </label>
        <div style="position: relative; display: flex; align-items: center;">
          <input type="password" id="swalNewPwd" placeholder="ป้อนรหัสผ่านใหม่ (ภาษาอังกฤษเท่านั้น)" autocomplete="new-password" style="width: 100%; padding: 0.55rem 2.5rem 0.55rem 0.75rem; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.9rem; box-sizing: border-box;">
          <button type="button" onclick="toggleSwalPwd('swalNewPwd', this)" style="position: absolute; right: 8px; background: transparent; border: none; color: #64748b; cursor: pointer; padding: 4px; font-size: 0.95rem;">
            <i class="fa-solid fa-eye"></i>
          </button>
        </div>
        <div id="swalNewPwdWarn" style="display: none; color: #dc2626; font-size: 0.75rem; margin-top: 0.25rem; font-weight: 500;">
          <i class="fa-solid fa-triangle-exclamation"></i> อนุญาตให้พิมพ์เฉพาะตัวอักษรภาษาอังกฤษ ตัวเลข และอักขระพิเศษเท่านั้น (ห้ามใช้ภาษาไทย)
        </div>
      </div>

      <!-- 3. เงื่อนไขความปลอดภัย (Interactive Checklist) -->
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.65rem 0.85rem; margin-bottom: 0.85rem; font-size: 0.775rem;">
        <div style="font-weight: 600; color: #475569; margin-bottom: 0.35rem; display: flex; align-items: center; gap: 0.35rem;">
          <i class="fa-solid fa-circle-info" style="color: #0284c7;"></i> เงื่อนไขความปลอดภัยของรหัสผ่าน:
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.25rem 0.5rem;">
          <div id="swalReqLen" style="color: #64748b;"><i class="fa-solid fa-circle-xmark" style="color: #94a3b8;"></i> 8 ตัวอักษรขึ้นไป</div>
          <div id="swalReqUpper" style="color: #64748b;"><i class="fa-solid fa-circle-xmark" style="color: #94a3b8;"></i> พิมพ์ใหญ่ (A-Z)</div>
          <div id="swalReqLower" style="color: #64748b;"><i class="fa-solid fa-circle-xmark" style="color: #94a3b8;"></i> พิมพ์เล็ก (a-z)</div>
          <div id="swalReqNum" style="color: #64748b;"><i class="fa-solid fa-circle-xmark" style="color: #94a3b8;"></i> ตัวเลข (0-9)</div>
          <div id="swalReqSpecial" style="grid-column: span 2; color: #64748b;"><i class="fa-solid fa-circle-xmark" style="color: #94a3b8;"></i> อักขระพิเศษ (!@#$%^&*()_+-= เป็นต้น)</div>
          <div id="swalReqEnOnly" style="grid-column: span 2; color: #64748b;"><i class="fa-solid fa-circle-xmark" style="color: #94a3b8;"></i> ภาษาอังกฤษเท่านั้น (ห้ามมีภาษาไทย)</div>
        </div>
      </div>

      <!-- 4. ยืนยันรหัสผ่านใหม่อีกครั้ง -->
      <div style="margin-bottom: 0.25rem;">
        <label style="display: block; font-size: 0.85rem; font-weight: 600; color: #334155; margin-bottom: 0.35rem;">
          <i class="fa-solid fa-check-double" style="color: #059669;"></i> ยืนยันรหัสผ่านใหม่อีกครั้ง (Confirm Password) <span style="color: #dc2626;">*</span>
        </label>
        <div style="position: relative; display: flex; align-items: center;">
          <input type="password" id="swalConfirmPwd" placeholder="ป้อนรหัสผ่านใหม่อีกครั้ง" autocomplete="new-password" style="width: 100%; padding: 0.55rem 2.5rem 0.55rem 0.75rem; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.9rem; box-sizing: border-box;">
          <button type="button" onclick="toggleSwalPwd('swalConfirmPwd', this)" style="position: absolute; right: 8px; background: transparent; border: none; color: #64748b; cursor: pointer; padding: 4px; font-size: 0.95rem;">
            <i class="fa-solid fa-eye"></i>
          </button>
        </div>
        <div id="swalConfirmMatchMsg" style="display: none; font-size: 0.75rem; margin-top: 0.25rem; font-weight: 500;"></div>
      </div>
    </div>
  `;

  Swal.fire({
    title: '<i class="fa-solid fa-key" style="color: #eab308;"></i> เปลี่ยนรหัสผ่านผู้ใช้งาน',
    html: htmlContent,
    showCancelButton: true,
    confirmButtonText: '<i class="fa-solid fa-floppy-disk"></i> ยืนยันเปลี่ยนรหัสผ่าน',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#1e3a8a',
    cancelButtonColor: '#64748b',
    width: '460px',
    focusConfirm: false,
    didOpen: () => {
      const newPwdInput = document.getElementById('swalNewPwd');
      const confirmPwdInput = document.getElementById('swalConfirmPwd');
      const warnEl = document.getElementById('swalNewPwdWarn');
      const matchMsg = document.getElementById('swalConfirmMatchMsg');

      const filterThaiAndNonEnglish = (inputEl) => {
        const raw = inputEl.value;
        const cleaned = raw.replace(/[^A-Za-z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/g, '');
        if (raw !== cleaned) {
          inputEl.value = cleaned;
          if (warnEl) {
            warnEl.style.display = 'block';
            clearTimeout(warnEl._timer);
            warnEl._timer = setTimeout(() => { warnEl.style.display = 'none'; }, 3000);
          }
        }
      };

      const preventThaiKey = (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const allowed = ['Backspace', 'Tab', 'Enter', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Delete', 'Home', 'End'];
        if (allowed.includes(e.key)) return;
        if (e.key.length === 1 && !/^[A-Za-z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]$/.test(e.key)) {
          e.preventDefault();
          if (warnEl) {
            warnEl.style.display = 'block';
            clearTimeout(warnEl._timer);
            warnEl._timer = setTimeout(() => { warnEl.style.display = 'none'; }, 3000);
          }
        }
      };

      const updateChecklist = () => {
        const val = newPwdInput ? newPwdInput.value : '';
        const hasLen = val.length >= 8;
        const hasUpper = /[A-Z]/.test(val);
        const hasLower = /[a-z]/.test(val);
        const hasNum = /[0-9]/.test(val);
        const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(val);
        const hasEnOnly = val.length > 0 && /^[A-Za-z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]+$/.test(val);

        const setReq = (id, ok, labelText) => {
          const el = document.getElementById(id);
          if (!el) return;
          if (ok) {
            el.style.color = '#059669';
            el.innerHTML = `<i class="fa-solid fa-circle-check" style="color: #059669;"></i> ${labelText}`;
          } else {
            el.style.color = '#64748b';
            el.innerHTML = `<i class="fa-solid fa-circle-xmark" style="color: #94a3b8;"></i> ${labelText}`;
          }
        };

        setReq('swalReqLen', hasLen, '8 ตัวอักษรขึ้นไป');
        setReq('swalReqUpper', hasUpper, 'พิมพ์ใหญ่ (A-Z)');
        setReq('swalReqLower', hasLower, 'พิมพ์เล็ก (a-z)');
        setReq('swalReqNum', hasNum, 'ตัวเลข (0-9)');
        setReq('swalReqSpecial', hasSpecial, 'อักขระพิเศษ (!@#$%^&*()_+-= เป็นต้น)');
        setReq('swalReqEnOnly', hasEnOnly, 'ภาษาอังกฤษเท่านั้น (ห้ามมีภาษาไทย)');

        // Check match
        if (confirmPwdInput && confirmPwdInput.value) {
          matchMsg.style.display = 'block';
          if (confirmPwdInput.value === val) {
            matchMsg.style.color = '#059669';
            matchMsg.innerHTML = '<i class="fa-solid fa-circle-check"></i> รหัสผ่านตรงกันเรียบร้อย';
          } else {
            matchMsg.style.color = '#dc2626';
            matchMsg.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> รหัสผ่านไม่ตรงกัน';
          }
        } else if (matchMsg) {
          matchMsg.style.display = 'none';
        }
      };

      if (newPwdInput) {
        newPwdInput.addEventListener('keydown', preventThaiKey);
        newPwdInput.addEventListener('input', () => {
          filterThaiAndNonEnglish(newPwdInput);
          updateChecklist();
        });
      }

      if (confirmPwdInput) {
        confirmPwdInput.addEventListener('keydown', preventThaiKey);
        confirmPwdInput.addEventListener('input', () => {
          filterThaiAndNonEnglish(confirmPwdInput);
          updateChecklist();
        });
      }
    },
    preConfirm: () => {
      const newPwd = document.getElementById('swalNewPwd')?.value.trim() || '';
      const confirmPwd = document.getElementById('swalConfirmPwd')?.value.trim() || '';

      const hasLen = newPwd.length >= 8;
      const hasUpper = /[A-Z]/.test(newPwd);
      const hasLower = /[a-z]/.test(newPwd);
      const hasNum = /[0-9]/.test(newPwd);
      const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(newPwd);
      const hasEnOnly = /^[A-Za-z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]+$/.test(newPwd);

      if (!hasLen || !hasUpper || !hasLower || !hasNum || !hasSpecial || !hasEnOnly) {
        Swal.showValidationMessage('รหัสผ่านต้องเป็นภาษาอังกฤษเท่านั้น 8 ตัวขึ้นไป และต้องประกอบด้วย พิมพ์ใหญ่ พิมพ์เล็ก ตัวเลข และอักขระพิเศษ');
        return false;
      }

      if (newPwd !== confirmPwd) {
        Swal.showValidationMessage('รหัสผ่านใหม่ และ ยืนยันรหัสผ่านใหม่อีกครั้ง ไม่ตรงกัน');
        return false;
      }

      return newPwd;
    }
  }).then((result) => {
    if (result.isConfirmed && result.value) {
      const newPassword = result.value;

      // Update currentUser session
      currentUser.password = newPassword;
      sessionStorage.setItem('eredt_session', JSON.stringify(currentUser));

      // Update in localStorage users
      let users = getUsers();
      const idx = users.findIndex(u => u.username && u.username.toLowerCase() === currentUser.username.toLowerCase());
      if (idx !== -1) {
        users[idx].password = newPassword;
      } else {
        users.push({ ...currentUser, password: newPassword });
      }
      saveUsers(users);

      Swal.fire({
        icon: 'success',
        title: 'เปลี่ยนรหัสผ่านสำเร็จ',
        text: 'รหัสผ่านของคุณได้รับการอัปเดตเรียบร้อยแล้ว',
        timer: 2000,
        showConfirmButton: false
      });
    }
  });
}
window.openChangePasswordModal = openChangePasswordModal;


