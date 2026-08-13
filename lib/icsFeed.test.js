const test = require("node:test");
const assert = require("node:assert/strict");
const { generateICS, buildEvent, escapeICSText, foldLine, toICSDateTime } = require("./icsFeed");

test("escapeICSText หนี comma, semicolon, backslash ตาม RFC 5545", () => {
  assert.equal(escapeICSText("เลขคดี 1,2;3\\4"), "เลขคดี 1\\,2\\;3\\\\4");
});

test("foldLine ไม่แตะบรรทัดที่สั้นกว่า 75 ตัวอักษร", () => {
  const short = "SUMMARY:สั้นๆ";
  assert.equal(foldLine(short), short);
});

test("foldLine พับบรรทัดยาวและขึ้นบรรทัดใหม่ด้วยช่องว่างตามข้อกำหนด", () => {
  const long = "DESCRIPTION:" + "x".repeat(100);
  const folded = foldLine(long);
  const parts = folded.split("\r\n");
  assert.ok(parts.length >= 2);
  assert.ok(parts[1].startsWith(" "));
});

test("toICSDateTime แปลงวันที่ ISO เป็นรูปแบบ iCalendar ถูกต้อง", () => {
  assert.equal(toICSDateTime("2026-07-23", 9, 0), "20260723T090000");
  assert.equal(toICSDateTime("2026-01-05", 16, 30), "20260105T163000");
});

test("buildEvent สร้าง VEVENT ที่มีฟิลด์ครบตามที่ต้องใช้จริง", () => {
  const caseItem = {
    caseNumber: "111/2569",
    k: 2,
    station: "สภ.เมืองอุดรธานี",
    filingDeadline: "2026-07-23",
    legalDeadline: "2026-07-24",
  };
  const event = buildEvent(caseItem, new Date("2026-07-21T00:00:00Z"));
  assert.match(event, /BEGIN:VEVENT/);
  assert.match(event, /END:VEVENT/);
  assert.match(event, /DTSTART:20260723T090000/);
  assert.match(event, /DTEND:20260723T100000/);
  assert.match(event, /เลขคดี 111\/2569 ครั้งที่ 2/);
  assert.match(event, /BEGIN:VALARM/);
  assert.match(event, /TRIGGER:-P1D/); // เตือนล่วงหน้า 1 วัน
});

test("generateICS สร้างไฟล์ที่ขึ้นต้น/ลงท้ายถูกต้อง และมี VEVENT เท่าจำนวนคดีที่ยังไม่ปิด", () => {
  const cases = [
    { caseNumber: "1/2569", k: 2, station: "สภ.เมืองอุดรธานี", filingDeadline: "2026-07-23", legalDeadline: "2026-07-24", closed: false },
    { caseNumber: "2/2569", k: 3, station: "สภ.กุมภวาปี", filingDeadline: "2026-07-25", legalDeadline: "2026-07-26", closed: false },
    { caseNumber: "3/2569", k: 4, station: "สภ.บ้านผือ", filingDeadline: "2026-06-01", legalDeadline: "2026-06-02", closed: true }, // ปิดแล้ว ไม่ควรอยู่ในปฏิทิน
  ];
  const ics = generateICS(cases, "คำร้องฝากขัง - ทดสอบ");
  assert.match(ics, /^BEGIN:VCALENDAR/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.match(ics, /VERSION:2\.0/);
  const eventCount = (ics.match(/BEGIN:VEVENT/g) || []).length;
  assert.equal(eventCount, 2); // ไม่รวมคดีที่ปิดแล้ว
});

test("generateICS ใช้ CRLF ตามข้อกำหนด iCalendar (ไม่ใช่ LF เฉยๆ)", () => {
  const ics = generateICS([{ caseNumber: "1/2569", k: 2, station: "สภ.เมืองอุดรธานี", filingDeadline: "2026-07-23", legalDeadline: "2026-07-24", closed: false }], "ทดสอบ");
  assert.ok(ics.includes("\r\n"));
});

test("generateICS ไม่ error เมื่อไม่มีคดีเลย (ปฏิทินว่างเปล่าแต่ยังเป็นไฟล์ที่ถูกต้อง)", () => {
  const ics = generateICS([], "ปฏิทินว่าง");
  assert.match(ics, /^BEGIN:VCALENDAR/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 0);
});
