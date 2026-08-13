const test = require("node:test");
const assert = require("node:assert/strict");
const { enrichCase, deriveStatus, canUploadFile, uploadFile, flagWrongFile, returnToPool, receiveOccasion } = require("./caseEngine");
const { FILE_PURGE_DAYS } = require("./legalLogic");

const NO_HOLIDAYS = [];

// ---------------------------------------------------------------------------
// enrichCase: คดีดิบ -> คดีพร้อมวันที่คำนวณแล้ว + สถานะ
// ---------------------------------------------------------------------------
test("enrichCase คำนวณวันครบกำหนด/วันยื่นถูกต้องสำหรับคดีครั้งที่ 2", () => {
  const rawCase = { caseNumber: "111/2569", startDate: "2026-02-01", k: 2, cap: null, fileName: null, downloaded: false, closed: false };
  const now = new Date("2026-02-01T09:00:00");
  const enriched = enrichCase(rawCase, NO_HOLIDAYS, now);
  assert.equal(enriched.rawDeadline, "2026-02-13");
  assert.equal(enriched.legalDeadline, "2026-02-13"); // ศุกร์ เป็นวันทำการ
  assert.equal(enriched.filingDeadline, "2026-02-12"); // ถอย 1 วันทำการ = พฤหัสบดี
  assert.equal(enriched.status, "wait"); // ยังเหลือเวลาหลายวัน
});

test("enrichCase ให้สถานะ 'due' เมื่อเหลือเวลาไม่เกิน 3 วัน", () => {
  const rawCase = { caseNumber: "87/2569", startDate: "2026-01-20", k: 2, cap: null, fileName: null, downloaded: false, closed: false };
  // filingDeadline ของครั้งที่ 2 (เริ่ม 20 ม.ค.) = 1 ก.พ.(อา.) ปรับเป็น 30 ม.ค.(ศ.) ถอย 1 วันทำการ = 29 ม.ค.(พฤ.)
  const now = new Date("2026-01-27T09:00:00"); // เหลืออีก 2 วัน ก่อนเวลาตัด 16.00 น. ของวันที่ 29
  const enriched = enrichCase(rawCase, NO_HOLIDAYS, now);
  assert.equal(enriched.filingDeadline, "2026-01-29");
  assert.equal(enriched.status, "due");
});

test("enrichCase ให้สถานะ 'blocked' เมื่อเลยเวลา 16.00 น. ของวันที่ต้องยื่นแล้ว", () => {
  const rawCase = { caseNumber: "45/2569", startDate: "2026-01-01", k: 2, cap: null, fileName: null, downloaded: false, closed: false };
  // filingDeadline ของครั้งที่ 2 (เริ่ม 1 ม.ค.) = 12 ม.ค. (จันทร์) ถอย 1 วันทำการ = 9 ม.ค. (ศุกร์)
  const enriched1 = enrichCase(rawCase, NO_HOLIDAYS, new Date("2026-01-01"));
  const filingDeadline = enriched1.filingDeadline;
  const afterCutoff = new Date(filingDeadline + "T16:01:00");
  const enriched2 = enrichCase(rawCase, NO_HOLIDAYS, afterCutoff);
  assert.equal(enriched2.status, "blocked");
});

test("enrichCase ให้สถานะ 'uploaded' เมื่อมีไฟล์แต่ยังไม่ดาวน์โหลด", () => {
  const rawCase = { caseNumber: "12/2569", startDate: "2026-01-01", k: 2, cap: null, fileName: "test.pdf", downloaded: false, closed: false };
  const enriched = enrichCase(rawCase, NO_HOLIDAYS, new Date("2026-01-01"));
  assert.equal(enriched.status, "uploaded");
});

// ---------------------------------------------------------------------------
// การหมดอายุของไฟล์ที่อัพโหลด (fileExpired) — ไฟล์ PDF ถูกลบอัตโนมัติ FILE_PURGE_DAYS วันหลังอัพโหลด
// ถ้ายังไม่ถูกดาวน์โหลดก่อนหมดอายุ ต้องอัพโหลดใหม่ — ตรรกะนี้เดิมเคยมีอยู่แค่ในไฟล์เดโม ย้ายมา lib/ แล้ว
// ---------------------------------------------------------------------------
test(`ค่าคงที่ FILE_PURGE_DAYS ต้องเท่ากับ 12 วัน (ตัดสินใจแล้ว เดิมเคยเป็น 3 วันแต่ไม่พอสำหรับคดียื่นล่วงหน้า)`, () => {
  assert.equal(FILE_PURGE_DAYS, 12);
});

test("uploadFile บันทึก uploadedAt เป็นวันที่อัพโหลดจริงเสมอ (เดิมเคยไม่ได้บันทึกเลย)", () => {
  const rawCase = { caseNumber: "1/2569", startDate: "2026-02-01", k: 2, cap: null, fileName: null, downloaded: false, closed: false, history: [] };
  const now = new Date("2026-02-05T09:00:00");
  const { case: result } = uploadFile(rawCase, { name: "a.pdf", sizeBytes: 1024 }, NO_HOLIDAYS, now);
  assert.equal(result.uploadedAt, "2026-02-05");
});

test("uploadFile อัพเดต uploadedAt ใหม่ทุกครั้งที่อัพทับ (นับ FILE_PURGE_DAYS จากไฟล์ล่าสุดเสมอ ไม่ใช่ไฟล์แรก)", () => {
  const rawCase = { caseNumber: "1/2569", startDate: "2026-02-01", k: 2, cap: null, fileName: "เก่า.pdf", downloaded: false, closed: false, history: [], uploadedAt: "2026-02-01" };
  const later = new Date("2026-02-06T09:00:00");
  const { case: result } = uploadFile(rawCase, { name: "ใหม่.pdf", sizeBytes: 1024 }, NO_HOLIDAYS, later);
  assert.equal(result.uploadedAt, "2026-02-06");
});

test(`enrichCase: สถานะเป็น 'file_expired' เมื่อเลย ${FILE_PURGE_DAYS} วันหลังอัพโหลดไปแล้วและศาลยังไม่ดาวน์โหลด`, () => {
  const rawCase = { caseNumber: "1/2569", startDate: "2026-01-01", k: 2, cap: null, fileName: "a.pdf", downloaded: false, closed: false, uploadedAt: "2026-01-01" };
  const afterExpiry = new Date(`2026-01-${String(1 + FILE_PURGE_DAYS + 1).padStart(2, "0")}T09:00:00`); // เลยไป 1 วันหลังหมดอายุ
  const enriched = enrichCase(rawCase, NO_HOLIDAYS, afterExpiry);
  assert.equal(enriched.fileExpired, true);
  assert.equal(enriched.status, "file_expired");
});

test(`enrichCase: ยังไม่หมดอายุถ้ายังไม่ครบ ${FILE_PURGE_DAYS} วัน`, () => {
  const rawCase = { caseNumber: "1/2569", startDate: "2026-01-01", k: 2, cap: null, fileName: "a.pdf", downloaded: false, closed: false, uploadedAt: "2026-01-01" };
  const beforeExpiry = new Date(`2026-01-${String(1 + FILE_PURGE_DAYS - 1).padStart(2, "0")}T09:00:00`); // ยังไม่ครบกำหนด
  const enriched = enrichCase(rawCase, NO_HOLIDAYS, beforeExpiry);
  assert.equal(enriched.fileExpired, false);
  assert.notEqual(enriched.status, "file_expired");
});

test("enrichCase: ไม่หมดอายุเลยถ้าศาลดาวน์โหลดไปแล้วก่อนครบกำหนด แม้เวลาจะผ่านไปนานแค่ไหนก็ตาม", () => {
  const rawCase = { caseNumber: "1/2569", startDate: "2026-01-01", k: 2, cap: null, fileName: "a.pdf", downloaded: true, closed: false, uploadedAt: "2026-01-01" };
  const wayLater = new Date("2026-06-01T09:00:00"); // ผ่านไปหลายเดือน
  const enriched = enrichCase(rawCase, NO_HOLIDAYS, wayLater);
  assert.equal(enriched.fileExpired, false); // downloaded=true แล้ว ไม่มีวันหมดอายุอีก
});

test("enrichCase: filePurgeDate คำนวณถูกต้องเป็นวันที่อัพโหลด + FILE_PURGE_DAYS พอดี", () => {
  const rawCase = { caseNumber: "1/2569", startDate: "2026-01-01", k: 2, cap: null, fileName: "a.pdf", downloaded: false, closed: false, uploadedAt: "2026-01-01" };
  const enriched = enrichCase(rawCase, NO_HOLIDAYS, new Date("2026-01-02"));
  const expected = `2026-01-${String(1 + FILE_PURGE_DAYS).padStart(2, "0")}`;
  assert.equal(enriched.filePurgeDate, expected);
});


const ONE_MB = 1024 * 1024;

test("uploadFile อัพโหลดไฟล์ครั้งแรกได้ปกติ ก่อนเลยเวลาตัด (ไฟล์ .pdf ขนาดปกติ)", () => {
  const rawCase = { caseNumber: "1/2569", startDate: "2026-02-01", k: 2, cap: null, fileName: null, downloaded: false, closed: false, history: [] };
  const now = new Date("2026-02-05T09:00:00"); // filingDeadline ครั้งที่ 2 = 12 ก.พ. ยังไม่ถึง
  const { case: result, ok, reason } = uploadFile(rawCase, { name: "case1-v1.pdf", sizeBytes: 3 * ONE_MB }, NO_HOLIDAYS, now);
  assert.equal(ok, true);
  assert.equal(reason, null);
  assert.equal(result.fileName, "case1-v1.pdf");
  assert.equal(result.downloaded, false);
});

test("uploadFile อัพทับไฟล์เดิมได้ (แก้ไฟล์ที่อัพผิดคดี) ตราบใดที่ยังไม่เลยเวลาตัดและศาลยังไม่รับเรื่อง", () => {
  // สมมติพนักงานอัพไฟล์ของคดีอื่นเข้ามาผิด (case-99.pdf) แล้วรู้ตัวว่าอัพผิด ต้องอัพไฟล์ที่ถูกต้องทับ
  const rawCase = { caseNumber: "1/2569", startDate: "2026-02-01", k: 2, cap: null, fileName: "case-99-ผิดคดี.pdf", downloaded: false, closed: false, history: [] };
  const now = new Date("2026-02-05T09:00:00");
  const { case: result, ok } = uploadFile(rawCase, { name: "case1-แก้ไขแล้ว.pdf", sizeBytes: 2 * ONE_MB }, NO_HOLIDAYS, now);
  assert.equal(ok, true);
  assert.equal(result.fileName, "case1-แก้ไขแล้ว.pdf"); // ทับไฟล์ผิดด้วยไฟล์ที่ถูกต้อง
  assert.equal(result.downloaded, false);
});

test("uploadFile รีเซ็ต downloaded กลับเป็น false เสมอเมื่ออัพทับ แม้ศาลจะเคยดาวน์โหลดไฟล์ผิดไปแล้วก็ตาม", () => {
  // เคสอันตรายที่ต้องกันไว้: ศาลดาวน์โหลดไฟล์ผิดไปแล้ว (downloaded: true) แต่ยังไม่ทันกดรับเรื่อง
  // พนักงานอัพไฟล์ถูกทับ -> ต้องบังคับให้ศาลดาวน์โหลดไฟล์ใหม่อีกรอบก่อนกดรับเรื่องได้ ห้ามใช้สถานะ downloaded เดิม
  const rawCase = { caseNumber: "1/2569", startDate: "2026-02-01", k: 2, cap: null, fileName: "ผิดคดี.pdf", downloaded: true, closed: false, history: [] };
  const now = new Date("2026-02-05T09:00:00");
  const { case: result } = uploadFile(rawCase, { name: "ถูกต้อง.pdf", sizeBytes: 1 * ONE_MB }, NO_HOLIDAYS, now);
  assert.equal(result.fileName, "ถูกต้อง.pdf");
  assert.equal(result.downloaded, false); // ต้องรีเซ็ต แม้ก่อนหน้านี้จะเป็น true
});

test("uploadFile อัพทับไม่ได้แล้วถ้าเลยเวลาตัด 16.00 น. ของวันที่ต้องยื่นไปแล้ว (คืนคดีเดิมไม่เปลี่ยนแปลง + บอกเหตุผล)", () => {
  const rawCase = { caseNumber: "1/2569", startDate: "2026-01-01", k: 2, cap: null, fileName: "ผิดคดี.pdf", downloaded: false, closed: false, history: [] };
  // filingDeadline ครั้งที่ 2 (เริ่ม 1 ม.ค.) = 12 ม.ค. (จันทร์) — จำลองเวลาหลัง 16.00 น. ของวันนั้น
  const afterCutoff = new Date("2026-01-12T16:01:00");
  const { case: result, ok, reason } = uploadFile(rawCase, { name: "แก้ไขแล้ว.pdf", sizeBytes: ONE_MB }, NO_HOLIDAYS, afterCutoff);
  assert.equal(ok, false);
  assert.match(reason, /16\.00/);
  assert.deepEqual(result, rawCase); // เหมือนเดิมทุกประการ ไม่มีอะไรเปลี่ยน — ต้องไปยื่นด้วยตนเองตามข้อ 6
});

test("uploadFile อัพทับไม่ได้ถ้าคดีปิดไปแล้ว", () => {
  const rawCase = { caseNumber: "1/2569", startDate: "2026-01-01", k: 4, cap: 48, fileName: null, downloaded: false, closed: true, closedDate: "2026-02-01", history: [] };
  const { case: result, ok, reason } = uploadFile(rawCase, { name: "สาย.pdf", sizeBytes: ONE_MB }, NO_HOLIDAYS, new Date("2026-02-05"));
  assert.equal(ok, false);
  assert.match(reason, /ปิดแล้ว/);
  assert.deepEqual(result, rawCase);
});

test("uploadFile ปฏิเสธไฟล์ที่ไม่ใช่นามสกุล .pdf แม้จะยังไม่เลยเวลาตัด", () => {
  const rawCase = { caseNumber: "1/2569", startDate: "2026-02-01", k: 2, cap: null, fileName: null, downloaded: false, closed: false, history: [] };
  const now = new Date("2026-02-05T09:00:00");
  const { case: result, ok, reason } = uploadFile(rawCase, { name: "คำร้อง.docx", sizeBytes: ONE_MB }, NO_HOLIDAYS, now);
  assert.equal(ok, false);
  assert.match(reason, /\.pdf/);
  assert.deepEqual(result, rawCase); // ไม่มีการเปลี่ยนแปลงใดๆ กับคดี
});

test("uploadFile ปฏิเสธไฟล์ที่ขนาดเกิน 20 MB", () => {
  const rawCase = { caseNumber: "1/2569", startDate: "2026-02-01", k: 2, cap: null, fileName: null, downloaded: false, closed: false, history: [] };
  const now = new Date("2026-02-05T09:00:00");
  const { case: result, ok, reason } = uploadFile(rawCase, { name: "ใหญ่มาก.pdf", sizeBytes: 21 * ONE_MB }, NO_HOLIDAYS, now);
  assert.equal(ok, false);
  assert.match(reason, /20 MB/);
  assert.deepEqual(result, rawCase);
});

test("uploadFile ยอมรับไฟล์ขนาดพอดี 20 MB (เท่ากับเพดานพอดี ไม่ใช่แค่ต่ำกว่า)", () => {
  const rawCase = { caseNumber: "1/2569", startDate: "2026-02-01", k: 2, cap: null, fileName: null, downloaded: false, closed: false, history: [] };
  const now = new Date("2026-02-05T09:00:00");
  const { ok } = uploadFile(rawCase, { name: "พอดีเป๊ะ.pdf", sizeBytes: 20 * ONE_MB }, NO_HOLIDAYS, now);
  assert.equal(ok, true);
});

test("uploadFile เช็คตัวไฟล์ก่อนเช็คเวลา/สถานะคดีเสมอ (ไฟล์ผิดประเภทถูกปฏิเสธ แม้เลยเวลาตัดไปแล้วก็ตาม ข้อความยังบอกเรื่องไฟล์ ไม่ใช่เรื่องเวลา)", () => {
  const rawCase = { caseNumber: "1/2569", startDate: "2026-01-01", k: 2, cap: null, fileName: null, downloaded: false, closed: false, history: [] };
  const afterCutoff = new Date("2026-01-12T16:01:00");
  const { ok, reason } = uploadFile(rawCase, { name: "ผิดชนิด.txt", sizeBytes: ONE_MB }, NO_HOLIDAYS, afterCutoff);
  assert.equal(ok, false);
  assert.match(reason, /\.pdf/); // ต้องบอกเรื่องไฟล์ผิดชนิดก่อน ไม่ใช่เรื่องเลยเวลา
});

test("canUploadFile คืน true/false ให้ UI เปิด-ปิดปุ่มอัพโหลดล่วงหน้าได้ ตรงกับพฤติกรรมจริงของ uploadFile (เช็คแค่เวลา/สถานะคดี ไม่เช็คไฟล์)", () => {
  const rawCase = { caseNumber: "1/2569", startDate: "2026-01-01", k: 2, cap: null, fileName: null, downloaded: false, closed: false, history: [] };
  const beforeCutoff = new Date("2026-01-12T15:59:00");
  const afterCutoff = new Date("2026-01-12T16:01:00");
  assert.equal(canUploadFile(rawCase, NO_HOLIDAYS, beforeCutoff), true);
  assert.equal(canUploadFile(rawCase, NO_HOLIDAYS, afterCutoff), false);
});

test("uploadFile: หลังอัพทับไฟล์ (แก้ไฟล์ผิดคดี) สถานะยังคงเป็น 'uploaded' เสมอ ไม่ตกกลับไปเป็น 'wait'/'due'", () => {
  const rawCase = { caseNumber: "1/2569", startDate: "2026-01-01", k: 2, cap: null, fileName: null, downloaded: false, closed: false, history: [] };
  const now = new Date("2026-01-10T09:00:00"); // ก่อนเลยเวลาตัด (filingDeadline = 12 ม.ค.)

  // ยังไม่อัพไฟล์ -> สถานะเป็น wait/due ตามระยะเวลา
  const beforeUpload = enrichCase(rawCase, NO_HOLIDAYS, now);
  assert.notEqual(beforeUpload.status, "uploaded");

  // อัพไฟล์ผิดคดีเข้ามาก่อน
  let c = uploadFile(rawCase, { name: "ผิดคดี.pdf", sizeBytes: ONE_MB }, NO_HOLIDAYS, now).case;
  assert.equal(enrichCase(c, NO_HOLIDAYS, now).status, "uploaded");

  // สมมติศาลดาวน์โหลดไฟล์ผิดไปแล้วก่อนพนักงานจะทันแก้
  c = { ...c, downloaded: true };
  assert.equal(enrichCase(c, NO_HOLIDAYS, now).status, "downloaded");

  // พนักงานรู้ตัวว่าอัพผิด อัพไฟล์ที่ถูกต้องทับ
  c = uploadFile(c, { name: "ถูกต้อง.pdf", sizeBytes: ONE_MB }, NO_HOLIDAYS, now).case;
  const afterReupload = enrichCase(c, NO_HOLIDAYS, now);
  assert.equal(afterReupload.status, "uploaded"); // ยังเป็น "ยื่นแล้ว" ไม่ตกกลับไป wait/due
  assert.equal(c.fileName, "ถูกต้อง.pdf");
  assert.equal(c.downloaded, false); // ต้องให้ศาลดาวน์โหลดไฟล์ใหม่อีกรอบก่อนรับเรื่องได้
});

// ---------------------------------------------------------------------------
// flagWrongFile: เจ้าหน้าที่ศาลแจ้งว่าไฟล์ที่พนักงานอัพโหลดมาไม่ถูกต้อง (เช่น ผิดคดี) หลังตรวจดูแล้ว
// นโยบาย (ยืนยันแล้ว): ไม่ลบไฟล์เดิมทันที เก็บไว้ก่อนเผื่อเทียบ — ลบ/แทนที่ก็ต่อเมื่อพนักงานอัพโหลดใหม่สำเร็จเท่านั้น
// ---------------------------------------------------------------------------
test("flagWrongFile ตั้ง courtFlag ได้สำเร็จ เมื่อคดีมีไฟล์อยู่และยังไม่ปิด", () => {
  const rawCase = { caseNumber: "1/2569", startDate: "2026-02-01", k: 2, cap: null, fileName: "ผิดคดี.pdf", downloaded: true, closed: false, history: [] };
  const now = new Date("2026-02-05T10:00:00");
  const { case: result, ok, reason } = flagWrongFile(rawCase, "ไฟล์นี้เป็นคำร้องของคดีเลข ยฝ.5/2569 ไม่ใช่คดีนี้", now);
  assert.equal(ok, true);
  assert.equal(reason, null);
  assert.equal(result.courtFlag.reason, "ไฟล์นี้เป็นคำร้องของคดีเลข ยฝ.5/2569 ไม่ใช่คดีนี้");
  assert.equal(result.courtFlag.flaggedAt, "2026-02-05");
  // ไม่ลบไฟล์เดิม — fileName/downloaded ต้องยังอยู่เหมือนเดิมทุกประการ (นโยบายยืนยันแล้ว)
  assert.equal(result.fileName, "ผิดคดี.pdf");
  assert.equal(result.downloaded, true);
});

test("flagWrongFile ปฏิเสธถ้าคดีไม่มีไฟล์ให้แจ้งว่าผิด", () => {
  const rawCase = { caseNumber: "1/2569", startDate: "2026-02-01", k: 2, cap: null, fileName: null, downloaded: false, closed: false, history: [] };
  const { case: result, ok, reason } = flagWrongFile(rawCase, "เหตุผลอะไรสักอย่าง", new Date());
  assert.equal(ok, false);
  assert.match(reason, /ยังไม่มีไฟล์/);
  assert.deepEqual(result, rawCase);
});

test("flagWrongFile ปฏิเสธถ้าคดีปิดไปแล้ว", () => {
  const rawCase = { caseNumber: "1/2569", startDate: "2026-01-01", k: 4, cap: 48, fileName: null, downloaded: false, closed: true, closedDate: "2026-02-01", history: [] };
  const { ok, reason } = flagWrongFile(rawCase, "เหตุผล", new Date());
  assert.equal(ok, false);
  assert.match(reason, /ปิดแล้ว/);
});

test("flagWrongFile ปฏิเสธถ้าไม่ระบุเหตุผล (ว่างเปล่า หรือมีแต่ช่องว่าง)", () => {
  const rawCase = { caseNumber: "1/2569", startDate: "2026-02-01", k: 2, cap: null, fileName: "a.pdf", downloaded: true, closed: false, history: [] };
  assert.equal(flagWrongFile(rawCase, "", new Date()).ok, false);
  assert.equal(flagWrongFile(rawCase, "   ", new Date()).ok, false);
  assert.equal(flagWrongFile(rawCase, null, new Date()).ok, false);
});

test("uploadFile เคลียร์ courtFlag อัตโนมัติเมื่อพนักงานอัพโหลดไฟล์ใหม่สำเร็จ (ถือว่าแก้ไขแล้ว)", () => {
  const flagged = { caseNumber: "1/2569", startDate: "2026-02-01", k: 2, cap: null, fileName: "ผิดคดี.pdf", downloaded: true, closed: false, history: [], courtFlag: { reason: "ผิดคดี", flaggedAt: "2026-02-05" } };
  const now = new Date("2026-02-05T11:00:00");
  const { case: result, ok } = uploadFile(flagged, { name: "ถูกต้อง.pdf", sizeBytes: 1024 * 1024 }, NO_HOLIDAYS, now);
  assert.equal(ok, true);
  assert.equal(result.fileName, "ถูกต้อง.pdf");
  assert.equal(result.courtFlag, null); // เคลียร์แล้ว
});

// ---------------------------------------------------------------------------
// returnToPool: ฝั่งตำรวจ "คืนสำนวน" — พบว่าเจ้าหน้าที่ศาลจับคู่สถานีผิด (ไม่ใช่คดีของสภ.ตัวเอง)
// นโยบาย (ยืนยันแล้ว): จำกัดเฉพาะคดีที่ยังไม่เคยถูกรับเรื่องเลย (history ว่างเปล่า) เท่านั้น
// ---------------------------------------------------------------------------
test("returnToPool เคลียร์ station/officer/fileName กลับเป็นค่าว่าง และบันทึก returnedNote เมื่อคดียังไม่เคยถูกรับเรื่อง", () => {
  const rawCase = { caseNumber: "ยฝ.1/2569", startDate: "2026-02-01", k: 2, cap: null, station: "สภ.เมืองอุดรธานี", officer: "ร.ต.อ.สมชาย", fileName: "a.pdf", downloaded: false, closed: false, history: [] };
  const now = new Date("2026-02-05T10:00:00");
  const { case: result, ok, reason } = returnToPool(rawCase, "คดีนี้เกิดในเขต สภ.กุมภวาปี ไม่ใช่ สภ.เมืองอุดรธานี", now);
  assert.equal(ok, true);
  assert.equal(reason, null);
  assert.equal(result.station, null);
  assert.equal(result.officer, null);
  assert.equal(result.fileName, null);
  assert.equal(result.downloaded, false);
  assert.equal(result.returnedNote.reason, "คดีนี้เกิดในเขต สภ.กุมภวาปี ไม่ใช่ สภ.เมืองอุดรธานี");
  assert.equal(result.returnedNote.returnedFromStation, "สภ.เมืองอุดรธานี"); // เก็บสถานีเดิมไว้บอกศาล กันจับคู่ผิดซ้ำที่เดิม
  assert.equal(result.returnedNote.returnedAt, "2026-02-05");
});

test("returnToPool ปฏิเสธถ้าคดีเคยถูกรับเรื่องไปแล้วอย่างน้อยหนึ่งครั้ง (กันประวัติการฝากขังจริงหาย)", () => {
  const rawCase = {
    caseNumber: "ยฝ.1/2569", startDate: "2026-01-01", k: 3, cap: null, station: "สภ.เมืองอุดรธานี", officer: "ร.ต.อ.สมชาย",
    fileName: null, downloaded: false, closed: false,
    history: [{ k: 2, filingDeadline: "2026-01-12", legalDeadline: "2026-01-13", fileName: "a.pdf", receivedDate: "2026-01-11" }],
  };
  const { case: result, ok, reason } = returnToPool(rawCase, "เหตุผล", new Date());
  assert.equal(ok, false);
  assert.match(reason, /เคยถูกศาลรับเรื่อง/);
  assert.deepEqual(result, rawCase); // ไม่เปลี่ยนแปลงใดๆ
});

test("returnToPool ปฏิเสธถ้าคดีปิดไปแล้ว", () => {
  const rawCase = { caseNumber: "ฝ.1/2569", startDate: "2026-01-01", k: 4, cap: 48, station: "สภ.บ้านผือ", officer: "พ.ต.ท.ประยุทธ", fileName: null, downloaded: false, closed: true, closedDate: "2026-02-01", history: [] };
  const { ok, reason } = returnToPool(rawCase, "เหตุผล", new Date());
  assert.equal(ok, false);
  assert.match(reason, /ปิดแล้ว/);
});

test("returnToPool ใช้ข้อความอัตโนมัติแทนถ้าไม่ได้ระบุเหตุผล (ไม่บังคับกรอกเหตุผลอีกต่อไป — ตัดสินใจแล้ว)", () => {
  const rawCase = { caseNumber: "ยฝ.1/2569", startDate: "2026-02-01", k: 2, cap: null, station: "สภ.เมืองอุดรธานี", officer: null, fileName: null, downloaded: false, closed: false, history: [] };
  const { case: withoutReason, ok: ok1 } = returnToPool(rawCase, undefined, new Date());
  assert.equal(ok1, true);
  assert.equal(withoutReason.returnedNote.reason, "พนักงานสอบสวนแจ้งว่าไม่ใช่คดีของสถานีนี้");

  const { case: withEmptyString, ok: ok2 } = returnToPool(rawCase, "   ", new Date());
  assert.equal(ok2, true);
  assert.equal(withEmptyString.returnedNote.reason, "พนักงานสอบสวนแจ้งว่าไม่ใช่คดีของสถานีนี้");
});

test("returnToPool ล้าง courtFlag ไปด้วยถ้ามีติดค้างอยู่ก่อนหน้า (ไม่มีความหมายอีกต่อไปเมื่อคดีถูกส่งกลับไปจับคู่สถานีใหม่)", () => {
  const rawCase = { caseNumber: "ยฝ.1/2569", startDate: "2026-02-01", k: 2, cap: null, station: "สภ.เมืองอุดรธานี", officer: "ร.ต.อ.สมชาย", fileName: "a.pdf", downloaded: true, closed: false, history: [], courtFlag: { reason: "ผิดคดี", flaggedAt: "2026-02-04" } };
  const { case: result } = returnToPool(rawCase, "ผิดสถานี", new Date());
  assert.equal(result.courtFlag, null);
});

test("receiveOccasion ไม่มีผลใดๆ ถ้ายังมี courtFlag ค้างอยู่ (ป้องกันรับเรื่องด้วยไฟล์ที่ถูกโต้แย้ง แม้ downloaded=true)", () => {
  const flagged = { caseNumber: "1/2569", startDate: "2026-02-01", k: 2, cap: null, fileName: "ผิดคดี.pdf", downloaded: true, closed: false, history: [], courtFlag: { reason: "ผิดคดี", flaggedAt: "2026-02-05" } };
  const result = receiveOccasion(flagged, NO_HOLIDAYS, null, null, new Date("2026-02-05T12:00:00"));
  assert.deepEqual(result, flagged); // ไม่เปลี่ยนแปลงใดๆ — k ต้องไม่เดินหน้า
});

test("receiveOccasion ไม่มีผลใดๆ ถ้ายังไม่ได้ดาวน์โหลดไฟล์ (กันพลาดสองชั้น)", () => {
  const rawCase = { caseNumber: "1/2569", startDate: "2026-01-01", k: 2, cap: null, fileName: "a.pdf", downloaded: false, closed: false, history: [] };
  const result = receiveOccasion(rawCase, NO_HOLIDAYS);
  assert.deepEqual(result, rawCase); // เหมือนเดิมทุกประการ ไม่มีอะไรเปลี่ยน
});

test("receiveOccasion เดินหน้าไปครั้งถัดไปและบันทึกประวัติ เมื่อยังไม่ครบเพดาน", () => {
  const rawCase = { caseNumber: "1/2569", startDate: "2026-01-01", k: 2, cap: null, fileName: "a.pdf", downloaded: true, closed: false, history: [] };
  const result = receiveOccasion(rawCase, NO_HOLIDAYS, null, null, new Date("2026-01-13"));
  assert.equal(result.k, 3); // เดินหน้าจากครั้งที่ 2 -> 3
  assert.equal(result.fileName, null); // เคลียร์ไฟล์รอครั้งถัดไป
  assert.equal(result.closed, false);
  assert.equal(result.history.length, 1);
  assert.equal(result.history[0].k, 2);
  assert.equal(result.history[0].receivedDate, "2026-01-13");
});

test("receiveOccasion ปิดคดีอัตโนมัติเมื่อรับเรื่องครั้งที่ครบเพดาน 48 วัน (ครั้งที่ 4)", () => {
  const rawCase = { caseNumber: "3/2569", startDate: "2026-01-01", k: 4, cap: 48, fileName: "d.pdf", downloaded: true, closed: false, history: [] };
  const result = receiveOccasion(rawCase, NO_HOLIDAYS);
  assert.equal(result.closed, true);
  assert.equal(result.k, 4); // ค้างที่ครั้งสุดท้าย ไม่เดินหน้าต่อ
  assert.ok(result.closedDate);
});

test("receiveOccasion ปิดคดีอัตโนมัติเมื่อรับเรื่องครั้งที่ครบเพดาน 84 วัน (ครั้งที่ 7)", () => {
  const rawCase = { caseNumber: "5/2569", startDate: "2026-01-01", k: 7, cap: 84, fileName: "g.pdf", downloaded: true, closed: false, history: [] };
  const result = receiveOccasion(rawCase, NO_HOLIDAYS);
  assert.equal(result.closed, true);
});

test("receiveOccasion รับเพดานใหม่พร้อมกับการรับเรื่องครั้งที่ 4 ได้ (จุดที่เจ้าหน้าที่ศาลเลือกเพดาน)", () => {
  const rawCase = { caseNumber: "45/2569", startDate: "2026-01-01", k: 4, cap: null, fileName: "d.pdf", downloaded: true, closed: false, history: [] };
  const result = receiveOccasion(rawCase, NO_HOLIDAYS, 84); // เลือกเพดาน 84 วัน (7 ครั้ง) พร้อมรับเรื่อง
  assert.equal(result.cap, 84);
  assert.equal(result.closed, false); // 4 < 7 ยังไปต่อได้
  assert.equal(result.k, 5);
});

test("receiveOccasion + เลือกเพดาน 48 วันตอนครั้งที่ 4 -> ปิดคดีทันที (4 คือครั้งสุดท้ายของเพดานนี้)", () => {
  const rawCase = { caseNumber: "45/2569", startDate: "2026-01-01", k: 4, cap: null, fileName: "d.pdf", downloaded: true, closed: false, history: [] };
  const result = receiveOccasion(rawCase, NO_HOLIDAYS, 48);
  assert.equal(result.cap, 48);
  assert.equal(result.closed, true);
});

// ---------------------------------------------------------------------------
// จำลอง flow เต็ม: คดีเริ่มครั้งที่ 2 -> รับเรื่องไปเรื่อยๆ จนครบเพดาน 48 วัน -> ต้องปิดที่ครั้งที่ 4 พอดี
// ---------------------------------------------------------------------------
test("จำลอง flow เต็ม: คดีเพดาน 48 วัน ต้องรับเรื่องได้พอดี 3 ครั้ง (2,3,4) แล้วปิด ไม่มีครั้งที่ 5", () => {
  let c = { caseNumber: "999/2569", startDate: "2026-01-01", k: 2, cap: null, fileName: "f2.pdf", downloaded: true, closed: false, history: [] };

  c = receiveOccasion(c, NO_HOLIDAYS); // รับครั้งที่ 2 -> ไปครั้งที่ 3
  assert.equal(c.k, 3);
  assert.equal(c.closed, false);

  c = { ...c, fileName: "f3.pdf", downloaded: true };
  c = receiveOccasion(c, NO_HOLIDAYS); // รับครั้งที่ 3 -> ไปครั้งที่ 4
  assert.equal(c.k, 4);
  assert.equal(c.closed, false);

  c = { ...c, fileName: "f4.pdf", downloaded: true };
  c = receiveOccasion(c, NO_HOLIDAYS, 48); // รับครั้งที่ 4 พร้อมกำหนดเพดาน 48 วัน -> ต้องปิดทันที
  assert.equal(c.closed, true);
  assert.equal(c.history.length, 3); // มีประวัติครบ 3 ครั้ง (2, 3, 4)
  assert.deepEqual(c.history.map((h) => h.k), [2, 3, 4]);
});

// ---------------------------------------------------------------------------
// วันสะสม (cumulativeDays) ใช้เพื่อคำนวณวันครบกำหนดครั้งถัดไปให้แม่นยำเมื่อศาลให้ไม่ครบ 12 วัน
// แต่การปิดคดี (นโยบายที่ยืนยันกับศาลแล้ว) ตัดสินจาก "จำนวนครั้ง" (4/7) โดยตรง ไม่ใช่วันสะสม
// ---------------------------------------------------------------------------
test("ศาลให้ไม่ครบ 12 วันในบางครั้ง -> วันสะสมและวันครบกำหนดครั้งถัดไปคำนวณใหม่ถูกต้อง", () => {
  const rawCase = { caseNumber: "1/2569", startDate: "2026-01-01", k: 2, cap: 48, cumulativeDays: 12, fileName: "f.pdf", downloaded: true, closed: false, history: [] };
  // ศาลให้แค่ 5 วันสำหรับครั้งนี้ (ปกติเต็มที่ 12 วัน)
  const result = receiveOccasion(rawCase, NO_HOLIDAYS, null, 5);
  assert.equal(result.cumulativeDays, 17); // 12 + 5 ไม่ใช่ 12 + 12
  assert.equal(result.k, 3);
  assert.equal(result.closed, false);
  assert.equal(result.history[0].daysGranted, 5);
});

test("นโยบายที่ยืนยันแล้ว: ปิดคดีตัดสินจาก 'จำนวนครั้ง' (4/7) โดยตรง แม้วันสะสมจะยังไม่ถึงเพดานเพราะศาลเคยให้ไม่ครบ 12 วัน", () => {
  let c = { caseNumber: "2/2569", startDate: "2026-01-01", k: 2, cap: 48, cumulativeDays: 12, fileName: "a.pdf", downloaded: true, closed: false, history: [] };
  // รับครั้งที่ 2 ให้แค่ 6 วัน (สะสม 18) — วันสะสมยังห่างจากเพดาน 48 มาก แต่ไม่กระทบการนับครั้ง
  c = receiveOccasion(c, NO_HOLIDAYS, null, 6);
  assert.equal(c.cumulativeDays, 18);
  assert.equal(c.closed, false);

  c = { ...c, fileName: "b.pdf", downloaded: true };
  c = receiveOccasion(c, NO_HOLIDAYS, null, 6); // ครั้งที่ 3 -> สะสม 24, k=4
  c = { ...c, fileName: "c.pdf", downloaded: true };
  c = receiveOccasion(c, NO_HOLIDAYS, null, 6); // ครั้งที่ 4 -> สะสม 30 (ยังไม่ถึงเพดานวัน 48) แต่ครบจำนวนครั้ง 4 แล้ว -> ต้องปิด

  assert.equal(c.closed, true); // ปิดเพราะครบ 4 ครั้ง แม้วันสะสมจะแค่ 30 วัน (ไม่ถึง 48)
  assert.equal(c.cumulativeDays, 30);
});

test("daysAvailable คงที่ 12 วันเสมอ ไม่ว่าวันสะสมจะใกล้จำนวนเท่าไหร่ (ปิดคดีที่จำนวนครั้งแทน ไม่ใช่วันสะสม)", () => {
  const rawCase = { caseNumber: "3/2569", startDate: "2026-01-01", k: 5, cap: 48, cumulativeDays: 40, fileName: null, downloaded: false, closed: false, history: [] };
  const enriched = enrichCase(rawCase, NO_HOLIDAYS, new Date("2026-01-01"));
  assert.equal(enriched.daysAvailable, 12);
});
