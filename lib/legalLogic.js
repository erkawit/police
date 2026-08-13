/**
 * legalLogic.js
 * ---------------------------------------------------------------------------
 * ตรรกะกฎหมายทั้งหมดของระบบติดตามคำร้องขอฝากขัง ศาลจังหวัดอุดรธานี
 * แยกออกมาจาก UI (React) โดยเจตนา เพื่อให้:
 *   1. ทดสอบอัตโนมัติได้ (ดู legalLogic.test.js) โดยไม่ต้อง render หน้าจอ
 *   2. แก้กฎหมาย/ระเบียบใหม่ในอนาคต แก้ที่ไฟล์นี้ไฟล์เดียว ไม่ต้องไล่หาในโค้ด UI
 *   3. ผู้พัฒนาคนอื่น (เช่น ทีมไอทีศาล) เอาไปต่อยอด/ตรวจสอบได้โดยไม่ต้องอ่าน React
 *
 * อ้างอิงกฎหมาย/ระเบียบ:
 *   - ป.วิ.อาญา มาตรา 87 วรรคหก: เพดานฝากขัง 48 วัน (4 ครั้ง) หรือ 84 วัน (7 ครั้ง)
 *     ครั้งละไม่เกิน 12 วัน
 *   - ระเบียบศาลจังหวัดอุดรธานีว่าด้วยการฝากขังทางจอภาพ พ.ศ. 2569
 *     ข้อ 5: ยื่นคำร้องล่วงหน้า 1 วันทำการ ก่อนวันครบกำหนดฝากขังจริง
 *     ข้อ 6: ยื่นทางระบบได้ไม่เกิน 16.00 น. ของวันที่ต้องยื่น เลยเวลานี้ต้องยื่นด้วยตนเอง
 * ---------------------------------------------------------------------------
 */

const DAYS_PER_OCCASION = 12; // ป.วิ.อาญา ม.87: ฝากขังได้ครั้งละไม่เกิน 12 วัน
const FILING_CUTOFF_HOUR = 16; // ข้อ 6: ยื่นทางระบบได้ไม่เกิน 16.00 น.
const PURGE_DAYS = 60; // นโยบายเก็บไฟล์/รายละเอียด 60 วันหลังคดีปิด ก่อนลบถาวร
// นโยบายลบไฟล์ PDF ที่อัพโหลดแล้ว (นับต่อไฟล์ ไม่เกี่ยวกับว่าคดีปิดหรือยัง) — เดิมกำหนดไว้ 3 วัน แต่ปรับเป็น
// 12 วัน (ยืนยันแล้ว) ตามข้อเสนอจากพนักงานสอบสวนจริง: คดีที่ยื่นล่วงหน้าไว้หลายวันก่อนวันครบกำหนดจริง
// (เช่น เตรียมไฟล์รอไว้ก่อนช่วงวันหยุดยาว) 3 วันไม่พอ ไฟล์หมดอายุก่อนถึงวันที่ศาลต้องดาวน์โหลดจริง
const FILE_PURGE_DAYS = 12;
const CAP_MAX_K = { 48: 4, 84: 7 }; // เพดานวัน -> จำนวนครั้งสูงสุด
const MAX_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024; // ข้อกำหนดขนาดไฟล์อัพโหลด: ไม่เกิน 20 MB (เผื่อคดีที่มีเอกสารแนบเยอะ)
const ALLOWED_UPLOAD_EXTENSION = ".pdf"; // รับเฉพาะไฟล์ PDF เท่านั้น ตามที่สเปกระบุว่าเป็นคำร้องขอฝากขังแบบสแกน

// ---------- date primitives (ทำงานกับ ISO date string 'YYYY-MM-DD' เท่านั้น) ----------

// ใช้องค์ประกอบวันที่แบบ local time เสมอ ไม่ใช้ .toISOString() (เป็น UTC เท่านั้น) เพราะจะให้วันที่ผิด
// ไปหนึ่งวันในช่วงเที่ยงคืน-ตี 7 ตามเวลาไทย (UTC+7) — บั๊กนี้พบและแก้ไขจากการทดสอบจริงกับผู้ใช้
function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fromISO(iso) {
  return new Date(iso + "T00:00:00");
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
  return holidays.some((h) => h.date === iso);
}

/**
 * วันทำการล่าสุด ณ หรือก่อนวันที่กำหนด (เดินถอยหลังถ้าตรงวันหยุด/เสาร์-อาทิตย์)
 */
function adjustToBusinessDay(iso, holidays) {
  let d = fromISO(iso);
  while (isWeekend(d) || isHoliday(toISO(d), holidays)) d = addDays(d, -1);
  return toISO(d);
}

/**
 * วันทำการ "ก่อนหน้า" วันที่กำหนด 1 วันทำการ (ข้อ 5: ยื่นล่วงหน้า 1 วันทำการ)
 */
function previousBusinessDay(iso, holidays) {
  let d = addDays(fromISO(iso), -1);
  while (isWeekend(d) || isHoliday(toISO(d), holidays)) d = addDays(d, -1);
  return toISO(d);
}

/**
 * วันครบกำหนดฝากขังดิบ (ยังไม่ปรับวันหยุด) ของการฝากขังครั้งที่ k
 * ครั้งที่ k ครบกำหนด = วันเริ่ม + 12 * (k-1) วัน
 */
function rawDeadline(startISO, k) {
  return toISO(addDays(fromISO(startISO), DAYS_PER_OCCASION * (k - 1)));
}

/**
 * คำนวณวันที่สำคัญทั้งหมดของการฝากขังครั้งที่ k ของคดีหนึ่ง
 * @returns {{ rawDeadline: string, legalDeadline: string, filingDeadline: string }}
 *   rawDeadline    = วันครบกำหนดดิบ (ไม่ปรับวันหยุด)
 *   legalDeadline  = วันครบกำหนดฝากขังจริง (ปรับเลื่อนมาวันทำการก่อนหน้าถ้าตรงวันหยุด)
 *   filingDeadline = วันที่ต้องยื่นคำร้องจริง (ถอยจาก legalDeadline อีก 1 วันทำการ ตามข้อ 5)
 */
function computeDeadlines(startISO, k, holidays) {
  const raw = rawDeadline(startISO, k);
  const legalDeadline = adjustToBusinessDay(raw, holidays);
  const filingDeadline = previousBusinessDay(legalDeadline, holidays);
  return { rawDeadline: raw, legalDeadline, filingDeadline };
}

/**
 * คำนวณวันครบกำหนด/วันต้องยื่นของครั้งที่กำลังจะยื่น จาก "วันสะสม" ที่ใช้ไปแล้วจริง (ไม่ใช่ 12×(k-1) ตายตัว)
 * เพราะศาลอาจให้ฝากขังบางครั้งไม่ครบ 12 วัน ทำให้วันครบกำหนดครั้งถัดไปขยับเร็วขึ้นกว่าสูตรมาตรฐาน
 *
 * หมายเหตุนโยบาย (ยืนยันกับศาลแล้ว): แม้กฎหมาย ป.วิ.อาญา ม.87 วรรคหก จะบังคับทั้ง "ครั้งละไม่เกิน 12 วัน"
 * และ "รวมไม่เกิน 48/84 วัน" แต่ในทางปฏิบัติจำนวนครั้ง (4 หรือ 7) จะถึงเพดานเสมอก่อนหรือพร้อมกับวันสะสม
 * (เพราะทุกครั้งไม่เกิน 12 วันอยู่แล้วเป็นกฎตายตัว) ศาลจึงยืนยันให้ใช้ "จำนวนครั้ง" เป็นตัวตัดสินปิดคดี
 * โดยตรง (ดู receiveOccasion ใน caseEngine.js) — ฟังก์ชันนี้ใช้วันสะสมเพื่อความแม่นยำของ "วันที่" เท่านั้น
 * ไม่ได้มีผลต่อการตัดสินใจปิดคดี
 *
 * @param {string} startISO วันที่ฝากขังครั้งแรก
 * @param {number} cumulativeDays จำนวนวันสะสมที่ใช้ไปแล้วจนถึงสิ้นสุดครั้งก่อนหน้า
 * @param {Array} holidays
 * @returns {{ rawDeadline: string, legalDeadline: string, filingDeadline: string, daysAvailable: number }}
 *   daysAvailable = จำนวนวันสูงสุดที่ครั้งนี้ขอได้ (คงที่ 12 วันเสมอ ตามกฎ "ครั้งละไม่เกิน 12 วัน")
 */
function computeOccasionDeadlines(startISO, cumulativeDays, holidays) {
  const daysAvailable = DAYS_PER_OCCASION; // ครั้งละไม่เกิน 12 วันเสมอ (กฎตายตัว) — ปิดคดีตัดสินจากจำนวนครั้ง ไม่ใช่วันสะสม
  const raw = toISO(addDays(fromISO(startISO), cumulativeDays));
  const legalDeadline = adjustToBusinessDay(raw, holidays);
  const filingDeadline = previousBusinessDay(legalDeadline, holidays);
  return { rawDeadline: raw, legalDeadline, filingDeadline, daysAvailable };
}

/**
 * เลยเวลายื่นทางระบบแล้วหรือยัง (ข้อ 6: ยื่นได้ไม่เกิน 16.00 น. ของวันที่ต้องยื่น)
 * @param {string} filingDeadlineISO
 * @param {Date} [now] ฉีด "เวลาปัจจุบัน" เข้ามาได้เพื่อการทดสอบ (ปกติปล่อยว่างให้ใช้เวลาจริง)
 */
function isPastCutoff(filingDeadlineISO, now = new Date()) {
  const cutoff = fromISO(filingDeadlineISO);
  cutoff.setHours(FILING_CUTOFF_HOUR, 0, 0, 0);
  return now > cutoff;
}

/**
 * จำนวนครั้งสูงสุดที่อนุญาตตามเพดานที่เลือก (null ถ้ายังไม่กำหนดเพดาน)
 */
function capMaxK(cap) {
  return CAP_MAX_K[cap] || null;
}

/**
 * ตรวจว่าคดีที่อยู่ที่ครั้งที่ k จะฝากขังต่อไปอีกครั้ง (k+1) ได้ไหม ถ้ามีเพดานแล้ว
 * คืนค่า true = ฝากต่อได้, false = ครบเพดานแล้ว ห้ามฝากขังต่อ (ต้องไปสู่ขั้นตอนอื่น เช่น สั่งฟ้อง)
 */
function canFileNextOccasion(currentK, cap) {
  const maxK = capMaxK(cap);
  if (!maxK) return true; // ยังไม่ถึงจุดที่ต้องรู้เพดาน (k < 4 ปลอดภัยทั้งสองกลุ่มเพดานเสมอ)
  return currentK < maxK;
}

/**
 * ตรวจสอบไฟล์ที่จะอัพโหลด (ก่อนแม้แต่จะเช็คเรื่องเวลา/สถานะคดี) — เป็นกฎล้วนๆ ไม่รู้จัก "คดี"
 * ใช้ตรวจได้ทั้งฝั่ง client (ก่อนอัพโหลดจริง ประหยัด bandwidth) และฝั่ง server อีกชั้น (กันข้าม client validation)
 *
 * @param {{name: string, sizeBytes: number}} file
 * @returns {{ valid: boolean, reason: string|null }}
 */
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

module.exports = {
  DAYS_PER_OCCASION,
  FILING_CUTOFF_HOUR,
  PURGE_DAYS,
  FILE_PURGE_DAYS,
  CAP_MAX_K,
  MAX_UPLOAD_SIZE_BYTES,
  ALLOWED_UPLOAD_EXTENSION,
  toISO,
  fromISO,
  addDays,
  isWeekend,
  isHoliday,
  adjustToBusinessDay,
  previousBusinessDay,
  rawDeadline,
  computeDeadlines,
  computeOccasionDeadlines,
  isPastCutoff,
  capMaxK,
  canFileNextOccasion,
  validateUploadFile,
};
