/* ==========================================================================
   e-REDT System - Pure JavaScript Application Engine (Web App Version)
 * ศาลจังหวัดอุดรธานี — ระบบผัดฟ้องฝากขังออนไลน์
   ========================================================================== */

// Configure PDF.js Worker if available
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
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
  const seconds = now.getSeconds();
  const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')} น.`;

  if (isWknd) {
    return { isOpen: false, reason: 'weekend', message: 'วันหยุดเสาร์-อาทิตย์ (ปิดรับยื่น)', timeStr };
  }
  if (isHoli) {
    const holiObj = (holidays || []).find(h => h.date === nowISO);
    return { isOpen: false, reason: 'holiday', message: `วันหยุดราชการ (${holiObj ? holiObj.name : 'วันหยุด'})`, timeStr };
  }
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;
  const cutoffSeconds = FILING_CUTOFF_HOUR * 3600; // 16 * 3600 = 57600 (16:00:00)
  const startSeconds = (8 * 60 + 30) * 60;        // 08:30:00 (30600)

  if (totalSeconds < startSeconds) {
    return { isOpen: false, reason: 'before_time', message: `ระบบเปิดรับยื่นเวลา 08.30 น. (ปัจจุบัน ${timeStr})`, timeStr };
  }
  if (totalSeconds > cutoffSeconds) {
    return { isOpen: false, reason: 'past_16', message: `ถึงเวลา/เลยเวลา 16.00.01 น. แล้ว (${timeStr}) — ปิดรับยื่นทางอิเล็กทรอนิกส์`, timeStr };
  }
  return { isOpen: true, reason: 'open', message: `เปิดรับยื่นคำร้องอิเล็กทรอนิกส์ (ยื่นได้ถึง 16.00.00 น.)`, timeStr };
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
  
  // 1. ตรวจสอบเงื่อนไขวันครบกำหนดยื่น (ไม่เกิน 16.00 น. ของวัน filingDeadline)
  if (isPastCutoff(filingDeadline, now)) return false;

  // 2. ตรวจสอบช่วงเวลาทำการยื่นประจำวัน (วันหยุดราชการ / เสาร์-อาทิตย์ / หลัง 16.00 น. ของแต่ละวัน)
  const windowCheck = checkSubmissionWindow(now);
  if (!windowCheck.isOpen) return false;

  return true;
}

function uploadFile(rawCase, file, holidays, now = new Date()) {
  const fileCheck = validateUploadFile(file);
  if (!fileCheck.valid) {
    return { case: rawCase, ok: false, reason: fileCheck.reason };
  }
  if (rawCase.closed) {
    return { case: rawCase, ok: false, reason: "คดีนี้ปิดสำนวนเสร็จสิ้นแล้ว ไม่สามารถอัพโหลดไฟล์เพิ่มได้" };
  }
  const windowCheck = checkSubmissionWindow(now);
  if (!windowCheck.isOpen) {
    return { case: rawCase, ok: false, reason: windowCheck.message };
  }
  const cumulativeDays = rawCase.cumulativeDays ?? (12 * ((rawCase.k || 2) - 1));
  const { filingDeadline } = computeOccasionDeadlines(rawCase.startDate, cumulativeDays, holidays);
  if (isPastCutoff(filingDeadline, now)) {
    return { case: rawCase, ok: false, reason: "เลยเวลา 16.00 น. ของวันที่ต้องยื่นแล้ว กรุณานำคำร้องไปยื่นต่อศาลด้วยตนเอง" };
  }

  const isReupload = Boolean(rawCase.fileName || rawCase.courtFlag || rawCase.courtReturn);
  const nowISO = toISO(now);
  const history = rawCase.history ? [...rawCase.history] : [];
  history.push({
    type: isReupload ? 'reupload' : 'upload',
    title: isReupload ? 'พนักงานสอบสวนอัพโหลดไฟล์แก้ไขใหม่' : 'พนักงานสอบสวนอัพโหลดไฟล์คำร้อง',
    fileName: file.name,
    timestamp: nowISO,
    by: (typeof currentUser !== 'undefined' && currentUser) ? (currentUser.name || currentUser.username) : 'พนักงานสอบสวน'
  });

  return { 
    case: { 
      ...rawCase, 
      fileName: file.name, 
      fileUrl: file.fileUrl || '', 
      downloaded: false, 
      downloadedAt: '', 
      courtFlag: null, 
      courtReturn: null,
      reuploaded: isReupload,
      reuploadedAt: isReupload ? nowISO : '',
      uploadedAt: nowISO,
      history
    }, 
    ok: true, 
    reason: null 
  };
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
  { username: 'head-office01', password: '123456', role: 'officer', station: '', name: 'นายณัฐพงศ์ กุบแก้ว', status: 'approved' },
  { username: 'Polish-S160*', password: '$Police0124', role: 'police', station: 'สภ.เมืองอุดรธานี', name: 'พนักงานสอบสวน สภ.เมืองอุดรธานี 01', status: 'approved' },
  { username: 'Polish-T698@', password: 'kp@Tv9gH', role: 'police', station: 'สภ.เมืองอุดรธานี', name: 'พนักงานสอบสวน สภ.เมืองอุดรธานี 02', status: 'approved' },
  { username: 'Polish-C169&', password: 'u*UUi67#', role: 'police', station: 'สภ.เมืองอุดรธานี', name: 'พนักงานสอบสวน สภ.เมืองอุดรธานี 03', status: 'approved' }
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
      inMemoryUsers = null;
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
    console.warn('police initDatabase localStorage error:', e);
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
    console.warn('police getUsers localStorage error:', e);
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
    if (r.remandHistory && Array.isArray(r.remandHistory)) {
      r.remandHistory.forEach(h => {
        if (h.requestedDate && isNaN(new Date(h.requestedDate).getTime())) {
          h.requestedDate = toISO(new Date());
          modified = true;
        }
      });
    }
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
  const msg = { type, payload, timestamp: Date.now(), sender: currentUser?.role || 'police' };
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

    // Immediate Realtime Alert for Case Return to Police Officer
    if (msg.type === 'CASE_RETURNED' && msg.payload && currentUser.role === 'police') {
      const p = msg.payload;
      const isTargetPolice = (currentUser.username && p.officer && currentUser.username === p.officer) ||
                             (!p.officer && currentUser.station && currentUser.station === p.station) ||
                             (currentUser.station && currentUser.station === p.station);
      if (isTargetPolice) {
        Swal.fire({
          icon: 'warning',
          title: '⚠️ แจ้งเตือน: ศาลส่งคืนคำร้องฝากขัง!',
          html: `
            <div style="text-align: left; background: #fffbeb; border: 1.5px solid #fcd34d; border-radius: 0.75rem; padding: 1rem; margin-top: 0.5rem;">
              <div style="font-size: 1.05rem; font-weight: 700; color: #b45309; margin-bottom: 0.5rem;">
                <i class="fa-solid fa-triangle-exclamation"></i> เลขฝากขัง: <b>${p.caseNumber}</b> ${p.k ? `(ครั้งที่ ${p.k})` : ''}
              </div>
              <div style="font-size: 0.9rem; color: #1e293b; margin-bottom: 0.5rem;">
                <b>เหตุผลที่ศาลส่งคืน:</b> ${p.reason || 'เอกสารไม่ถูกต้อง กรุณาตรวจสอบและอัพโหลดใหม่'}
              </div>
              <div style="font-size: 0.825rem; color: #64748b;">
                เจ้าหน้าที่ศาลได้ตรวจสอบและส่งคืนคำร้อง เพื่อให้ท่านทำการแนบไฟล์ PDF ฉบับแก้ไขและอัพโหลดส่งใหม่อีกครั้ง
              </div>
            </div>
            <p style="font-size: 0.825rem; color: #dc2626; margin-top: 0.75rem; font-weight: 600; text-align: left;">
              <i class="fa-solid fa-clock"></i> กรุณาอัพโหลดไฟล์แก้ไขใหม่ก่อนเวลา 16.00 น.
            </p>
          `,
          confirmButtonColor: '#1e3a8a',
          confirmButtonText: '<i class="fa-solid fa-folder-open"></i> ไปที่รายการคำร้องเพื่อแนบไฟล์ใหม่',
          allowOutsideClick: false
        }).then(() => {
          if (typeof switchView === 'function') switchView('requests');
        });
      }
    }
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
  const second = thaiDate.getSeconds();

  const totalSeconds = hour * 3600 + minute * 60 + second;
  const startWindowSec = (8 * 60 + 30) * 60; // 08:30:00 (30,600s)
  const endWindowSec = 16 * 3600;            // 16:00:00 (57,600s)

  const isWeekday = (day >= 1 && day <= 5);
  const isWithinTime = (totalSeconds >= startWindowSec && totalSeconds <= endWindowSec);

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
      reason: totalSeconds > endWindowSec
        ? `ถึงเวลา/เลยเวลา 16.00.01 น. แล้ว (${dayNames[day]} เวลา ${formattedTime}) — ปิดรับการอัพโหลดคำร้อง`
        : `ระบบเปิดรับคำร้องระหว่างเวลา 08.30 - 16.00 น. เท่านั้น (${dayNames[day]} เวลา ${formattedTime})`,
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
  const timeCheck = checkTimeWindow();

  if (banner) {
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

  // อัพเดตสถานะปุ่มอัพโหลดแบบ Real-time ทุกวินาทีเมื่อถึงเวลา 16.00.01 น.
  updateLiveUploadButtonsState(timeCheck);
}

function updateLiveUploadButtonsState(timeCheck) {
  if (!timeCheck) timeCheck = checkTimeWindow();

  // 1. ปุ่ม "อัพโหลดไฟล์ PDF ทันที" บน Mobile Quick Upload Card
  const quickUploadBtn = document.getElementById('btnPoliceQuickUpload');
  if (quickUploadBtn) {
    if (!timeCheck.isOpen) {
      quickUploadBtn.disabled = true;
      quickUploadBtn.style.opacity = '0.55';
      quickUploadBtn.style.cursor = 'not-allowed';
      quickUploadBtn.style.backgroundColor = '#94a3b8';
      quickUploadBtn.style.color = '#ffffff';
      quickUploadBtn.title = 'ถึงเวลา/เลยเวลา 16.00.01 น. แล้ว ระบบปิดรับการอัพโหลดไฟล์ (ต้องนำยื่นศาลด้วยตนเอง)';
    } else {
      quickUploadBtn.disabled = false;
      quickUploadBtn.style.opacity = '1';
      quickUploadBtn.style.cursor = 'pointer';
      quickUploadBtn.style.backgroundColor = 'var(--accent-gold)';
      quickUploadBtn.style.color = '#0f172a';
      quickUploadBtn.title = 'อัพโหลดไฟล์ PDF ทันที';
    }
  }

  // 2. ปุ่มอัพโหลดทั้งหมดในตารางของตำรวจ (.btn-police-upload)
  const tableUploadBtns = document.querySelectorAll('.btn-police-upload');
  tableUploadBtns.forEach(btn => {
    if (!timeCheck.isOpen) {
      btn.disabled = true;
      btn.style.opacity = '0.55';
      btn.style.cursor = 'not-allowed';
      btn.style.backgroundColor = '#94a3b8';
      btn.style.borderColor = '#94a3b8';
      btn.title = 'ถึงเวลา/เลยเวลา 16.00.01 น. แล้ว ระบบปิดรับการอัพโหลดไฟล์';
    }
  });

  // 3. ปุ่มยืนยันใน Modal อัพโหลด (#submitRequestBtn)
  const submitModalBtn = document.getElementById('submitRequestBtn');
  if (submitModalBtn && !timeCheck.isOpen) {
    submitModalBtn.disabled = true;
    const statusDiv = document.getElementById('pdfValidationStatus');
    if (statusDiv && document.getElementById('addRequestModal')?.classList.contains('active')) {
      statusDiv.style.display = 'block';
      statusDiv.style.background = '#fee2e2';
      statusDiv.style.color = '#991b1b';
      statusDiv.innerHTML = `<i class="fa-solid fa-clock"></i> ถึงเวลา 16.00.01 น. แล้ว ระบบปิดรับการอัพโหลดคำร้องออนไลน์ กรุณานำยื่นศาลด้วยตนเอง`;
    }
  }
}
window.updateLiveUploadButtonsState = updateLiveUploadButtonsState;

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
    hasAlertedReturnedCasesSession = false;
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
  invalidateInMemoryCache();
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
  if (el) el.style.display = displayVal;
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
  
  // SPEC ข้อ 3: auto-detect ว่ายังไม่มีบัญชีศาลเลย → แสดงฟอร์ม "ตั้งค่าบัญชีแรก"
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

function renderAppLayout() {
  if (!currentUser) return;

  setElementDisplay('loginView', 'none');
  setElementDisplay('appHeader', 'flex');
  setElementDisplay('appLayoutContainer', 'flex');

  setElementText('userName', currentUser.name || '');
  setElementText('userDropdownName', currentUser.name || currentUser.username || 'พนักงานสอบสวน');
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

  // SPEC ข้อ 3: officer ทุกบัญชีมีสิทธิ์เท่ากัน (ทำหน้าที่ผู้ดูแลระบบร่วมกัน)
  const isCourt = (currentUser.role === 'officer' || currentUser.role === 'admin');
  const isPolice = (currentUser.role === 'police');

  // Setup Sidebar Menus based on Role
  setElementDisplay('navCategoryCourt', isCourt ? 'block' : 'none');
  setElementDisplay('navItemCreateBatch', 'none');
  setElementDisplay('navItemHolidays', isCourt ? 'block' : 'none');

  setElementDisplay('navCategoryPolice', isPolice ? 'block' : 'none');
  setElementDisplay('navItemStationInbox', isPolice ? 'block' : 'none');
  setElementDisplay('navItemDownloadICS', isPolice ? 'block' : 'none');

  // SPEC: เมนูจัดการผู้ใช้งานและตั้งค่าเชื่อมต่อ Google Services ทำได้สำหรับเจ้าหน้าที่ศาลทุกคน
  setElementDisplay('navCategoryAdmin', isCourt ? 'block' : 'none');
  setElementDisplay('navItemUsers', isCourt ? 'block' : 'none');
  setElementDisplay('navItemGoogleSettings', isCourt ? 'block' : 'none');

  // Setup Mobile Bottom Nav items based on Role
  setElementDisplay('mbNavQuickUpload', isPolice ? 'flex' : 'none');
  setElementDisplay('mbNavInbox', isPolice ? 'flex' : 'none');
  setElementDisplay('mbNavCreateBatch', isCourt ? 'flex' : 'none');
  setElementDisplay('mbNavAdmin', isCourt ? 'flex' : 'none');

  // Sync Button visible for all court officers
  setElementDisplay('btnSyncGoogleSheet', isCourt ? 'inline-flex' : 'none');

  // Start background auto-sync timer
  startAutoSyncTimer();
  // Check if cache TTL has expired
  checkAndAutoRefreshCache();

  // Restore Last Active View on Refresh
  let hashView = '';
  if (window.location.protocol !== 'file:') {
    hashView = (window.location.hash || '').replace('#', '').trim();
  }
  let savedView = hashView || sessionStorage.getItem('eredt_last_view') || 'dashboard';
  
  if (savedView === 'admin' && !isCourt) {
    savedView = 'dashboard';
  }
  
  switchView(savedView);
  
  // Check for any returned cases and alert the police officer upon login
  setTimeout(() => {
    checkReturnedCasesOnLogin();
  }, 400);
}

let hasAlertedReturnedCasesSession = false;

function checkReturnedCasesOnLogin() {
  if (!currentUser || currentUser.role !== 'police') return;
  if (hasAlertedReturnedCasesSession) return;
  
  const requests = getRequests();
  const returnedCases = requests.filter(r => 
    !r.closed && 
    r.courtFlag && 
    (r.officer === currentUser.username || (!r.officer && r.station === currentUser.station))
  );

  if (returnedCases.length > 0) {
    hasAlertedReturnedCasesSession = true;
    const casesHtml = returnedCases.map(c => `
      <div style="background: #fffbeb; border: 1.5px solid #fcd34d; border-radius: 0.5rem; padding: 0.75rem; margin-bottom: 0.5rem; text-align: left;">
        <div style="font-weight: 700; color: #b45309; font-size: 0.95rem;">
          <i class="fa-solid fa-triangle-exclamation"></i> เลขฝากขัง: <b>${c.caseNumber}</b> (ครั้งที่ ${c.k || 1})
        </div>
        <div style="font-size: 0.85rem; color: #1e293b; margin-top: 0.25rem;">
          <b>เหตุผลที่ศาลส่งคืน:</b> ${c.courtFlag.reason || 'เอกสารไม่ถูกต้อง กรุณาอัพโหลดไฟล์ใหม่'}
        </div>
        ${c.courtFlag.flaggedAt ? `<div style="font-size: 0.75rem; color: #78350f; margin-top: 0.2rem;">ส่งคืนเมื่อ: ${formatThaiDate(c.courtFlag.flaggedAt)}</div>` : ''}
      </div>
    `).join('');

    Swal.fire({
      icon: 'warning',
      title: '⚠️ แจ้งเตือน: มีคำร้องฝากขังถูกศาลส่งคืน!',
      html: `
        <p style="font-size: 0.9rem; color: #475569; margin-bottom: 0.75rem; text-align: left;">
          พบรายการคำร้องฝากขังของท่านจำนวน <b>${returnedCases.length}</b> รายการ ที่เจ้าหน้าที่ศาลตรวจสอบแล้วส่งคืนกลับมาให้แก้ไข:
        </p>
        <div style="max-height: 240px; overflow-y: auto;">
          ${casesHtml}
        </div>
        <p style="font-size: 0.825rem; color: #dc2626; margin-top: 0.75rem; font-weight: 600; text-align: left;">
          <i class="fa-solid fa-clock"></i> กรุณาตรวจสอบและแนบไฟล์ PDF ฉบับแก้ไขใหม่ก่อนเวลา 16.00 น. ของวันทำการ
        </p>
      `,
      confirmButtonColor: '#1e3a8a',
      confirmButtonText: '<i class="fa-solid fa-folder-open"></i> ไปที่รายการคำร้อง',
      allowOutsideClick: false
    }).then(() => {
      if (typeof switchView === 'function') switchView('requests');
    });
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
  setElementDisplay('requestsView', 'none');
  setElementDisplay('adminView', 'none');

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
      renderCourtView();
    }
  } else if (viewName === 'admin') {
    const isCourt = currentUser && (currentUser.role === 'officer' || currentUser.role === 'admin');
    if (!isCourt) {
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
    // กรองเฉพาะ สภ. ตนเอง และเฉพาะสำนวนคดีที่ตนเองรับผิดชอบ
    filteredCases = enrichedCases.filter(c => isMyPoliceCase(c, currentUser));
    setElementText('dashboardSubtitle', `สภ.: ${currentUser.station || 'ไม่ระบุ'} | พนักงานสอบสวน: คุณ${currentUser.name || currentUser.username} (แสดงเฉพาะสำนวนคดีในความรับผิดชอบ)`);
    setElementText('dashStatTotalLabel', 'คดีในความรับผิดชอบของฉัน');
  } else {
    setElementText('dashboardSubtitle', `คำนวณวันยื่นล่วงหน้า 1 วันทำการและเวลาตัดยื่น 16.00 น. ตามระเบียบศาลจังหวัดอุดรธานี พ.ศ. 2569`);
    setElementText('dashStatTotalLabel', 'คดีทั้งหมดของ สภ.');
  }

  // Dashboard filtering rule:
  // แสดงเฉพาะรายการที่ยังไม่ดำเนินการอัพโหลดไฟล์ (!c.fileName) และรายการที่ยังไม่มีการดาวน์โหลดไฟล์ (!c.downloaded)
  // หากมีการดาวน์โหลดไฟล์แล้ว (c.downloaded === true) หรือปิดคดีแล้ว (c.closed === true) ให้ตัดออกจากรายการในแดชบอร์ด
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

    // Cases matching filingDeadline or legalDeadline
    const filingCases = cases.filter(c => c.filingDeadline === dayISO && !c.closed);
    const legalCases = cases.filter(c => c.legalDeadline === dayISO && !c.closed);
    const totalDayCases = cases.filter(c => c.filingDeadline === dayISO || c.legalDeadline === dayISO);

    const badgesContainer = document.createElement('div');
    badgesContainer.className = 'calendar-badges-container';

    if (filingCases.length > 0) {
      const fBadge = document.createElement('div');
      fBadge.className = 'calendar-count-badge badge-filing';
      fBadge.innerHTML = `<span><i class="fa-solid fa-clock"></i> ต้องยื่น</span> <span class="count-number-pill">${filingCases.length}</span>`;
      badgesContainer.appendChild(fBadge);
    }

    if (legalCases.length > 0) {
      const lBadge = document.createElement('div');
      lBadge.className = 'calendar-count-badge badge-legal';
      lBadge.innerHTML = `<span><i class="fa-solid fa-gavel"></i> ครบกำหนด</span> <span class="count-number-pill">${legalCases.length}</span>`;
      badgesContainer.appendChild(lBadge);
    }

    if (totalDayCases.length > 0) {
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

  let filtered = enriched.filter(c => c.filingDeadline === dayISO || c.legalDeadline === dayISO);
  const isPolice = (currentUser && currentUser.role === 'police');
  if (isPolice) {
    // กรองเฉพาะ สภ. ตนเอง และเฉพาะคดีที่ตนเองรับผิดชอบ
    filtered = filtered.filter(c => isMyPoliceCase(c, currentUser));
  }

  const dateTitle = formatThaiDate(dayISO, true);
  const now = new Date();
  const timeCheck = checkSubmissionWindow(now);
  const isToday = (dayISO === toISO(now));

  if (filtered.length === 0) {
    Swal.fire({
      icon: 'info',
      title: `<i class="fa-solid fa-calendar-day" style="color: var(--primary);"></i> ประจำวันที่ ${dateTitle}`,
      html: `
        <div style="font-size: 0.95rem; color: #475569; padding: 0.5rem 0;">
          ไม่มีรายการคำร้องผัดฟ้องฝากขังในความรับผิดชอบของท่านในวันนี้
        </div>
        ${isPolice ? `<div style="font-size: 0.8rem; color: #94a3b8; margin-top: 0.25rem;">(สภ.: ${currentUser.station || 'ไม่ระบุ'} | พนักงานสอบสวน: คุณ${currentUser.name || currentUser.username})</div>` : ''}
      `,
      confirmButtonText: 'ตกลง',
      confirmButtonColor: '#1e3a8a'
    });
    return;
  }

  let tableHtml = '';

  if (!isPolice) {
    // ฝั่งศาล: แสดงตารางแยกตาม สภ.
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
    // ฝั่งตำรวจ: แสดงเฉพาะสำนวนของตนเอง พร้อมปุ่มอัพโหลดไฟล์และตรวจสอบเวลา 16.00 น.
    const bannerStatusHtml = `
      <div style="background: ${timeCheck.isOpen ? '#ecfdf5' : '#fef2f2'}; border: 1px solid ${timeCheck.isOpen ? '#a7f3d0' : '#fecaca'}; color: ${timeCheck.isOpen ? '#065f46' : '#991b1b'}; padding: 0.6rem 0.85rem; border-radius: 0.5rem; font-size: 0.825rem; font-weight: 600; margin-bottom: 0.75rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.4rem; text-align: left;">
        <div>
          <i class="${timeCheck.isOpen ? 'fa-solid fa-clock-check' : 'fa-solid fa-clock-rotate-left'}"></i>
          <span><b>สถานะเวลายื่นคำร้อง:</b> ${timeCheck.message}</span>
        </div>
        <div style="font-family: monospace; font-size: 0.875rem; font-weight: 700; color: #1e3a8a;">
          เวลาปัจจุบัน: ${timeCheck.timeStr}
        </div>
      </div>
    `;

    let rowsHtml = filtered.map(c => {
      const typeBadge = c.type === 'ยฝ.' ? '<span class="badge badge-type-yf">ยฝ.</span>' : '<span class="badge badge-type-f">ฝ.</span>';
      
      // ตรวจสอบเงื่อนไขการอัพโหลดไฟล์ (เวลาต้องไม่เกิน 16.00 น. ของวันทำการ)
      const isPast = isPastCutoff(c.filingDeadline, now);
      const isClosedTime = isPast;

      let actionHtml = '';
      if (c.closed) {
        let closedTimeInfo = '';
        if (c.closedAt) {
          const cDate = new Date(c.closedAt);
          closedTimeInfo = `<div style="font-size: 0.7rem; color: #dc2626; margin-top: 0.2rem; font-weight: 700;"><i class="fa-solid fa-clock"></i> เสร็จสิ้น: ${formatThaiDate(c.closedAt)} ${cDate.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.</div>`;
        }
        actionHtml = `
          <div style="text-align: left;">
            <span class="badge badge-status-closed" style="background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; font-size: 0.75rem; padding: 0.25rem 0.5rem; display: inline-flex; align-items: center; gap: 0.25rem;">
              <i class="fa-solid fa-lock"></i> เสร็จสิ้นการฝากขังแล้ว
            </span>
            ${closedTimeInfo}
          </div>
        `;
      } else if (c.status === 'downloaded') {
        actionHtml = `
          <div style="display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
            <span class="badge badge-status-downloaded"><i class="fa-solid fa-circle-check"></i> ศาลรับเรื่องแล้ว</span>
            ${c.fileName ? `
              <button onclick="Swal.close(); previewPdfFile('${c.caseNumber}', event);" type="button" class="btn-secondary" style="padding: 0.2rem 0.45rem; font-size: 0.75rem; width: auto; background-color: #0284c7; color: #fff;" title="ดูไฟล์ PDF ที่แนบไว้">
                <i class="fa-solid fa-file-pdf"></i>
              </button>
            ` : ''}
          </div>
        `;
      } else if (c.courtFlag) {
        actionHtml = `
          <div style="display: flex; flex-direction: column; gap: 0.25rem; text-align: left;">
            <span style="font-size: 0.75rem; color: #dc2626; font-weight: 700;"><i class="fa-solid fa-triangle-exclamation"></i> ศาลแจ้งไฟล์ผิด</span>
            <div style="display: flex; gap: 0.3rem;">
              <button onclick="Swal.close(); openUploadModal('${c.caseNumber}');" type="button" class="btn-primary" style="padding: 0.25rem 0.55rem; font-size: 0.75rem; width: auto; background-color: #dc2626; border-color: #dc2626;">
                <i class="fa-solid fa-cloud-arrow-up"></i> แนบไฟล์ใหม่
              </button>
              ${c.fileName ? `
                <button onclick="Swal.close(); previewPdfFile('${c.caseNumber}', event);" type="button" class="btn-secondary" style="padding: 0.2rem 0.45rem; font-size: 0.75rem; width: auto;" title="ดูไฟล์เดิม">
                  <i class="fa-solid fa-file-pdf"></i>
                </button>
              ` : ''}
            </div>
          </div>
        `;
      } else {
        if (isClosedTime) {
          actionHtml = `
            <div style="display: flex; flex-direction: column; gap: 0.2rem; text-align: left;">
              <button disabled type="button" class="btn-secondary" style="padding: 0.25rem 0.55rem; font-size: 0.75rem; width: auto; opacity: 0.6; cursor: not-allowed; background-color: #94a3b8; border-color: #94a3b8; color: #fff;" title="เลยเวลา 16.00 น. ของวันครบกำหนดยื่นในระบบแล้ว ต้องนำเอกสารไปยื่นต่อศาลด้วยตนเอง">
                <i class="fa-solid fa-lock"></i> เลย 16.00 น. (ปิดรับ)
              </button>
              ${c.fileName ? `
                <button onclick="Swal.close(); previewPdfFile('${c.caseNumber}', event);" type="button" class="btn-secondary" style="padding: 0.2rem 0.45rem; font-size: 0.75rem; width: auto; background-color: #0284c7; color: #fff;" title="ดูไฟล์ PDF">
                  <i class="fa-solid fa-file-pdf"></i> ดูไฟล์
                </button>
              ` : ''}
            </div>
          `;
        } else {
          actionHtml = `
            <div style="display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
              <button onclick="Swal.close(); openUploadModal('${c.caseNumber}');" type="button" class="btn-primary" style="padding: 0.25rem 0.6rem; font-size: 0.75rem; width: auto; background-color: #2563eb; border-color: #2563eb;">
                <i class="fa-solid fa-cloud-arrow-up"></i> ${c.fileName ? 'อัพโหลดทับ' : 'อัพโหลด PDF'}
              </button>
              ${c.fileName ? `
                <button onclick="Swal.close(); previewPdfFile('${c.caseNumber}', event);" type="button" class="btn-secondary" style="padding: 0.2rem 0.45rem; font-size: 0.75rem; width: auto; background-color: #0284c7; color: #fff;" title="ดูตัวอย่างไฟล์ PDF">
                  <i class="fa-solid fa-file-pdf"></i>
                </button>
              ` : ''}
            </div>
          `;
        }
      }

      let downloadBadgeInModal = '';
      if (c.downloaded && c.downloadedAt) {
        downloadBadgeInModal = `<div style="font-size: 0.7rem; color: #059669; font-weight: 600; margin-top: 0.2rem;"><i class="fa-solid fa-circle-check"></i> ศาลโหลด: ${formatThaiDate(c.downloadedAt)} ${new Date(c.downloadedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.</div>`;
      }

      return `
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 0.6rem 0.4rem;">${typeBadge}</td>
          <td style="padding: 0.6rem 0.4rem;"><b>${c.caseNumber}</b></td>
          <td style="padding: 0.6rem 0.4rem;">ครั้งที่ ${c.k}</td>
          <td style="padding: 0.6rem 0.4rem;"><b style="color: #b45309;">${formatThaiDate(c.filingDeadline)}</b></td>
          <td style="padding: 0.6rem 0.4rem;">${formatThaiDate(c.legalDeadline)}</td>
          <td style="padding: 0.6rem 0.4rem;">
            ${renderStatusBadge(c.status)}
            ${downloadBadgeInModal}
          </td>
          <td style="padding: 0.6rem 0.4rem;">${actionHtml}</td>
        </tr>
      `;
    }).join('');

    tableHtml = `
      <div style="text-align: left; margin-top: 0.25rem;">
        ${bannerStatusHtml}
        <div style="max-height: 380px; overflow-y: auto;">
          <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
            <thead>
              <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; text-align: left;">
                <th style="padding: 0.5rem 0.4rem;">ประเภท</th>
                <th style="padding: 0.5rem 0.4rem;">เลขฝากขัง</th>
                <th style="padding: 0.5rem 0.4rem;">ครั้งที่</th>
                <th style="padding: 0.5rem 0.4rem;">ต้องยื่นภายใน</th>
                <th style="padding: 0.5rem 0.4rem;">ครบกำหนดจริง</th>
                <th style="padding: 0.5rem 0.4rem;">สถานะ</th>
                <th style="padding: 0.5rem 0.4rem;">อัพโหลดคำร้อง</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  Swal.fire({
    title: `<i class="fa-solid fa-calendar-day" style="color: var(--primary);"></i> รายการคำร้องประจำวันที่ ${dateTitle}`,
    html: tableHtml,
    width: window.innerWidth < 768 ? '95%' : (isPolice ? '740px' : '760px'),
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
        <td style="white-space: nowrap; width: 1%;">
          <div class="table-actions-cell">
            <button onclick="claimForMe('${c.caseNumber}', event)" type="button" class="btn-police-upload-inline" style="background-color: #1e3a8a !important; border-color: #1d4ed8 !important;">
              <i class="fa-solid fa-hand-holding-hand"></i> รับเป็นเจ้าของคดี
            </button>
            <button onclick="openReturnModal('${c.caseNumber}')" type="button" class="btn-police-return-inline" title="คืนสำนวนกลับกองกลางศาล">
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
  const isDesktop = (window.innerWidth > 768);
  const rawRequests = getRequests();
  const holidays = getHolidays();
  const enriched = rawRequests.map(r => enrichCase(r, holidays));

  let myCases = enriched.filter(c => isMyPoliceCase(c, currentUser));

  // Sort newest to oldest as default (ใหม่สุดไปหาเก่าสุด)
  myCases.sort((a, b) => {
    const dateA = a.createdAt || a.startDate || a.filingDeadline || '';
    const dateB = b.createdAt || b.startDate || b.filingDeadline || '';
    if (dateB !== dateA) return dateB.localeCompare(dateA);
    return (b.caseNumber || '').localeCompare(a.caseNumber || '', undefined, { numeric: true });
  });

  // Destroy existing DataTable instance before re-populating
  if (typeof jQuery !== 'undefined' && typeof jQuery.fn.DataTable !== 'undefined') {
    jQuery.fn.dataTable.ext.errMode = 'none';
    const tableEl = $('#policeRequestsDataTable');
    if (tableEl.length && $.fn.DataTable.isDataTable(tableEl)) {
      tableEl.DataTable().destroy();
    }
  }

  const tbody = document.getElementById('policeTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (myCases.length === 0) {
    if (!isDesktop) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">ยังไม่มีคดีในความรับผิดชอบของคุณ (กดรับคดีจากกล่องจดหมายสถานีด้านบน)</td></tr>`;
    }
  } else {
    myCases.forEach(c => {
      const typeBadge = c.type === 'ยฝ.' ? '<span class="badge badge-type-yf">ยฝ.</span>' : '<span class="badge badge-type-f">ฝ.</span>';
      const isPast = isPastCutoff(c.filingDeadline);

      let actionButtons = '';
      if (!c.closed) {
        const windowCheck = checkSubmissionWindow();
        const isClosedTime = isPast || !windowCheck.isOpen;

        if (c.fileName) {
          // File HAS been uploaded -> Show Preview PDF + re-upload & return
          actionButtons += `
            <button onclick="previewPdfFile('${c.caseNumber}', event)" type="button" class="btn-police-preview-inline" title="ดูตัวอย่างไฟล์ PDF">
              <i class="fa-solid fa-file-pdf"></i> ดู PDF
            </button>
          `;

          const canReupload = !isClosedTime && !c.closed;
          actionButtons += `
            <button ${canReupload ? `onclick="openUploadModal('${c.caseNumber}')"` : 'disabled'} type="button" class="btn-police-upload-inline" style="${canReupload ? '' : 'opacity: 0.55; cursor: not-allowed; background-color: #94a3b8 !important; border-color: #94a3b8 !important;'}" title="${isClosedTime ? 'เลยเวลา 16.00 น. ไม่สามารถอัพโหลดทับได้' : 'อัพโหลดไฟล์ใหม่ทับของเดิม'}">
              <i class="fa-solid fa-upload"></i> อัพโหลดทับ
            </button>
          `;

          if (!c.history || c.history.length === 0) {
            actionButtons += `
              <button onclick="openReturnModal('${c.caseNumber}')" type="button" class="btn-police-return-inline" title="คืนสำนวนกลับกองกลางศาล">
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
              <button onclick="openUploadModal('${c.caseNumber}')" type="button" class="btn-police-upload-inline" title="แนบไฟล์คำร้องฝากขัง">
                <i class="fa-solid fa-upload"></i> อัพโหลด PDF
              </button>
            `;
            if (!c.history || c.history.length === 0) {
              actionButtons += `
                <button onclick="openReturnModal('${c.caseNumber}')" type="button" class="btn-police-return-inline" title="คืนสำนวนกลับกองกลางศาล">
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

      // Format วันที่ศาลดาวน์โหลด
      let downloadStatusCell = '-';
      if (c.downloaded && c.downloadedAt) {
        const dlDate = new Date(c.downloadedAt);
        const dlTimeStr = dlDate.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
        downloadStatusCell = `
          <span class="badge badge-status-downloaded" style="font-size: 0.75rem; white-space: nowrap; display: inline-flex; align-items: center; gap: 0.25rem;">
            <i class="fa-solid fa-circle-check"></i> ${formatThaiDate(c.downloadedAt)} ${dlTimeStr} น.
          </span>
        `;
      } else if (c.downloaded) {
        downloadStatusCell = `
          <span class="badge badge-status-downloaded" style="font-size: 0.75rem; white-space: nowrap;">
            <i class="fa-solid fa-circle-check"></i> ดาวน์โหลดแล้ว
          </span>
        `;
      } else if (c.fileName) {
        downloadStatusCell = `
          <span class="badge badge-status-uploaded" style="font-size: 0.75rem; white-space: nowrap;">
            <i class="fa-solid fa-clock"></i> รอศาลดาวน์โหลด
          </span>
        `;
      } else {
        downloadStatusCell = `<span style="color: var(--text-muted); font-size: 0.8rem; white-space: nowrap;">ยังไม่อัพโหลด</span>`;
      }

      const tr = document.createElement('tr');
      tr.onclick = (e) => {
        if (window.innerWidth <= 768 && !e.target.closest('button')) {
          openMobileCaseActionModal(c.caseNumber);
        }
      };
      tr.innerHTML = `
        <td data-order="${c.type || ''}">${typeBadge}</td>
        <td data-order="${c.caseNumber || ''}"><b>${c.caseNumber}</b></td>
        <td data-order="${c.k || 1}">ครั้งที่ ${c.k}</td>
        <td data-order="${c.filingDeadline || ''}"><b style="color: #b45309;">${formatThaiDate(c.filingDeadline)}</b></td>
        <td data-order="${c.legalDeadline || ''}">${formatThaiDate(c.legalDeadline)}</td>
        <td data-order="${c.cap || 84}">${c.cap || 84} วัน (${c.cap === 48 ? 4 : (c.cap === 12 ? 1 : 7)} ครั้ง)</td>
        <td data-order="${c.status || ''}">
          ${renderStatusBadge(c.status)}
          ${c.fileName ? `<br><small style="color: var(--text-muted);">${c.fileName}</small>` : ''}
          ${flagWarning}
        </td>
        <td data-order="${c.downloadedAt || (c.downloaded ? '1' : '0')}">${downloadStatusCell}</td>
        <td style="white-space: nowrap; width: 1%;">
          <div class="table-actions-cell">
            ${actionButtons}
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Initialize DataTables for desktop & tablet landscape screens (> 768px)
  if (isDesktop && typeof jQuery !== 'undefined' && typeof jQuery.fn.DataTable !== 'undefined') {
    jQuery.fn.dataTable.ext.errMode = 'none';
    const tableEl = $('#policeRequestsDataTable');
    if (tableEl.length) {
      const dtInstance = tableEl.DataTable({
        pageLength: 25,
        lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, "ทั้งหมด"]],
        order: [], // Preserves newest-to-oldest pre-sorted order
        language: {
          search: "ค้นหา:",
          lengthMenu: "แสดง _MENU_ รายการต่อหน้า",
          info: "แสดง _START_ ถึง _END_ จากทั้งหมด _TOTAL_ รายการ",
          infoEmpty: "แสดง 0 ถึง 0 จาก 0 รายการ",
          infoFiltered: "(กรองจากทั้งหมด _MAX_ รายการ)",
          zeroRecords: "ไม่พบรายการคำร้องฝากขังตรงตามเงื่อนไขการค้นหา",
          emptyTable: "ไม่มีรายการข้อมูลคำร้องฝากขังในความรับผิดชอบ",
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

      // Connect custom search input to DataTable
      $('#policeSearchInput').off('input').on('input', function() {
        dtInstance.search(this.value).draw();
      });
    }
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
      title: 'คดีนี้เสร็จสิ้นแล้ว',
      text: 'คดีนี้ปิดสำนวนเสร็จสิ้นการฝากขังแล้ว ไม่สามารถอัพโหลดไฟล์ได้'
    });
    return;
  }

  const now = new Date();
  const isPast = isPastCutoff(c.filingDeadline, now);
  if (isPast) {
    Swal.fire({
      icon: 'warning',
      title: 'เลยกำหนดเวลายื่นคำร้อง',
      html: `<div style="text-align: left; font-size: 0.9rem; color: #334155; line-height: 1.6;">
              <p style="color: #dc2626; font-weight: 700; margin-bottom: 0.5rem;"><i class="fa-solid fa-clock"></i> เลยเวลา 16.00 น. ของวันครบกำหนดยื่นในระบบแล้ว (${formatThaiDate(c.filingDeadline)})</p>
              <p style="color: #b45309; font-weight: 600;">* ท่านต้องนำเอกสารคำร้องยื่นผัดฟ้องฝากขังไปยื่นต่อศาลด้วยตนเองเท่านั้น</p>
             </div>`,
      confirmButtonText: 'รับทราบ',
      confirmButtonColor: '#1e3a8a'
    });
    return;
  }

  const windowCheck = checkSubmissionWindow(now);
  if (!windowCheck.isOpen) {
    Swal.fire({
      icon: 'warning',
      title: 'นอกเวลาให้บริการยื่นคำร้อง',
      html: `<div style="text-align: left; font-size: 0.9rem; color: #334155; line-height: 1.6;">
              <p style="color: #dc2626; font-weight: 700; margin-bottom: 0.5rem;"><i class="fa-solid fa-clock"></i> ${windowCheck.message}</p>
              <p style="color: #475569;">ระบบเปิดให้อัพโหลดคำร้องในวันทำการเฉพาะช่วงเวลา <b>08.30 - 16.00 น.</b> เท่านั้น</p>
              <p style="color: #b45309; font-weight: 600;">* หากมีความจำเป็นเร่งด่วน กรุณานำเอกสารไปยื่นต่อศาลด้วยตนเอง</p>
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
  const now = new Date();
  const isPast = targetCase ? isPastCutoff(targetCase.filingDeadline, now) : false;
  const windowCheck = checkSubmissionWindow(now);

  if (isPast || targetCase.closed || !windowCheck.isOpen) {
    closeModal('addRequestModal');
    let errTitle = 'ไม่สามารถอัพโหลดไฟล์ได้';
    let errMsg = 'ขณะนี้เลยเวลา 16.00 น. หรือปิดรับยื่นคำร้องออนไลน์แล้ว กรุณานำเอกสารยื่นต่อศาลด้วยตนเอง';
    if (targetCase.closed) {
      errMsg = 'คดีนี้ปิดสำนวนเสร็จสิ้นการฝากขังแล้ว ไม่สามารถดำเนินการต่อได้';
    } else if (isPast) {
      errMsg = `เลยเวลา 16.00 น. ของวันครบกำหนดยื่นในระบบแล้ว (${formatThaiDate(targetCase.filingDeadline)}) กรุณานำเอกสารไปยื่นต่อศาลด้วยตนเอง`;
    } else if (!windowCheck.isOpen) {
      errTitle = 'นอกเวลาให้บริการยื่นคำร้อง';
      errMsg = `${windowCheck.message} (ระบบเปิดให้อัพโหลดคำร้องในวันทำการ เวลา 08.30 - 16.00 น.)`;
    }

    Swal.fire({
      icon: 'error',
      title: errTitle,
      text: errMsg
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

function renderCourtView() {
  if (!currentUser) return;

  const curYear = new Date().getFullYear();
  const beYear = curYear < 2400 ? curYear + 543 : curYear;
  const batchYearInput = document.getElementById('batchYearInput');
  if (batchYearInput && !batchYearInput.value) batchYearInput.value = beYear;

  setThaiDatePickerValue('batchStartDateInput', new Date());

  const rawRequests = getRequests();
  const holidays = getHolidays();
  const enriched = rawRequests.map(r => enrichCase(r, holidays));

  // Populate Station dropdown filter
  const stationSelect = document.getElementById('courtStationFilter');
  if (stationSelect && stationSelect.options.length <= 1) {
    stationSelect.innerHTML = `<option value="">ทุกสถานีตำรวจ (23 สภ.)</option>`;
    UDON_STATIONS.forEach(st => {
      stationSelect.innerHTML += `<option value="${st}">${st}</option>`;
    });
  }

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

  renderCourtRequestsTable();
}

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
    renderCourtView();
    Swal.fire({ icon: 'success', title: 'จับคู่สถานีเรียบร้อย', text: `จับคู่เลขคดี ${caseNumber} กับ ${station} สำเร็จ`, timer: 1200, showConfirmButton: false });
  }
}

function renderCourtRequestsTable() {
  if (!currentUser) return;
  const stationFilter = (document.getElementById('courtStationFilter')?.value || '').trim();
  const statusFilter = (document.getElementById('courtStatusFilter')?.value || '').trim();
  const searchTerm = (document.getElementById('courtSearchInput')?.value || '').toLowerCase().trim();

  const rawRequests = getRequests();
  const holidays = getHolidays();
  const enriched = rawRequests.map(r => enrichCase(r, holidays));

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

  const tbody = document.getElementById('courtTableBody');
  tbody.innerHTML = '';

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">ไม่พบรายการคำร้องฝากขังตรงตามเงื่อนไขการค้นหา</td></tr>`;
  } else {
    filtered.forEach(c => {
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

      let fileCell = '-';
      if (c.fileName) {
        fileCell = `
          <button onclick="downloadCourtFile('${c.caseNumber}')" class="btn-secondary" style="padding: 0.25rem 0.55rem; font-size: 0.75rem; width: auto;">
            <i class="fa-solid fa-file-pdf" style="color: #dc2626;"></i> ${c.fileName}
          </button>
        `;
      }

      let courtActions = '';
      if (!c.closed) {
        const canReceive = c.fileName && c.downloaded && !c.courtFlag;
        courtActions += `
          <button onclick="openReceiveModal('${c.caseNumber}')" class="btn-primary" style="padding: 0.25rem 0.55rem; font-size: 0.75rem; width: auto; background-color: #059669; border-color: #059669;" ${canReceive ? '' : 'disabled'}>
            <i class="fa-solid fa-check-double"></i> ยืนยันรับเรื่อง
          </button>
        `;
        if (c.fileName) {
          courtActions += `
            <button onclick="openFlagModal('${c.caseNumber}')" class="btn-secondary" style="padding: 0.25rem 0.55rem; font-size: 0.75rem; width: auto; background-color: #dc2626; border-color: #dc2626; color: #fff; margin-left: 0.2rem;">
              <i class="fa-solid fa-flag"></i> แจ้งไฟล์ผิด
            </button>
          `;
        }
      } else {
        courtActions = `<span class="badge badge-status-closed">ปิดคดีแล้ว</span>`;
      }

      const tr = document.createElement('tr');
      tr.onclick = (e) => {
        if (window.innerWidth <= 768 && !e.target.closest('button') && !e.target.closest('a')) {
          openMobileCaseActionModal(c.caseNumber);
        }
      };
      tr.innerHTML = `
        <td>${typeBadge}</td>
        <td><b>${c.caseNumber}</b></td>
        <td>${c.station || '<span style="color:#d97706;">รอจับคู่</span>'} ${returnedBadge}</td>
        <td>
          ${c.officer || '<span style="color:#b45309;">ไม่มีเจ้าของ</span>'}
          ${(!c.closed && c.station) ? `<button onclick="openTransferModal('${c.caseNumber}')" class="btn-secondary" style="padding: 0.15rem 0.35rem; font-size: 0.7rem; width: auto; margin-left: 0.25rem;" title="โอนย้ายคดีให้พนักงานสอบสวนอื่น"><i class="fa-solid fa-arrow-right-arrow-left"></i></button>` : ''}
        </td>
        <td>ครั้งที่ ${c.k}</td>
        <td><b style="color: #b45309;">${formatThaiDate(c.filingDeadline)}</b></td>
        <td>${formatThaiDate(c.legalDeadline)}</td>
        <td>
          ${c.cap || 84} วัน
          ${!c.closed ? `<button onclick="openEditCapModal('${c.caseNumber}')" class="btn-secondary" style="padding: 0.15rem 0.35rem; font-size: 0.7rem; width: auto; margin-left: 0.25rem;" title="แก้ไขเพดานฝากขัง"><i class="fa-solid fa-pen"></i></button>` : ''}
        </td>
        <td>${renderStatusBadge(c.status)}</td>
        <td>${fileCell}</td>
        <td>${courtActions}</td>
      `;
      tbody.appendChild(tr);
    });
  }
}

function downloadCourtFile(caseNumber) {
  const requests = getRequests();
  const index = requests.findIndex(r => r.caseNumber === caseNumber);
  if (index !== -1) {
    requests[index].downloaded = true;
    requests[index].downloadedAt = new Date().toISOString();
    saveRequests(requests);

    if (requests[index].fileUrl) {
      window.open(requests[index].fileUrl, '_blank');
    } else {
      Swal.fire({ icon: 'info', title: 'ดาวน์โหลดไฟล์สำเร็จ', text: `ศาลเปิดดาวน์โหลดไฟล์ ${requests[index].fileName} เรียบร้อยแล้ว` });
    }
    renderCourtRequestsTable();
  }
}

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

  // User requirement confirmation prompt
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

function openHolidayModal(event) {
  if (event) event.preventDefault();
  
  if (window.innerWidth < 768 && typeof Swal !== 'undefined' && Swal.isVisible && Swal.isVisible()) {
    Swal.close();
  }

  const el = document.getElementById('holidayModal');
  if (el) el.classList.add('active');
  renderHolidayTable();

  const dateInput = document.getElementById('holidayDateInput');
  if (dateInput) {
    const realToday = new Date();
    if (dateInput._flatpickr) {
      dateInput._flatpickr.setDate(realToday, true);
    } else {
      dateInput.value = toISO(realToday);
      attachThaiDatePicker(dateInput);
    }
  }
}

function renderHolidayTable() {
  const holidays = getHolidays();
  const tbody = document.getElementById('holidayTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  holidays.forEach((h, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><b>${formatThaiDate(h.date, true)}</b></td>
      <td>${h.name}</td>
      <td>
        <div style="display: flex; gap: 0.35rem; align-items: center;">
          <button onclick="editHoliday(${index})" class="btn-secondary" style="padding: 0.25rem 0.55rem; font-size: 0.75rem; background-color: #2563eb; color: #fff; border: none; border-radius: 0.35rem; cursor: pointer; display: inline-flex; align-items: center; gap: 0.25rem;">
            <i class="fa-solid fa-pen-to-square"></i> แก้ไข
          </button>
          <button onclick="deleteHoliday(${index})" class="btn-secondary" style="padding: 0.25rem 0.55rem; font-size: 0.75rem; background-color: #dc2626; color: #fff; border: none; border-radius: 0.35rem; cursor: pointer; display: inline-flex; align-items: center; gap: 0.25rem;">
            <i class="fa-solid fa-trash"></i> ลบ
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
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
      renderHolidayTable();
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

function handleAddHoliday(event) {
  event.preventDefault();
  const dateRaw = document.getElementById('holidayDateInput')?.value || '';
  const date = toISO(dateRaw);
  const name = (document.getElementById('holidayNameInput')?.value || '').trim();

  const holidays = getHolidays();
  if (holidays.some(h => h.date === date)) {
    Swal.fire({ icon: 'error', title: 'วันหยุดซ้ำซ้อน', text: 'วันหยุดนี้มีอยู่ในระบบแล้ว' });
    return;
  }

  holidays.push({ date, name });
  holidays.sort((a, b) => a.date.localeCompare(b.date));
  saveHolidays(holidays);
  const dateInput = document.getElementById('holidayDateInput');
  if (dateInput) {
    const realToday = new Date();
    if (dateInput._flatpickr) {
      dateInput._flatpickr.setDate(realToday, true);
    } else {
      dateInput.value = toISO(realToday);
      attachThaiDatePicker(dateInput);
    }
  }
  setElementValue('holidayNameInput', '');
  renderHolidayTable();
  if (currentActiveView === 'dashboard') renderDashboard();
}

function deleteHoliday(index) {
  const holidays = getHolidays();
  holidays.splice(index, 1);
  saveHolidays(holidays);
  renderHolidayTable();
  if (currentActiveView === 'dashboard') renderDashboard();
}

function generatePoliceUsername() {
  const users = getUsers();
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const specialChars = "!@#$%&";
  let username = "";
  let attempts = 0;

  do {
    const letter = letters.charAt(Math.floor(Math.random() * letters.length));
    
    const digits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    for (let i = digits.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [digits[i], digits[j]] = [digits[j], digits[i]];
    }
    const threeDigits = `${digits[0]}${digits[1]}${digits[2]}`;

    const special = specialChars.charAt(Math.floor(Math.random() * specialChars.length));

    username = `Police-${letter}${threeDigits}${special}`;
    attempts++;
  } while (users.some(u => u.username === username) && attempts < 1000);

  return username;
}

function generateAndSetPoliceUsername() {
  const newUsername = generatePoliceUsername();
  const input = document.getElementById('modalUsernameInput');
  if (input) input.value = newUsername;
}

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

function openGoogleSettingsModal(event) {
  if (event) {
    try { if (typeof event.preventDefault === 'function') event.preventDefault(); } catch (e) {}
    try { if (typeof event.stopPropagation === 'function') event.stopPropagation(); } catch (e) {}
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

  // Auto-close SweetAlert on mobile screens (< 768px)
  if (window.innerWidth < 768 && typeof Swal !== 'undefined' && Swal.isVisible && Swal.isVisible()) {
    Swal.close();
  }

  const csvEl = document.getElementById('googleSheetUrlInput');
  const scriptEl = document.getElementById('googleScriptUrlInput');
  const folderEl = document.getElementById('googleDriveFolderInput') || document.getElementById('googleFolderIdInput');

  if (csvEl) csvEl.value = localStorage.getItem('eredt_google_csv') || DEFAULT_GOOGLE_SHEET_CSV;
  if (scriptEl) scriptEl.value = localStorage.getItem('eredt_google_script') || DEFAULT_GOOGLE_SCRIPT_WEBAPP;
  if (folderEl) folderEl.value = localStorage.getItem('eredt_drive_folder') || DEFAULT_DRIVE_FOLDER_ID;

  openModal('googleSettingsModal');
}
window.openGoogleSettingsModal = openGoogleSettingsModal;

function openConfigGuideModal(event) {
  if (event) {
    try { if (typeof event.preventDefault === 'function') event.preventDefault(); } catch (e) {}
    try { if (typeof event.stopPropagation === 'function') event.stopPropagation(); } catch (e) {}
  }

  if (window.innerWidth < 768 && typeof Swal !== 'undefined' && Swal.isVisible && Swal.isVisible()) {
    Swal.close();
  }

  openModal('configGuideModal');
  switchConfigGuideTab('overview');
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
    else if (currentActiveView === 'requests') {
      if (currentUser && currentUser.role === 'police') renderPoliceView();
      else renderCourtView();
    } else if (currentActiveView === 'admin') {
      if (currentUser && currentUser.role !== 'police') renderAdminView();
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
          <button onclick="Swal.close(); openFlagModal('${enriched.caseNumber}');" class="btn-secondary" style="width: 100%; background-color: #dc2626; border-color: #dc2626; color: #fff; margin-bottom: 0.5rem;">
            <i class="fa-solid fa-flag"></i> แจ้งไฟล์ผิด
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
        ${enriched.closed ? `<div style="margin-top: 0.5rem; color: #991b1b; font-weight: 700; background: #fee2e2; padding: 0.45rem 0.65rem; border-radius: 0.375rem; border: 1px solid #fca5a5;"><i class="fa-solid fa-lock"></i> <b>เสร็จสิ้นการฝากขัง:</b> ${enriched.closedAt ? formatThaiDate(enriched.closedAt) + ' ' + new Date(enriched.closedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' น.' : 'ปิดสำนวนแล้ว'}</div>` : ''}
        ${enriched.downloaded && enriched.downloadedAt ? `<div style="margin-top: 0.5rem; color: #059669; font-weight: 600;"><i class="fa-solid fa-circle-check"></i> <b>ศาลดาวน์โหลดล่าสุด:</b> ${formatThaiDate(enriched.downloadedAt)} ${new Date(enriched.downloadedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.</div>` : ''}
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


function downloadStationBatch(dateStr, stationName) {
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

  Swal.fire({
    title: 'กำลังดาวน์โหลดไฟล์...',
    text: `กำลังดาวน์โหลด ${targetCases.length} ไฟล์ของ ${stationName}...`,
    allowOutsideClick: false,
    didOpen: () => { Swal.showLoading(); }
  });

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
      requests[reqIndex].downloadedAt = new Date().toISOString();
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
let resizeTimeout = null;
window.addEventListener('resize', () => {
  if (resizeTimeout) clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    if (typeof currentActiveView !== 'undefined' && currentActiveView === 'requests') {
      renderPoliceTable();
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
      setElementText('userDropdownName', currentUser.name || currentUser.username || 'พนักงานสอบสวน');
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

