const test = require("node:test");
const assert = require("node:assert/strict");
const {
  rawDeadline,
  adjustToBusinessDay,
  previousBusinessDay,
  computeDeadlines,
  computeOccasionDeadlines,
  isPastCutoff,
  capMaxK,
  canFileNextOccasion,
  toISO,
  validateUploadFile,
  MAX_UPLOAD_SIZE_BYTES,
} = require("./legalLogic");

// ---------------------------------------------------------------------------
// 1. rawDeadline: ครั้งที่ k ครบกำหนด = วันเริ่ม + 12*(k-1) วัน (ป.วิ.อาญา ม.87)
// ---------------------------------------------------------------------------
test("rawDeadline: ครั้งที่ 2 = วันเริ่ม + 12 วัน", () => {
  assert.equal(rawDeadline("2026-01-01", 2), "2026-01-13");
});

test("rawDeadline: ครั้งที่ 4 = วันเริ่ม + 36 วัน", () => {
  assert.equal(rawDeadline("2026-01-01", 4), "2026-02-06");
});

test("rawDeadline: ครั้งที่ 7 = วันเริ่ม + 72 วัน (เพดานสูงสุด)", () => {
  assert.equal(rawDeadline("2026-01-01", 7), "2026-03-14");
});

// ---------------------------------------------------------------------------
// 2. ตารางยื่นคำร้อง ตามตารางอธิบาย.xlsx (ข้อ 5 ระเบียบศาลจังหวัดอุดรธานี)
//    ใช้สัปดาห์ 2-8 ก.พ. 2569 (ก.พ. 2569 ไม่มีวันหยุดราชการ) เป็นสัปดาห์อ้างอิง:
//    จ.2 อ.3 พ.4 พฤ.5 ศ.6 ส.7 อา.8, จ.ถัดไป = 9 ก.พ.
// ---------------------------------------------------------------------------
const NO_HOLIDAYS = [];

function filingDeadlineFor(rawISO) {
  const legal = adjustToBusinessDay(rawISO, NO_HOLIDAYS);
  return previousBusinessDay(legal, NO_HOLIDAYS);
}

test("ครบฝากขังวันอังคาร (3 ก.พ.) -> ยื่นวันจันทร์ (2 ก.พ.)", () => {
  assert.equal(filingDeadlineFor("2026-02-03"), "2026-02-02");
});

test("ครบฝากขังวันพุธ (4 ก.พ.) -> ยื่นวันอังคาร (3 ก.พ.)", () => {
  assert.equal(filingDeadlineFor("2026-02-04"), "2026-02-03");
});

test("ครบฝากขังวันพฤหัสบดี (5 ก.พ.) -> ยื่นวันพุธ (4 ก.พ.)", () => {
  assert.equal(filingDeadlineFor("2026-02-05"), "2026-02-04");
});

test("ครบฝากขังวันศุกร์ (6 ก.พ.) -> ยื่นวันพฤหัสบดี (5 ก.พ.)", () => {
  assert.equal(filingDeadlineFor("2026-02-06"), "2026-02-05");
});

test("ครบฝากขังวันเสาร์ (7 ก.พ.) -> ยื่นวันพฤหัสบดี (5 ก.พ.) [เลื่อนศุกร์แล้วถอยอีก 1 วันทำการ]", () => {
  assert.equal(filingDeadlineFor("2026-02-07"), "2026-02-05");
});

test("ครบฝากขังวันอาทิตย์ (8 ก.พ.) -> ยื่นวันพฤหัสบดี (5 ก.พ.) [เลื่อนศุกร์แล้วถอยอีก 1 วันทำการ]", () => {
  assert.equal(filingDeadlineFor("2026-02-08"), "2026-02-05");
});

test("ครบฝากขังวันจันทร์ (9 ก.พ.) -> ยื่นวันศุกร์ (6 ก.พ.) [ข้ามเสาร์-อาทิตย์]", () => {
  assert.equal(filingDeadlineFor("2026-02-09"), "2026-02-06");
});

// ---------------------------------------------------------------------------
// 3. ผลของวันหยุดนักขัตฤกษ์ต่อการคำนวณ (ไม่ใช่แค่เสาร์-อาทิตย์)
// ---------------------------------------------------------------------------
test("วันหยุดนักขัตฤกษ์ทำให้เลื่อนเหมือนวันหยุดเสาร์-อาทิตย์", () => {
  // สมมติ 4 ก.พ. 2569 (พุธ) เป็นวันหยุดนักขัตฤกษ์
  const holidays = [{ date: "2026-02-04", label: "วันหยุดทดสอบ" }];
  const legal = adjustToBusinessDay("2026-02-04", holidays);
  assert.equal(legal, "2026-02-03"); // เลื่อนมาวันอังคารก่อนหน้า
  const filing = previousBusinessDay(legal, holidays);
  assert.equal(filing, "2026-02-02"); // ถอยอีก 1 วันทำการ = วันจันทร์
});

// ---------------------------------------------------------------------------
// 4. computeDeadlines: ฟังก์ชันรวมที่ UI เรียกใช้จริง
// ---------------------------------------------------------------------------
test("computeDeadlines คืนค่าครบทั้ง 3 วันที่ถูกต้อง", () => {
  const result = computeDeadlines("2026-02-01", 2, NO_HOLIDAYS); // เริ่ม 1 ก.พ. (อา.) ครั้งที่ 2 ดิบ = 13 ก.พ. (ศ.)
  assert.equal(result.rawDeadline, "2026-02-13");
  assert.equal(result.legalDeadline, "2026-02-13"); // ศุกร์ เป็นวันทำการอยู่แล้ว
  assert.equal(result.filingDeadline, "2026-02-12"); // ถอย 1 วันทำการ = พฤหัสบดี
});

// ---------------------------------------------------------------------------
// 5. ข้อ 6: ล็อกเวลายื่นทางระบบไม่เกิน 16.00 น.
// ---------------------------------------------------------------------------
test("ก่อน 16.00 น. ของวันที่ต้องยื่น -> ยังไม่เลยเวลา", () => {
  const now = new Date("2026-02-05T15:59:00");
  assert.equal(isPastCutoff("2026-02-05", now), false);
});

test("หลัง 16.00 น. ของวันที่ต้องยื่น -> เลยเวลาแล้ว", () => {
  const now = new Date("2026-02-05T16:01:00");
  assert.equal(isPastCutoff("2026-02-05", now), true);
});

test("วันถัดจากวันที่ต้องยื่น -> เลยเวลาแล้วแน่นอน", () => {
  const now = new Date("2026-02-06T09:00:00");
  assert.equal(isPastCutoff("2026-02-05", now), true);
});

test("ก่อนวันที่ต้องยื่น -> ยังไม่เลยเวลา", () => {
  const now = new Date("2026-02-04T23:00:00");
  assert.equal(isPastCutoff("2026-02-05", now), false);
});

// ---------------------------------------------------------------------------
// 6. เพดานฝากขัง (ป.วิ.อาญา ม.87 วรรคหก): 48 วัน (4 ครั้ง) หรือ 84 วัน (7 ครั้ง)
// ---------------------------------------------------------------------------
test("capMaxK: เพดาน 48 วัน = 4 ครั้ง, 84 วัน = 7 ครั้ง", () => {
  assert.equal(capMaxK(48), 4);
  assert.equal(capMaxK(84), 7);
  assert.equal(capMaxK(null), null);
  assert.equal(capMaxK(undefined), null);
});

test("canFileNextOccasion: ครั้งที่ 2-3 ฝากต่อได้เสมอแม้ยังไม่รู้เพดาน", () => {
  assert.equal(canFileNextOccasion(2, null), true);
  assert.equal(canFileNextOccasion(3, null), true);
});

test("canFileNextOccasion: เพดาน 48 วัน ฝากได้ถึงครั้งที่ 4 เท่านั้น ห้ามมีครั้งที่ 5", () => {
  assert.equal(canFileNextOccasion(3, 48), true); // ยังฝากครั้งที่ 4 ได้
  assert.equal(canFileNextOccasion(4, 48), false); // ครั้งที่ 4 คือครั้งสุดท้าย ห้ามมีครั้งที่ 5
});

test("canFileNextOccasion: เพดาน 84 วัน ฝากได้ถึงครั้งที่ 7 เท่านั้น", () => {
  assert.equal(canFileNextOccasion(6, 84), true); // ยังฝากครั้งที่ 7 ได้
  assert.equal(canFileNextOccasion(7, 84), false); // ครั้งที่ 7 คือครั้งสุดท้าย
});

// ---------------------------------------------------------------------------
// 7. บั๊กที่พบจากการใช้งานจริง: toISO ต้องใช้วันที่ตาม local time ของ Date object
//    ไม่ใช่ UTC (.toISOString()) — เพราะเวลาไทยเที่ยงคืนถึงตี 7 โมงเช้า UTC ยังเป็นวันก่อนหน้า
//    ถ้า toISO อิง UTC จะคำนวณ "วันนี้" ผิดไปหนึ่งวันในช่วงเวลานั้น กระทบทุกการคำนวณในระบบ
// ---------------------------------------------------------------------------
test("toISO คืนค่าตรงกับ getFullYear/getMonth/getDate ของ Date object เสมอ (local time ไม่ใช่ UTC)", () => {
  const samples = [
    new Date(2026, 6, 21, 2, 0, 0),   // 21 ก.ค. 2569 เวลา 02:00 น. — ช่วงเสี่ยงบั๊กที่พบจริง
    new Date(2026, 0, 1, 0, 30, 0),   // เที่ยงคืนผ่านมา 30 นาที ของวันปีใหม่
    new Date(2026, 11, 31, 23, 59, 0),// ท้ายวันสิ้นปี
  ];
  samples.forEach((d) => {
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    assert.equal(toISO(d), expected);
  });
});

// ---------------------------------------------------------------------------
// 8. computeOccasionDeadlines: คำนวณวันครบกำหนดจาก "วันสะสม" จริง เพื่อความแม่นยำเมื่อศาลให้ไม่ครบ 12 วัน
//    (นโยบายที่ยืนยันกับศาลแล้ว: ปิดคดีตัดสินจาก "จำนวนครั้ง" 4/7 โดยตรง ไม่ใช่วันสะสม — เพราะทุกครั้งไม่เกิน
//    12 วันอยู่แล้วเป็นกฎตายตัว ทำให้จำนวนครั้งถึงเพดานเสมอก่อนหรือพร้อมกับวันสะสม ฟังก์ชันนี้จึงไม่รับ cap
//    เป็นพารามิเตอร์อีกต่อไป และ daysAvailable คงที่ 12 วันเสมอ)
// ---------------------------------------------------------------------------
test("computeOccasionDeadlines ให้ผลเหมือน computeDeadlines(k=2) เมื่อ cumulativeDays = 12*(k-1) แบบมาตรฐาน", () => {
  const r = computeOccasionDeadlines("2026-02-01", 12, NO_HOLIDAYS);
  assert.equal(r.rawDeadline, "2026-02-13");
  assert.equal(r.filingDeadline, "2026-02-12");
  assert.equal(r.daysAvailable, 12); // ครั้งละไม่เกิน 12 วันเสมอ
});

test("computeOccasionDeadlines คำนวณวันครบกำหนดครั้งถัดไปให้เร็วขึ้น เมื่อวันสะสมน้อยกว่ามาตรฐาน (ศาลเคยให้ไม่ครบ 12 วัน)", () => {
  // สมมติผ่านมา 2 ครั้งแล้ว แต่ศาลให้ไม่เต็ม 12 วันทุกครั้ง สะสมจริงแค่ 18 วัน (ไม่ใช่ 24 วันตามสูตรมาตรฐาน)
  const r = computeOccasionDeadlines("2026-01-01", 18, NO_HOLIDAYS);
  assert.equal(r.rawDeadline, "2026-01-19"); // start + 18 วัน ไม่ใช่ start + 24
  assert.equal(r.daysAvailable, 12); // ยังขอได้เต็ม 12 วันในครั้งนี้ตามกฎหมาย ไม่ถูกจำกัดจากวันสะสม
});

test("computeOccasionDeadlines: daysAvailable คงที่ 12 วันเสมอ ไม่ว่าวันสะสมจะเท่าไหร่ (ปิดคดีที่จำนวนครั้งแทน)", () => {
  const r = computeOccasionDeadlines("2026-01-01", 48, NO_HOLIDAYS);
  assert.equal(r.daysAvailable, 12);
});

// ---------------------------------------------------------------------------
// 9. validateUploadFile: ตรวจนามสกุลไฟล์และขนาดไฟล์ก่อนยอมรับอัพโหลด
//    (กฎล้วนๆ ไม่รู้จัก "คดี" — ใช้ตรวจได้ทั้งฝั่ง client และ server)
// ---------------------------------------------------------------------------
test("validateUploadFile: ยอมรับไฟล์ .pdf ขนาดปกติ", () => {
  const result = validateUploadFile({ name: "คำร้อง.pdf", sizeBytes: 3 * 1024 * 1024 });
  assert.equal(result.valid, true);
  assert.equal(result.reason, null);
});

test("validateUploadFile: ปฏิเสธไฟล์ที่ไม่ใช่นามสกุล .pdf", () => {
  const result = validateUploadFile({ name: "คำร้อง.docx", sizeBytes: 1024 });
  assert.equal(result.valid, false);
  assert.match(result.reason, /\.pdf/);
});

test("validateUploadFile: เช็คนามสกุลแบบไม่สนตัวพิมพ์เล็ก-ใหญ่ (.PDF ก็ยอมรับ)", () => {
  const result = validateUploadFile({ name: "คำร้อง.PDF", sizeBytes: 1024 });
  assert.equal(result.valid, true);
});

test("validateUploadFile: ปฏิเสธไฟล์ขนาดเกิน MAX_UPLOAD_SIZE_BYTES (20 MB)", () => {
  const result = validateUploadFile({ name: "ใหญ่มาก.pdf", sizeBytes: MAX_UPLOAD_SIZE_BYTES + 1 });
  assert.equal(result.valid, false);
  assert.match(result.reason, /20 MB/);
});

test("validateUploadFile: ยอมรับไฟล์ขนาดเท่ากับเพดานพอดี (ไม่ใช่แค่ต่ำกว่า)", () => {
  const result = validateUploadFile({ name: "พอดีเป๊ะ.pdf", sizeBytes: MAX_UPLOAD_SIZE_BYTES });
  assert.equal(result.valid, true);
});

test("validateUploadFile: ปฏิเสธเมื่อไม่มีไฟล์เลย หรือไม่มีชื่อไฟล์", () => {
  assert.equal(validateUploadFile(null).valid, false);
  assert.equal(validateUploadFile({ sizeBytes: 1024 }).valid, false);
});

test("validateUploadFile: ปฏิเสธเมื่อขนาดไฟล์อ่านไม่ได้ (0, ลบ, หรือไม่ใช่ตัวเลข)", () => {
  assert.equal(validateUploadFile({ name: "a.pdf", sizeBytes: 0 }).valid, false);
  assert.equal(validateUploadFile({ name: "a.pdf", sizeBytes: -5 }).valid, false);
  assert.equal(validateUploadFile({ name: "a.pdf", sizeBytes: "ไม่รู้" }).valid, false);
});
