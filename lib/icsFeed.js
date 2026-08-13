/**
 * icsFeed.js
 * ---------------------------------------------------------------------------
 * สร้างไฟล์ปฏิทิน iCalendar (.ics) มาตรฐาน RFC 5545 จากรายการคดีของพนักงานสอบสวน
 *
 * นี่คือเนื้อหาแบบเดียวกับที่ "ลิงก์ปฏิทินส่วนตัว" (แบบ B ที่คุยกันไว้) จะส่งออกมาให้
 * แอปปฏิทิน (Google Calendar / Apple Calendar / Outlook) ดึงไปแสดงอัตโนมัติ — ต่างกันแค่
 * ในระบบจริง เนื้อหานี้จะถูกสร้างสดๆ ทุกครั้งที่แอปปฏิทินมาขอ (ผ่าน URL คงที่ 1 เส้นต่อคน)
 * แทนที่จะเป็นไฟล์ดาวน์โหลดครั้งเดียวแบบนี้
 * ---------------------------------------------------------------------------
 */

// หนี comma, semicolon, backslash, ขึ้นบรรทัดใหม่ ตามข้อกำหนด RFC 5545
function escapeICSText(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

// พับบรรทัดที่ยาวเกิน 75 octet ตามข้อกำหนด (บรรทัดถัดไปต้องขึ้นต้นด้วยช่องว่าง)
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
  const [y, m, d] = isoDate.split("-");
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return `${y}${m}${d}T${hh}${mm}00`;
}

function nowStampUTC(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
}

/**
 * สร้าง VEVENT หนึ่งรายการ สำหรับคดีหนึ่งครั้งที่ต้องยื่น
 * ใช้ filingDeadline เป็นวันนัด เวลา 09:00–10:00 น. (ช่วงที่ต้องเตรียมยื่นก่อนตัด 16.00 น.)
 * ใส่ VALARM เตือนล่วงหน้า 1 วัน ซ้ำอีกครั้งตอนเช้าวันนั้นเอง
 */
function buildEvent(caseItem, now) {
  const uid = `case-${caseItem.caseNumber}-k${caseItem.k}@udon-remand-tracker`.replace(/[^a-zA-Z0-9@.\-]/g, "");
  const dtStart = toICSDateTime(caseItem.filingDeadline, 9, 0);
  const dtEnd = toICSDateTime(caseItem.filingDeadline, 10, 0);
  const summary = escapeICSText(`ครบกำหนดยื่นคำร้องฝากขัง เลขคดี ${caseItem.caseNumber} ครั้งที่ ${caseItem.k}`);
  const description = escapeICSText(
    `สถานี: ${caseItem.station}\nต้องยื่นภายในเวลา 16.00 น. ของวันนี้ (ข้อ 6 ระเบียบศาลจังหวัดอุดรธานี)\nครบกำหนดฝากขังจริง: ${caseItem.legalDeadline}`
  );

  const lines = [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${nowStampUTC(now)}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${escapeICSText(caseItem.station)}`,
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

/**
 * สร้างไฟล์ .ics ทั้งไฟล์จากรายการคดี (ปกติคือคดีของพนักงานคนหนึ่ง ที่ยังไม่ยื่น/ยังไม่ปิด)
 * @param {Array} cases รายการคดีที่ enrich แล้ว (ต้องมี filingDeadline, legalDeadline, caseNumber, k, station)
 * @param {string} calendarName ชื่อปฏิทินที่จะแสดงในแอป เช่น "คำร้องฝากขัง - ร.ต.อ.สมชาย ใจดี"
 * @param {Date} [now]
 */
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
  const events = cases
    .filter((c) => !c.closed && c.filingDeadline)
    .map((c) => buildEvent(c, now));
  const footer = ["END:VCALENDAR"];

  return [...header, ...events, ...footer].join("\r\n") + "\r\n";
}

module.exports = { generateICS, buildEvent, escapeICSText, foldLine, toICSDateTime };
