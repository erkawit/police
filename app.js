/* ==========================================================================
   e-REDT System - Pure JavaScript Application Engine (Web App Version)
 * ศาลจังหวัดอุดรธานี — ระบบผัดฟ้องฝากขังออนไลน์
   ========================================================================== */

// Configure PDF.js Worker if available
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

const SPREADSHEET_ID = '1Y-OA9B8cPRwTcILCB9lmLny2GrfcEnNqR5i07lTGDM4';
const DEFAULT_GOOGLE_SHEET_CSV = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/pub?output=csv`;
const DEFAULT_GOOGLE_SCRIPT_WEBAPP = '';
const DEFAULT_DRIVE_FOLDER_ID = '1l5ZDlXI14lgFc6WGqmZ3kQ9qB-ci-ArM';

// --------------------------------------------------------------------------
// 1. LEGAL LOGIC ENGINE (ตรรกะกฎหมาย และระเบียบศาลจังหวัดอุดรธานี พ.ศ. 2569)
// --------------------------------------------------------------------------

const DAYS_PER_OCCASION = 12; // ป.วิ.อาญา ม.87: ฝากขังได้ครั้งละไม่เกิน 12 วัน
const FILING_CUTOFF_HOUR = 16; // ข้อ 6: ยื่นทางระบบได้ไม่เกิน 16.00 น.
const PURGE_DAYS = 60;
const CAP_MAX_K = { 48: 4, 84: 7 };
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
  let d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) {
    if (typeof date === 'string' && date.includes('-')) {
      const parts = date.split('-');
      if (parts.length === 3) {
        d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      }
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
  if (!file.name.toLowerCase().endsWith(ALLOWED_UPLOAD_EXTENSION)) {
    return { valid: false, reason: `รองรับเฉพาะไฟล์นามสกุล ${ALLOWED_UPLOAD_EXTENSION} เท่านั้น` };
  }
  if (typeof file.sizeBytes !== "number" || !Number.isFinite(file.sizeBytes) || file.sizeBytes <= 0) {
    return { valid: false, reason: "ไม่สามารถอ่านขนาดไฟล์ได้ กรุณาลองใหม่" };
  }
  if (file.sizeBytes > MAX_UPLOAD_SIZE_BYTES) {
    const maxMB = MAX_UPLOAD_SIZE_BYTES / (1024 * 1024);
    return { valid: false, reason: `ไฟล์มีขนาดเกิน ${maxMB} MB กรุณาบีบอัดไฟล์หรือแยกเป็นหลายไฟล์แนบ` };
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
  const status = deriveStatus({ ...rawCase, filingDeadline }, now);
  return { ...rawCase, cumulativeDays, daysAvailable, rawDeadline, legalDeadline, filingDeadline, status };
}

function deriveStatus(enrichedCase, now = new Date()) {
  if (enrichedCase.closed) return "closed";
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
  return { case: { ...rawCase, fileName: file.name, fileUrl: file.fileUrl || '', downloaded: false, courtFlag: null }, ok: true, reason: null };
}

function flagWrongFile(rawCase, reason, now = new Date()) {
  if (rawCase.closed) {
    return { case: rawCase, ok: false, reason: "คดีนี้ปิดแล้ว ไม่สามารถแจ้งไฟล์ผิดได้" };
  }
  if (!rawCase.fileName) {
    return { case: rawCase, ok: false, reason: "คดีนี้ยังไม่มีไฟล์ที่อัพโหลดไว้ให้แจ้งว่าผิด" };
  }
  if (!reason || !reason.trim()) {
    return { case: rawCase, ok: false, reason: "กรุณาระบุเหตุผลที่แจ้งว่าไฟล์ผิด" };
  }
  const courtFlag = { reason: reason.trim(), flaggedAt: toISO(now) };
  return { case: { ...rawCase, courtFlag }, ok: true, reason: null };
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

  const maxK = cap === 48 ? 4 : cap === 84 ? 7 : 7;
  if (rawCase.k >= maxK) {
    return { ...rawCase, cap, cumulativeDays: newCumulativeDays, closed: true, closedDate: toISO(now), fileName: null, downloaded: false, history };
  }
  return { ...rawCase, cap, cumulativeDays: newCumulativeDays, k: rawCase.k + 1, fileName: null, downloaded: false, history };
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

const SYSTEM_ROOT_ADMIN = {
  username: 'admin',
  password: 'caogikojt02',
  name: 'ผู้ดูแลระบบสูงสุด (System Admin)',
  role: 'admin',
  status: 'approved'
};

const DEFAULT_USERS = [
  SYSTEM_ROOT_ADMIN,
  {
    username: 'officer1',
    password: 'officer1234',
    name: 'เจ้าหน้าที่ศาล สมชาย',
    role: 'officer',
    status: 'approved'
  },
  {
    username: 'police_udon',
    password: 'police1234',
    name: 'ร.ต.อ.สมชาย ใจดี',
    role: 'police',
    station: 'สภ.เมืองอุดรธานี',
    status: 'approved'
  },
  {
    username: 'police_kumphawapi',
    password: 'police1234',
    name: 'ร.ต.อ.วิชัย มีสุข',
    role: 'police',
    station: 'สภ.กุมภวาปี',
    status: 'approved'
  }
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
  if (!localStorage.getItem('eredt_users')) {
    localStorage.setItem('eredt_users', JSON.stringify(DEFAULT_USERS));
  }
  if (!localStorage.getItem('eredt_requests')) {
    localStorage.setItem('eredt_requests', JSON.stringify([]));
  }
  if (!localStorage.getItem('eredt_holidays')) {
    localStorage.setItem('eredt_holidays', JSON.stringify(DEFAULT_HOLIDAYS));
  }
  if (!localStorage.getItem('eredt_google_csv')) {
    localStorage.setItem('eredt_google_csv', DEFAULT_GOOGLE_SHEET_CSV);
  }
  if (!localStorage.getItem('eredt_google_script')) {
    localStorage.setItem('eredt_google_script', DEFAULT_GOOGLE_SCRIPT_WEBAPP);
  }
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

function getUsers() {
  let users = JSON.parse(localStorage.getItem('eredt_users') || '[]');
  if (!Array.isArray(users) || users.length === 0) {
    users = [...DEFAULT_USERS];
  }
  users = users.filter(u => u && u.username && String(u.username).trim() !== '');
  const adminIdx = users.findIndex(u => u.username === 'admin');
  if (adminIdx !== -1) {
    users[adminIdx].password = 'caogikojt02';
    users[adminIdx].role = 'admin';
    users[adminIdx].status = 'approved';
  } else {
    users.unshift(SYSTEM_ROOT_ADMIN);
  }
  return users;
}

function syncToGoogleSheet(actionName, payload) {
  const scriptUrl = localStorage.getItem('eredt_google_script');
  if (!scriptUrl) return;
  
  try {
    fetch(scriptUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: actionName, ...payload })
    }).catch(err => console.warn('Google Sheet Sync warning:', err));
  } catch (e) {
    console.warn('Google Sheet Sync error:', e);
  }
}

function saveUsers(users) {
  const validUsers = (users || []).filter(u => u && u.username && String(u.username).trim() !== '');
  const adminIdx = validUsers.findIndex(u => u.username === 'admin');
  if (adminIdx !== -1) {
    validUsers[adminIdx].password = 'caogikojt02';
    validUsers[adminIdx].role = 'admin';
    validUsers[adminIdx].status = 'approved';
  } else {
    validUsers.unshift(SYSTEM_ROOT_ADMIN);
  }
  localStorage.setItem('eredt_users', JSON.stringify(validUsers));
  syncToGoogleSheet('saveUsers', { users: validUsers });
}

function getRequests() {
  const reqs = JSON.parse(localStorage.getItem('eredt_requests') || '[]');
  // Sanitize existing cases if any contain invalid date strings
  let modified = false;
  reqs.forEach(r => {
    if (!r.startDate || r.startDate.includes('NaN')) {
      r.startDate = toISO(new Date());
      modified = true;
    }
  });
  if (modified) saveRequests(reqs);
  return reqs;
}

function saveRequests(requests) {
  localStorage.setItem('eredt_requests', JSON.stringify(requests));
  syncToGoogleSheet('saveRequests', { requests });
}

function getHolidays() {
  return JSON.parse(localStorage.getItem('eredt_holidays') || JSON.stringify(DEFAULT_HOLIDAYS));
}

function saveHolidays(holidays) {
  localStorage.setItem('eredt_holidays', JSON.stringify(holidays));
  syncToGoogleSheet('saveHolidays', { holidays });
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
  initDatabase();
  const savedUser = sessionStorage.getItem('eredt_session');
  if (savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
    } catch (e) {
      currentUser = null;
    }
  } else {
    currentUser = null;
  }

  if (currentUser) {
    renderAppLayout();
    // Only auto-sync live data from Google Sheet on refresh if user is logged in AND is ADMIN
    if (currentUser.role === 'admin') {
      fetchLiveGoogleSheetData({ isAutoRefresh: true });
    }
  } else {
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

  // 1. Permanent Root System Admin check
  if (username === 'admin' && password === 'caogikojt02') {
    currentUser = SYSTEM_ROOT_ADMIN;
    sessionStorage.setItem('eredt_session', JSON.stringify(currentUser));
    Swal.fire({
      icon: 'success',
      title: 'เข้าสู่ระบบสำเร็จ',
      text: `ยินดีต้อนรับ คุณ${currentUser.name}`,
      timer: 1500,
      showConfirmButton: false
    });
    renderAppLayout();
    fetchLiveGoogleSheetData({ isAutoRefresh: true });
    return;
  }

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
  } else {
    Swal.fire({
      icon: 'error',
      title: 'เข้าสู่ระบบไม่สำเร็จ',
      text: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง หรือไม่พบข้อมูลใน Google Sheet'
    });
  }
}

function quickLogin(roleOrUser) {
  const users = getUsers();
  let user = null;
  if (roleOrUser === 'officer1') user = users.find(u => u.username === 'officer1');
  else if (roleOrUser === 'police_udon') user = users.find(u => u.username === 'police_udon');
  else if (roleOrUser === 'police_kumphawapi') user = users.find(u => u.username === 'police_kumphawapi');
  else if (roleOrUser === 'admin') user = users.find(u => u.username === 'admin');

  if (user) {
    currentUser = user;
    sessionStorage.setItem('eredt_session', JSON.stringify(user));
    renderAppLayout();
  }
}

function handleLogout() {
  currentUser = null;
  sessionStorage.removeItem('eredt_session');
  sessionStorage.removeItem('eredt_last_view');
  if (window.location.hash) {
    history.replaceState(null, null, ' ');
  }
  showLoginView();
}

function setElementDisplay(id, displayVal) {
  const el = document.getElementById(id);
  if (el) el.style.display = displayVal;
}

function setElementText(id, textVal) {
  const el = document.getElementById(id);
  if (el) el.textContent = textVal;
}

function setElementClass(id, className, isAdd) {
  const el = document.getElementById(id);
  if (el) {
    if (isAdd) el.classList.add(className);
    else el.classList.remove(className);
  }
}

function showLoginView() {
  setElementDisplay('loginView', 'flex');
  setElementDisplay('appHeader', 'none');
  setElementDisplay('appLayoutContainer', 'none');
}

function renderAppLayout() {
  if (!currentUser) return;

  setElementDisplay('loginView', 'none');
  setElementDisplay('appHeader', 'flex');
  setElementDisplay('appLayoutContainer', 'flex');

  setElementText('userName', currentUser.name || '');

  const roleNames = { admin: 'ผู้ดูแลระบบ', officer: 'เจ้าหน้าที่ศาล', police: 'พนักงานสอบสวน' };
  setElementText('userRoleBadge', roleNames[currentUser.role] || currentUser.role);

  // Theme styling
  if (currentUser.role === 'police') {
    document.body.className = 'theme-police';
  } else {
    document.body.className = '';
  }

  // Setup Sidebar Menus based on Role
  setElementDisplay('navCategoryCourt', (currentUser.role === 'officer' || currentUser.role === 'admin') ? 'block' : 'none');
  setElementDisplay('navItemCreateBatch', (currentUser.role === 'officer' || currentUser.role === 'admin') ? 'block' : 'none');
  setElementDisplay('navItemHolidays', (currentUser.role === 'officer' || currentUser.role === 'admin') ? 'block' : 'none');

  setElementDisplay('navCategoryPolice', (currentUser.role === 'police') ? 'block' : 'none');
  setElementDisplay('navItemStationInbox', (currentUser.role === 'police') ? 'block' : 'none');
  setElementDisplay('navItemDownloadICS', (currentUser.role === 'police') ? 'block' : 'none');

  setElementDisplay('navCategoryAdmin', (currentUser.role === 'admin') ? 'block' : 'none');
  setElementDisplay('navItemUsers', (currentUser.role === 'admin') ? 'block' : 'none');
  setElementDisplay('navItemGoogleSettings', (currentUser.role === 'admin') ? 'block' : 'none');

  // Setup Mobile Bottom Nav items based on Role
  setElementDisplay('mbNavQuickUpload', (currentUser.role === 'police') ? 'flex' : 'none');
  setElementDisplay('mbNavInbox', (currentUser.role === 'police') ? 'flex' : 'none');
  setElementDisplay('mbNavCreateBatch', (currentUser.role === 'officer' || currentUser.role === 'admin') ? 'flex' : 'none');
  setElementDisplay('mbNavAdmin', (currentUser.role === 'admin') ? 'flex' : 'none');

  // Control Sync Button Visibility (Admin only)
  setElementDisplay('btnSyncGoogleSheet', (currentUser.role === 'admin') ? 'inline-flex' : 'none');

  // Restore Last Active View on Refresh
  const hashView = (window.location.hash || '').replace('#', '').trim();
  let savedView = hashView || sessionStorage.getItem('eredt_last_view') || 'dashboard';
  
  if (savedView === 'admin' && currentUser.role !== 'admin') {
    savedView = 'dashboard';
  }
  
  switchView(savedView);
}

function switchView(viewName, event, subTab) {
  if (event) event.preventDefault();

  currentActiveView = viewName;
  sessionStorage.setItem('eredt_last_view', viewName);
  
  try {
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, null, '#' + viewName);
    } else {
      window.location.hash = viewName;
    }
  } catch (e) {
    // Ignore origin frame navigation warnings on file://
  }

  setElementDisplay('dashboardView', 'none');
  setElementDisplay('requestsView', 'none');
  setElementDisplay('adminView', 'none');

  setElementClass('navItemDashboard', 'active', false);
  setElementClass('navItemRequests', 'active', false);
  setElementClass('navItemUsersLink', 'active', false);

  // Clear Mobile Bottom Nav Active Classes
  ['mbNavDashboard', 'mbNavRequests', 'mbNavQuickUpload', 'mbNavInbox', 'mbNavCreateBatch', 'mbNavAdmin'].forEach(id => {
    setElementClass(id, 'active', false);
  });

  if (viewName === 'dashboard') {
    setElementDisplay('dashboardView', 'block');
    setElementClass('navItemDashboard', 'active', true);
    setElementClass('mbNavDashboard', 'active', true);
    renderDashboard();
  } else if (viewName === 'requests') {
    setElementDisplay('requestsView', 'block');
    setElementClass('navItemRequests', 'active', true);
    
    if (subTab === 'inbox') {
      setElementClass('mbNavInbox', 'active', true);
    } else {
      setElementClass('mbNavRequests', 'active', true);
    }

    if (currentUser && currentUser.role === 'police') {
      setElementDisplay('policeRequestsSection', 'block');
      setElementDisplay('courtRequestsSection', 'none');
      renderPoliceView();
    } else {
      setElementDisplay('policeRequestsSection', 'none');
      setElementDisplay('courtRequestsSection', 'block');
      renderCourtView();
    }
  } else if (viewName === 'admin') {
    setElementDisplay('adminView', 'block');
    setElementClass('navItemUsersLink', 'active', true);
    setElementClass('mbNavAdmin', 'active', true);
    renderAdminView();
  }
}

// --------------------------------------------------------------------------
// 7. DASHBOARD & CALENDAR ENGINE
// --------------------------------------------------------------------------

function renderDashboard() {
  if (!currentUser) return;
  const rawRequests = getRequests();
  const holidays = getHolidays();
  const enrichedCases = rawRequests.map(r => enrichCase(r, holidays));

  let filteredCases = enrichedCases;
  if (currentUser.role === 'police') {
    filteredCases = enrichedCases.filter(c => c.officer === currentUser.username || c.station === currentUser.station);
    document.getElementById('dashboardSubtitle').textContent = `ติดตามกำหนดเวลาสำหรับ สภ.: ${currentUser.station || 'ไม่ระบุ'}`;
  } else {
    document.getElementById('dashboardSubtitle').textContent = `คำนวณวันยื่นล่วงหน้า 1 วันทำการและเวลาตัดยื่น 16.00 น. ตามระเบียบศาลจังหวัดอุดรธานี พ.ศ. 2569`;
  }

  document.getElementById('dashStatTotal').textContent = filteredCases.length;
  
  const dueCases = filteredCases.filter(c => !c.closed && (c.status === 'due' || c.status === 'overdue'));
  document.getElementById('dashStatDue').textContent = dueCases.length;

  const downloadedCases = filteredCases.filter(c => c.status === 'downloaded' || c.closed);
  document.getElementById('dashStatDownloaded').textContent = downloadedCases.length;

  renderCalendar(filteredCases);
  renderMobileTodayList(filteredCases);
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
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const thaiYear = year < 2400 ? year + 543 : year;
  document.getElementById('calendarMonthTitle').textContent = `${THAI_MONTHS_FULL[month]} ${thaiYear}`;

  const firstDay = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();

  const gridContainer = document.getElementById('calendarGridDays');
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
  if (currentUser.role === 'police') {
    filtered = filtered.filter(c => c.station === currentUser.station);
  }

  document.getElementById('dayDetailTitle').textContent = `รายการคำร้องประจำวันที่ ${formatThaiDate(dayISO, true)}`;
  const tbody = document.getElementById('dayDetailTableBody');
  tbody.innerHTML = '';

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">ไม่มีรายการคำร้องในวันนี้</td></tr>`;
  } else {
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
        <td>
          ${c.fileName ? `<a href="${c.fileUrl || '#'}" target="_blank" class="btn-secondary" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;"><i class="fa-solid fa-file-pdf"></i> เปิดไฟล์</a>` : '-'}
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  openModal('dayDetailModal');
}

// --------------------------------------------------------------------------
// 8. POLICE WORKFLOW & STATION INBOX
// --------------------------------------------------------------------------

function renderPoliceView() {
  if (!currentUser) return;
  startLiveClock();
  setElementText('policeStationSub', `สังกัด: ${currentUser.station || 'ไม่ระบุ'}`);

  const rawRequests = getRequests();
  const holidays = getHolidays();
  const enriched = rawRequests.map(r => enrichCase(r, holidays));

  // 1. Station Inbox: Unassigned cases for police's station
  const stationInbox = enriched.filter(c => c.station === currentUser.station && !c.officer && !c.closed);
  document.getElementById('stationInboxCount').textContent = `${stationInbox.length} คดีรอรับ`;

  const inboxTbody = document.getElementById('stationInboxTableBody');
  inboxTbody.innerHTML = '';

  if (stationInbox.length === 0) {
    inboxTbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">ไม่มีคดีใหม่รอรับเป็นเจ้าของในกล่องจดหมายสถานี</td></tr>`;
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
          <button onclick="claimForMe('${c.caseNumber}')" class="btn-primary" style="padding: 0.3rem 0.75rem; font-size: 0.8rem; width: auto;">
            <i class="fa-solid fa-hand-holding-hand"></i> รับเป็นเจ้าของคดี
          </button>
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
      const timeCheck = checkTimeWindow();
      const isPast = isPastCutoff(c.filingDeadline);

      let actionButtons = '';
      if (!c.closed) {
        if (isPast) {
          actionButtons = `<span style="font-size: 0.75rem; color: #dc2626; font-weight: 600;"><i class="fa-solid fa-ban"></i> เลย 16.00 น. ต้องยื่นที่ศาลด้วยตนเอง</span>`;
        } else {
          actionButtons = `
            <button onclick="openUploadModal('${c.caseNumber}')" class="btn-primary" style="padding: 0.3rem 0.65rem; font-size: 0.75rem; width: auto;">
              <i class="fa-solid fa-upload"></i> ${c.fileName ? 'อัพโหลดไฟล์ใหม่ทับ' : 'อัพโหลด PDF'}
            </button>
          `;
          if (!c.history || c.history.length === 0) {
            actionButtons += `
              <button onclick="openReturnModal('${c.caseNumber}')" class="btn-secondary" style="padding: 0.3rem 0.65rem; font-size: 0.75rem; width: auto; background-color: #d97706; border-color: #d97706; margin-left: 0.3rem;">
                <i class="fa-solid fa-rotate-left"></i> คืนสำนวน
              </button>
            `;
          }
        }
      } else {
        actionButtons = `<span class="badge badge-status-closed">ปิดคดีแล้ว</span>`;
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
        <td>${actionButtons}</td>
      `;
      tbody.appendChild(tr);
    });
  }
}

function claimForMe(caseNumber) {
  const requests = getRequests();
  const index = requests.findIndex(r => r.caseNumber === caseNumber);
  if (index !== -1) {
    requests[index].officer = currentUser.username;
    saveRequests(requests);
    Swal.fire({ icon: 'success', title: 'รับเป็นเจ้าของคดีเรียบร้อย', timer: 1200, showConfirmButton: false });
    renderPoliceView();
  }
}

function openUploadModal(caseNumber) {
  const requests = getRequests();
  const c = requests.find(r => r.caseNumber === caseNumber);
  if (!c) return;

  document.getElementById('uploadCaseNumber').value = c.caseNumber;
  document.getElementById('uploadCaseNumberDisplay').textContent = `เลขคดี: ${c.caseNumber}`;
  document.getElementById('uploadCaseInfoDisplay').textContent = `ครั้งที่ ${c.k} | สภ.: ${c.station || 'ไม่ระบุ'}`;

  selectedFile = null;
  document.getElementById('pdfFileInput').value = '';
  document.getElementById('dropzoneText').textContent = 'คลิก หรือ ลากไฟล์ PDF มาวางที่นี่';
  document.getElementById('pdfValidationStatus').style.display = 'none';
  document.getElementById('submitRequestBtn').disabled = true;

  openModal('addRequestModal');
}

function triggerMobileQuickUpload(event) {
  if (event) event.preventDefault();
  if (!currentUser) return;

  const rawRequests = getRequests();
  const holidays = getHolidays();
  const enriched = rawRequests.map(r => enrichCase(r, holidays));

  // Find cases for police officer station that need upload
  let pendingCases = enriched.filter(c => 
    (!c.closed) && 
    (!c.fileName || c.courtFlag) && 
    (currentUser.role === 'police' ? (c.officer === currentUser.username || c.station === currentUser.station) : true)
  );

  if (pendingCases.length === 1) {
    openUploadModal(pendingCases[0].caseNumber);
    return;
  }

  if (pendingCases.length > 1) {
    let optionsHtml = pendingCases.map(c => `
      <div style="padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 0.6rem; margin-bottom: 0.5rem; text-align: left; display: flex; justify-content: space-between; align-items: center; background: #ffffff;">
        <div>
          <div style="font-weight: 700; color: var(--primary); font-size: 0.95rem;">${c.type} ${c.caseNumber} (ครั้งที่ ${c.k})</div>
          <div style="font-size: 0.75rem; color: #b45309; margin-top: 0.15rem;"><i class="fa-solid fa-clock"></i> ยื่นภายใน: ${formatThaiDate(c.filingDeadline)}</div>
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

  let allUserCases = enriched.filter(c => 
    !c.closed && 
    (currentUser.role === 'police' ? (c.officer === currentUser.username || c.station === currentUser.station) : true)
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
  } else {
    Swal.fire({
      icon: 'info',
      title: 'ไม่พบรายการคดี',
      text: 'ขณะนี้ไม่มีคดีอยู่ในรายการรับผิดชอบของท่าน'
    });
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

  const scriptUrl = localStorage.getItem('eredt_google_script');
  const driveFolderId = localStorage.getItem('eredt_drive_folder') || DEFAULT_DRIVE_FOLDER_ID;
  const targetCase = requests[index];

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
  document.getElementById('returnCaseNumber').value = caseNumber;
  document.getElementById('returnReasonInput').value = '';
  openModal('returnToPoolModal');
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

  const myCases = enriched.filter(c => c.officer === currentUser.username || c.station === currentUser.station);
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
  // Populate Station dropdown filter
  const stationSelect = document.getElementById('courtStationFilter');
  if (stationSelect && stationSelect.options.length <= 1) {
    stationSelect.innerHTML = `<option value="">ทุกสถานีตำรวจ (23 สภ.)</option>`;
    UDON_STATIONS.forEach(st => {
      stationSelect.innerHTML += `<option value="${st}">${st}</option>`;
    });
  }

  renderCourtRequestsTable();
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
  if (statusFilter) filtered = filtered.filter(c => c.status === statusFilter);
  if (searchTerm) {
    filtered = filtered.filter(c => c.caseNumber.toLowerCase().includes(searchTerm) || (c.station && c.station.toLowerCase().includes(searchTerm)));
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
        <td>${c.officer || '-'}</td>
        <td>ครั้งที่ ${c.k}</td>
        <td><b style="color: #b45309;">${formatThaiDate(c.filingDeadline)}</b></td>
        <td>${formatThaiDate(c.legalDeadline)}</td>
        <td>${c.cap || 84} วัน</td>
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
    saveRequests(requests);

    if (requests[index].fileUrl) {
      window.open(requests[index].fileUrl, '_blank');
    } else {
      Swal.fire({ icon: 'info', title: 'ดาวน์โหลดไฟล์สำเร็จ', text: `ศาลเปิดดาวน์โหลดไฟล์ ${requests[index].fileName} เรียบร้อยแล้ว` });
    }
    renderCourtRequestsTable();
  }
}

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

function handleCreateBatch(event) {
  event.preventDefault();
  const type = document.getElementById('batchTypeSelect').value;
  const year = document.getElementById('batchYearInput').value.trim();
  const startNum = parseInt(document.getElementById('batchStartNumInput').value, 10);
  const endNum = parseInt(document.getElementById('batchEndNumInput').value, 10);
  const startDateRaw = document.getElementById('batchStartDateInput').value;
  const startDate = toISO(startDateRaw);
  const station = document.getElementById('batchStationSelect').value;

  if (startNum > endNum) {
    Swal.fire({ icon: 'error', title: 'ข้อมูลไม่ถูกต้อง', text: 'เลขเริ่มต้นต้องไม่มากกว่าเลขสิ้นสุด' });
    return;
  }

  const requests = getRequests();

  // Check duplicates
  for (let i = startNum; i <= endNum; i++) {
    const caseNo = `${type}${i}/${year}`;
    if (requests.some(r => r.caseNumber === caseNo)) {
      Swal.fire({ icon: 'error', title: 'เลขฝากขังซ้ำซ้อน', text: `เลขฝากขัง ${caseNo} มีอยู่ในระบบอยู่แล้ว` });
      return;
    }
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
      cap: 84, // Default cap 84 days
      cumulativeDays: 12, // First remand used 12 days
      station: station,
      officer: null,
      fileName: null,
      downloaded: false,
      closed: false,
      history: []
    });
  }

  saveRequests([...requests, ...newCases]);
  closeModal('createBatchModal');

  Swal.fire({
    icon: 'success',
    title: 'สร้างชุดเลขคำร้องสำเร็จ',
    text: `สร้างชุดเลข ${type}${startNum} ถึง ${type}${endNum}/${year} รวม ${newCases.length} คดี และส่งเข้ากล่องจดหมาย ${station} เรียบร้อยแล้ว`
  });

  if (currentActiveView === 'dashboard') renderDashboard();
  else renderCourtView();
}

function openReceiveModal(caseNumber) {
  const requests = getRequests();
  const c = requests.find(r => r.caseNumber === caseNumber);
  if (!c) return;

  document.getElementById('receiveCaseNumber').value = c.caseNumber;
  document.getElementById('receiveCaseNumberDisplay').textContent = `เลขคดี: ${c.caseNumber}`;
  document.getElementById('receiveCaseInfoDisplay').textContent = `ครั้งที่ ${c.k} | สภ.: ${c.station || 'ไม่ระบุ'}`;
  document.getElementById('receiveCapSelect').value = c.cap || 84;
  document.getElementById('receiveActualDaysInput').value = 12;

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
  document.getElementById('flagCaseNumber').value = caseNumber;
  document.getElementById('flagReasonInput').value = '';
  openModal('flagWrongFileModal');
}

function handleConfirmFlagWrongFile(event) {
  event.preventDefault();
  const caseNumber = document.getElementById('flagCaseNumber').value;
  const reason = document.getElementById('flagReasonInput').value;

  const requests = getRequests();
  const index = requests.findIndex(r => r.caseNumber === caseNumber);

  if (index !== -1) {
    const result = flagWrongFile(requests[index], reason);
    if (result.ok) {
      requests[index] = result.case;
      saveRequests(requests);

      closeModal('flagWrongFileModal');
      Swal.fire({ icon: 'success', title: 'ส่งคำแจ้งเตือนไฟล์ผิดเรียบร้อย', timer: 1500, showConfirmButton: false });
      renderCourtView();
    } else {
      Swal.fire({ icon: 'error', title: 'แจ้งไฟล์ผิดไม่สำเร็จ', text: result.reason });
    }
  }
}

// --------------------------------------------------------------------------
// 10. ADMIN CONTROL PANEL & HOLIDAY MANAGER
// --------------------------------------------------------------------------

function renderAdminView() {
  if (!currentUser || currentUser.role !== 'admin') return;
  const users = getUsers();
  const tbody = document.getElementById('adminUserTableBody');
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
      <td><b>${u.username}</b></td>
      <td>${u.name}</td>
      <td>${roleBadges[u.role] || u.role}</td>
      <td>${u.station || '-'}</td>
      <td><span class="badge badge-status-downloaded">อนุมัติแล้ว</span></td>
      <td>
        <button onclick="editUser('${u.username}')" class="btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;"><i class="fa-solid fa-pen-to-square"></i> แก้ไข</button>
        ${u.username !== 'admin' ? `<button onclick="deleteUser('${u.username}')" class="btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; background-color: #dc2626; color: #fff;"><i class="fa-solid fa-trash"></i> ลบ</button>` : ''}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function openHolidayModal(event) {
  if (event) event.preventDefault();
  setThaiDatePickerValue('holidayDateInput', new Date());
  renderHolidayTable();
  openModal('holidayModal');
}

function renderHolidayTable() {
  const holidays = getHolidays();
  const tbody = document.getElementById('holidayTableBody');
  tbody.innerHTML = '';

  holidays.forEach((h, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><b>${formatThaiDate(h.date)}</b></td>
      <td>${h.name}</td>
      <td>
        <button onclick="deleteHoliday(${index})" class="btn-secondary" style="padding: 0.2rem 0.5rem; font-size: 0.75rem; background-color: #dc2626; color: #fff;"><i class="fa-solid fa-trash"></i> ลบ</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function handleAddHoliday(event) {
  event.preventDefault();
  const dateRaw = document.getElementById('holidayDateInput').value;
  const date = toISO(dateRaw);
  const name = document.getElementById('holidayNameInput').value.trim();

  const holidays = getHolidays();
  if (holidays.some(h => h.date === date)) {
    Swal.fire({ icon: 'error', title: 'วันหยุดซ้ำซ้อน', text: 'วันหยุดนี้มีอยู่ในระบบแล้ว' });
    return;
  }

  holidays.push({ date, name });
  holidays.sort((a, b) => a.date.localeCompare(b.date));
  saveHolidays(holidays);

  document.getElementById('holidayDateInput').value = '';
  document.getElementById('holidayNameInput').value = '';
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
    
    // Pick 3 unique digits (0-9)
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
  document.getElementById('userModalTitle').textContent = 'เพิ่มผู้ใช้งานใหม่';
  document.getElementById('editUsernameOriginal').value = '';
  document.getElementById('modalUsernameInput').value = '';
  document.getElementById('modalNameInput').value = '';
  document.getElementById('modalPasswordInput').value = '';
  document.getElementById('modalRoleSelect').value = 'police';

  toggleStationSelect('police');
  generateAndSetPoliceUsername();
  openModal('userModal');
}

function editUser(username) {
  const users = getUsers();
  const u = users.find(user => user.username === username);
  if (!u) return;

  document.getElementById('userModalTitle').textContent = 'แก้ไขข้อมูลผู้ใช้';
  document.getElementById('editUsernameOriginal').value = u.username;
  document.getElementById('modalUsernameInput').value = u.username;
  document.getElementById('modalNameInput').value = u.name;
  document.getElementById('modalPasswordInput').value = '';
  document.getElementById('modalRoleSelect').value = u.role;

  toggleStationSelect(u.role);
  if (document.getElementById('modalStationSelectInput')) {
    document.getElementById('modalStationSelectInput').value = u.station || '';
  }

  openModal('userModal');
}

function toggleStationSelect(role) {
  const group = document.getElementById('modalStationGroup');
  const btnGen = document.getElementById('btnGenPoliceUsername');
  const isEditing = !!document.getElementById('editUsernameOriginal').value;

  if (role === 'police') {
    if (group) {
      group.style.display = 'block';
      const select = document.getElementById('modalStationSelectInput');
      select.innerHTML = UDON_STATIONS.map(st => `<option value="${st}">${st}</option>`).join('');
    }
    if (btnGen) btnGen.style.display = 'inline-flex';

    if (!isEditing && (!document.getElementById('modalUsernameInput').value || !document.getElementById('modalUsernameInput').value.startsWith('Police-'))) {
      generateAndSetPoliceUsername();
    }
  } else {
    if (group) group.style.display = 'none';
    if (btnGen) btnGen.style.display = 'none';
    if (!isEditing && document.getElementById('modalUsernameInput').value.startsWith('Police-')) {
      document.getElementById('modalUsernameInput').value = '';
    }
  }
}

function handleSaveUser(event) {
  event.preventDefault();
  const origUsername = document.getElementById('editUsernameOriginal').value;
  const username = document.getElementById('modalUsernameInput').value.trim();
  const name = document.getElementById('modalNameInput').value.trim();
  const password = document.getElementById('modalPasswordInput').value.trim();
  const role = document.getElementById('modalRoleSelect').value;
  const station = role === 'police' ? document.getElementById('modalStationSelectInput').value : null;

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
  if (username === 'admin') {
    Swal.fire({
      icon: 'error',
      title: 'ไม่สามารถลบผู้ใช้งานนี้ได้',
      text: 'บัญชี admin (รหัสผ่าน: caogikojt02) เป็นผู้ดูแลระบบหลักของระบบ ไม่สามารถลบออกจากระบบได้'
    });
    return;
  }
  Swal.fire({
    title: 'ยืนยันการลบผู้ใช้งาน?',
    text: `คุณต้องการลบผู้ใช้งาน ${username} ใช่หรือไม่`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc2626',
    confirmButtonText: 'ใช่, ลบเลย',
    cancelButtonText: 'ยกเลิก'
  }).then((res) => {
    if (res.isConfirmed) {
      const users = getUsers().filter(u => u.username !== username);
      saveUsers(users);
      renderAdminView();
      Swal.fire({ icon: 'success', title: 'ลบผู้ใช้งานสำเร็จ', timer: 1200, showConfirmButton: false });
    }
  });
}

function openGoogleSettingsModal(event) {
  if (event) event.preventDefault();
  document.getElementById('googleSheetUrlInput').value = localStorage.getItem('eredt_google_csv') || DEFAULT_GOOGLE_SHEET_CSV;
  document.getElementById('googleScriptUrlInput').value = localStorage.getItem('eredt_google_script') || DEFAULT_GOOGLE_SCRIPT_WEBAPP;
  document.getElementById('googleDriveFolderInput').value = localStorage.getItem('eredt_drive_folder') || DEFAULT_DRIVE_FOLDER_ID;
  openModal('googleSettingsModal');
}

function saveGoogleSettings(event) {
  event.preventDefault();
  const csvUrl = document.getElementById('googleSheetUrlInput').value.trim();
  const scriptUrl = document.getElementById('googleScriptUrlInput').value.trim();
  const driveFolder = document.getElementById('googleDriveFolderInput').value.trim();

  localStorage.setItem('eredt_google_csv', csvUrl);
  localStorage.setItem('eredt_google_script', scriptUrl);
  localStorage.setItem('eredt_drive_folder', driveFolder || DEFAULT_DRIVE_FOLDER_ID);
  closeModal('googleSettingsModal');

  Swal.fire({ icon: 'success', title: 'บันทึกการตั้งค่า Google Services เรียบร้อย', timer: 1500, showConfirmButton: false });
}

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
    if (r[0] && r[0].includes('-')) {
      holidays.push({ date: String(r[0]).trim(), name: String(r[1] || '').trim() });
    }
  }
  return holidays;
}

let isSyncingData = false;

async function fetchLiveGoogleSheetData(options = {}) {
  if (isSyncingData) return;
  isSyncingData = true;

  const isManual = options.isManual || false;
  const startTime = Date.now();
  const thresholdMs = 450; // Threshold: Only show SweetAlert if load takes longer than 450ms or on manual click
  let hasOpenedSwal = false;

  function updateProgress(percent, label) {
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
      try {
        const resReq = await fetch(`${scriptUrl}?action=getRequests`);
        requestsData = await resReq.json();
      } catch(e) { console.warn('Script getRequests error:', e); }

      updateProgress(65, 'กำลังโหลดข้อมูลผู้ใช้งาน...');
      try {
        const resUser = await fetch(`${scriptUrl}?action=getUsers`);
        usersData = await resUser.json();
      } catch(e) { console.warn('Script getUsers error:', e); }

      updateProgress(85, 'กำลังโหลดข้อมูลวันหยุด...');
      try {
        const resHol = await fetch(`${scriptUrl}?action=getHolidays`);
        holidaysData = await resHol.json();
      } catch(e) { console.warn('Script getHolidays error:', e); }
    }

    // 2. CSV API Fallback (Public CSV Endpoint)
    if (!requestsData || !Array.isArray(requestsData)) {
      updateProgress(40, 'กำลังโหลดข้อมูลคดีจาก Google Sheet (CSV)...');
      try {
        const csvReq = await fetch(`${csvBaseUrl}data`).then(r => r.text());
        requestsData = parseRequestsCSV(csvReq);
      } catch (e) { console.warn('CSV data fallback failed:', e); }
    }

    if (!usersData || !Array.isArray(usersData) || usersData.length === 0) {
      updateProgress(70, 'กำลังโหลดข้อมูลผู้ใช้จาก Google Sheet (CSV)...');
      try {
        const csvUser = await fetch(`${csvBaseUrl}users`).then(r => r.text());
        usersData = parseUsersCSV(csvUser);
      } catch (e) { console.warn('CSV users fallback failed:', e); }
    }

    if (!holidaysData || !Array.isArray(holidaysData)) {
      updateProgress(85, 'กำลังโหลดข้อมูลวันหยุดจาก Google Sheet (CSV)...');
      try {
        const csvHol = await fetch(`${csvBaseUrl}holidays`).then(r => r.text());
        holidaysData = parseHolidaysCSV(csvHol);
      } catch (e) { console.warn('CSV holidays fallback failed:', e); }
    }

    updateProgress(95, 'กำลังอัพเดทระบบ...');

    if (Array.isArray(requestsData)) {
      localStorage.setItem('eredt_requests', JSON.stringify(requestsData));
    }

    if (Array.isArray(usersData) && usersData.length > 0) {
      saveUsers(usersData);
    }

    if (Array.isArray(holidaysData) && holidaysData.length > 0) {
      localStorage.setItem('eredt_holidays', JSON.stringify(holidaysData));
    }

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
    }
  } catch (err) {
    console.error('Fetch live data error:', err);
    if (hasOpenedSwal) {
      Swal.fire({
        icon: 'error',
        title: 'เกิดข้อผิดพลาดในการโหลดข้อมูล',
        text: err.toString()
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

  const localeObj = getThaiFlatpickrLocale();
  if (flatpickr.localize) {
    try {
      flatpickr.localize(localeObj);
    } catch (e) {}
  }

  if (!target.value) {
    target.value = toISO(new Date());
  }

  const initialDate = target.value ? target.value : new Date();

  const fp = flatpickr(target, {
    locale: localeObj,
    dateFormat: 'Y-m-d',
    altInput: true,
    altFormat: 'j F Y',
    defaultDate: initialDate,
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
        instance.setDate(initialDate || new Date(), true);
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
        instance.setDate(initialDate || new Date(), true);
      }
      convertFlatpickrHeaderToBE(instance);
    }
  });

  if (fp && (!fp.selectedDates || fp.selectedDates.length === 0)) {
    fp.setDate(initialDate, true);
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
  const isoStr = toISO(dateVal || new Date());
  el.value = isoStr;
  if (el._flatpickr) {
    el._flatpickr.setDate(isoStr, true);
  }
}

function initThaiDatePickers() {
  if (typeof flatpickr === 'undefined') return;
  const elements = document.querySelectorAll('.thai-datepicker, input[type=date]');
  elements.forEach(el => {
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
        <button onclick="Swal.close(); claimForMe('${enriched.caseNumber}');" class="btn-primary" style="width: 100%; margin-bottom: 0.5rem;">
          <i class="fa-solid fa-hand-holding-hand"></i> รับเป็นเจ้าของคดี
        </button>
      `;
    }
    if (enriched.officer === currentUser.username && !enriched.closed) {
      const timeCheck = checkTimeWindow();
      const isPast = isPastCutoff(enriched.filingDeadline);
      if (timeCheck.allowed && !isPast) {
        actionButtonsHtml += `
          <button onclick="Swal.close(); openUploadModal('${enriched.caseNumber}');" class="btn-primary" style="width: 100%; margin-bottom: 0.5rem;">
            <i class="fa-solid fa-upload"></i> ${enriched.fileName ? 'อัพโหลดไฟล์ใหม่ทับ' : 'อัพโหลด PDF'}
          </button>
        `;
        if (!enriched.history || enriched.history.length === 0) {
          actionButtonsHtml += `
            <button onclick="Swal.close(); openReturnModal('${enriched.caseNumber}');" class="btn-secondary" style="width: 100%; background-color: #d97706; border-color: #d97706; color: #fff; margin-bottom: 0.5rem;">
              <i class="fa-solid fa-rotate-left"></i> คืนสำนวน
            </button>
          `;
        }
      }
    }
  } else {
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
      <div style="text-align: left; font-size: 0.875rem; color: #334155; line-height: 1.6; background: #f8fafc; padding: 1rem; border-radius: 0.75rem; margin-bottom: 1rem;">
        <div><b>ชื่อ-สกุล:</b> ${u.name || '-'}</div>
        <div><b>บทบาท:</b> ${roleNames[u.role] || u.role}</div>
        <div><b>สถานีตำรวจ:</b> ${u.station || '-'}</div>
        <div><b>สถานะ:</b> อนุมัติแล้ว</div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 0.5rem;">
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

document.addEventListener('DOMContentLoaded', () => {
  checkSession();
  initThaiDatePickers();
});
