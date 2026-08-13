/**
 * caseEngine.js
 * ---------------------------------------------------------------------------
 * ชั้นตรรกะ "ระดับคดี" ที่ต่อยอดจาก legalLogic.js — เป็นตัวอย่างจริงว่า UI (React)
 * ควรเรียกใช้ legalLogic.js อย่างไร แทนที่จะมีสำเนาฟังก์ชันซ้ำอยู่ในไฟล์หน้าจอเอง
 *
 * แนวคิด: legalLogic.js = "กฎหมายล้วนๆ" (วันที่, เพดาน, เวลาตัด)
 *         caseEngine.js  = "นำกฎหมายมาใช้กับคดีจริง" (object คดี, ประวัติ, สถานะ)
 *         UI (React)     = แสดงผล + รับ input เท่านั้น ไม่ควรมีตรรกะกฎหมายอยู่เลย
 * ---------------------------------------------------------------------------
 */

const {
  computeOccasionDeadlines,
  isPastCutoff,
  toISO,
  fromISO,
  addDays,
  validateUploadFile,
  FILE_PURGE_DAYS,
} = require("./legalLogic");

/**
 * วันนับถึงวันหนึ่งจากวันนี้ (บวก = ยังไม่ถึง, ลบ = เลยมาแล้ว)
 */
function daysUntil(iso, now = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const target = new Date(iso + "T00:00:00");
  return Math.round((target - today) / 86400000);
}

/**
 * เติมข้อมูลที่คำนวณได้ (วันครบกำหนด/วันยื่น/สถานะ) ให้กับ object คดีดิบ
 * นี่คือฟังก์ชันที่ UI เรียกแทนการคำนวณเอง — input/output เป็น plain object ล้วนๆ
 * ไม่ผูกกับ React เลย จึงทดสอบและนำไปใช้ซ้ำได้ในทุกบริบท (เว็บ, script, cron job)
 *
 * cumulativeDays: ถ้าคดีไม่มีค่านี้เก็บไว้ (ข้อมูลเก่า) จะสมมติว่าทุกครั้งก่อนหน้าได้เต็ม 12 วัน (12*(k-1))
 */
function enrichCase(rawCase, holidays, now = new Date()) {
  const cumulativeDays = rawCase.cumulativeDays ?? (12 * (rawCase.k - 1));
  const { rawDeadline, legalDeadline, filingDeadline, daysAvailable } = computeOccasionDeadlines(rawCase.startDate, cumulativeDays, holidays);
  // ไฟล์ PDF ที่อัพโหลดแล้วถูกลบอัตโนมัติ FILE_PURGE_DAYS วันหลังอัพโหลด — ถ้ายังไม่ถูกดาวน์โหลดก่อนหมดอายุ
  // ถือว่าไฟล์หายแล้ว ต้องอัพโหลดใหม่ (เดิมตรรกะนี้เคยมีอยู่แค่ในไฟล์เดโม ไม่เคยอยู่ใน lib/ นี้เลย — ย้ายมาไว้
  // ที่นี่ให้ถูกต้อง เพื่อให้ทดสอบอัตโนมัติได้เหมือนกฎอื่นๆ)
  const filePurgeDate = rawCase.uploadedAt ? toISO(addDays(fromISO(rawCase.uploadedAt), FILE_PURGE_DAYS)) : null;
  const fileExpired = Boolean(rawCase.fileName && !rawCase.downloaded && filePurgeDate && daysUntil(filePurgeDate, now) < 0);
  const status = deriveStatus({ ...rawCase, filingDeadline, fileExpired }, now);
  return { ...rawCase, cumulativeDays, daysAvailable, rawDeadline, legalDeadline, filingDeadline, filePurgeDate, fileExpired, status };
}

/**
 * สถานะของคดี ณ เวลาหนึ่ง (ใช้ตัดสินสีป้าย/การแจ้งเตือนใน UI)
 */
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

/**
 * ประมวลผล "รับเรื่อง" คำร้องหนึ่งครั้ง — คืนคดีที่อัพเดตแล้ว (ครั้งถัดไป หรือปิดคดีถ้าครบจำนวนครั้ง)
 * บันทึกประวัติ (history) ของครั้งที่เพิ่งรับเรื่องไปด้วยเสมอ พร้อมจำนวนวันที่ศาลอนุญาตจริง
 *
 * นโยบาย (ยืนยันกับศาลแล้ว): ปิดคดีตัดสินจาก "จำนวนครั้ง" (4 หรือ 7) โดยตรง ไม่ใช่วันสะสม — เพราะทุกครั้ง
 * ฝากขังได้ไม่เกิน 12 วันอยู่แล้วเป็นกฎตายตัว ทำให้จำนวนครั้งถึงเพดานเสมอก่อนหรือพร้อมกับวันสะสม จึงไม่จำเป็น
 * ต้องเช็ควันสะสมซ้ำอีกชั้น — cumulativeDays ยังคงถูกติดตามไว้เพื่อคำนวณ "วันครบกำหนดครั้งถัดไป" ให้แม่นยำ
 * เท่านั้น (เผื่อศาลให้บางครั้งไม่ครบ 12 วัน วันครบกำหนดครั้งถัดไปจะขยับเร็วขึ้นตามจริง)
 *
 * @param {object} rawCase คดีก่อนรับเรื่อง (ต้องมี fileName และ downloaded=true แล้ว)
 * @param {object} holidays รายการวันหยุด
 * @param {number|null} newCap ถ้าเจ้าหน้าที่ศาลกำหนดเพดานพร้อมกันในการรับเรื่องครั้งนี้ (ไม่งั้นเป็น null = ใช้ cap เดิม)
 * @param {number|null} actualDays จำนวนวันที่ศาลอนุญาตจริงสำหรับครั้งนี้ (ถ้าไม่ระบุ ใช้ 12 วันเต็ม) —
 *   ใช้เมื่อศาลให้ไม่ครบ 12 วันในบางครั้ง เพื่อความแม่นยำของวันครบกำหนดครั้งถัดไป
 * @param {Date} [now]
 */
/**
 * เช็คว่าคดีนี้ยังอัพโหลด/อัพโหลดทับไฟล์ของครั้งปัจจุบันได้อยู่ไหม ณ ตอนนี้ (เช็คแค่เวลา/สถานะคดี
 * ไม่เช็คตัวไฟล์ — ใช้เปิด/ปิดปุ่มอัพโหลดใน UI ล่วงหน้าได้โดยยังไม่ต้องมีไฟล์จริงในมือ)
 */
function canUploadFile(rawCase, holidays, now = new Date()) {
  if (rawCase.closed) return false;
  const cumulativeDays = rawCase.cumulativeDays ?? (12 * (rawCase.k - 1));
  const { filingDeadline } = computeOccasionDeadlines(rawCase.startDate, cumulativeDays, holidays);
  return !isPastCutoff(filingDeadline, now);
}

/**
 * อัพโหลด/อัพโหลดทับไฟล์คำร้องของครั้งปัจจุบัน — ใช้ทั้งอัพโหลดครั้งแรกและกรณีอัพโหลดผิดไฟล์แล้วต้องแก้ไข
 *
 * ตรวจ 2 ชั้นก่อนยอมรับไฟล์:
 *   1. ตัวไฟล์เอง (นามสกุล .pdf เท่านั้น, ขนาดไม่เกิน MAX_UPLOAD_SIZE_BYTES) — ดู validateUploadFile ใน legalLogic.js
 *   2. จังหวะเวลา/สถานะคดี (ยังไม่เลย cutoff 16.00 น. ตามข้อ 6, คดียังไม่ปิด) — ดู canUploadFile ด้านบน
 *
 * นโยบาย (ยืนยันแล้ว): ไม่ต้องมีระบบ undo/audit ซับซ้อน — แค่เปิดโอกาสให้อัพโหลดทับได้ตราบใดที่ยังไม่เลย
 * เวลาตัดและศาลยังไม่กด "รับเรื่อง" (receiveOccasion) ไปแล้ว เพราะหลังรับเรื่องไปแล้วระบบเคลียร์
 * fileName/downloaded กลับเป็นค่าว่างสำหรับครั้งถัดไปอยู่แล้วโดยธรรมชาติ จึงไม่มีทาง "อัพทับ" ไฟล์ของครั้ง
 * ที่ปิดไปแล้วได้อยู่แล้วในตัว ไม่ต้องเช็คเพิ่ม
 *
 * สำคัญ: ทุกครั้งที่อัพโหลดสำเร็จ (ครั้งแรกหรือทับของเดิม) ต้องรีเซ็ต downloaded กลับเป็น false เสมอ
 * เพื่อบังคับให้เจ้าหน้าที่ศาลดาวน์โหลดไฟล์ "ใหม่" อีกครั้งก่อนกดรับเรื่องได้ — กันกรณีศาลดาวน์โหลด
 * ไฟล์เก่า (ที่ผิด) ไปแล้ว แล้วดันกดรับเรื่องด้วยไฟล์ผิดนั้นทั้งที่พนักงานอัพไฟล์ถูกทับไปแล้ว
 *
 * @param {object} rawCase คดีที่จะอัพโหลดไฟล์เข้าไป
 * @param {{name: string, sizeBytes: number}} file ไฟล์ที่จะอัพโหลด (ของจริงคือ path/URL ใน Google Drive
 *   หลังอัพขึ้นจริงแล้ว — ในเลเยอร์นี้รับแค่ metadata ที่จำเป็นต่อการตรวจสอบ)
 * @param {object} holidays รายการวันหยุด (ใช้คำนวณ filingDeadline ปัจจุบันเพื่อเช็คเวลาตัด)
 * @param {Date} [now]
 * @returns {{ case: object, ok: boolean, reason: string|null }}
 *   case = คดีที่อัพเดตแล้ว (ถ้า ok=true) หรือคดีเดิมไม่เปลี่ยนแปลง (ถ้า ok=false)
 *   reason = ข้อความเหตุผลที่ปฏิเสธ ให้ UI เอาไปแสดงตรงๆ ได้เลย (null ถ้าสำเร็จ)
 */
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
  // อัพโหลดใหม่สำเร็จ -> เคลียร์ courtFlag เสมอ (ถ้าเคยถูกศาลแจ้งว่าไฟล์ผิด) เพราะถือว่าพนักงานแก้ไขแล้ว
  // ไม่ลบ fileName เดิมเป็นขั้นตอนแยก — ไฟล์เดิมถูกแทนที่ ณ จุดนี้เองโดยธรรมชาติของการอัพทับ (นโยบายยืนยันแล้ว)
  // ต้องบันทึก uploadedAt ใหม่ทุกครั้งด้วย (แม้เป็นการอัพทับ) เพื่อให้นับ FILE_PURGE_DAYS จากไฟล์ล่าสุดเสมอ
  return { case: { ...rawCase, fileName: file.name, downloaded: false, courtFlag: null, uploadedAt: toISO(now) }, ok: true, reason: null };
}

/**
 * เจ้าหน้าที่ศาลแจ้งว่าไฟล์ที่พนักงานอัพโหลดมาไม่ถูกต้อง (เช่น ผิดคดี) หลังตรวจดูแล้ว — ให้พนักงานอัพโหลดใหม่แทน
 *
 * นโยบาย (ยืนยันแล้ว): ไม่ลบไฟล์เดิมทันทีตอนแจ้ง — เก็บไว้ก่อนเผื่อเทียบหลัง จะถูกแทนที่ก็ต่อเมื่อพนักงานอัพโหลดไฟล์ใหม่
 * สำเร็จเท่านั้น (ดู uploadFile ด้านบนที่เคลียร์ courtFlag ให้อัตโนมัติตอนอัพสำเร็จ) ไม่ต้องมีระบบ undo/audit ซับซ้อน
 * เพิ่มเติม — สอดคล้องกับแนวทางเดียวกับกรณีอัพโหลดไฟล์ผิดคดีที่ตกลงกันไว้ก่อนหน้า (ดูข้อ 5.3 ใน SPEC.md)
 *
 * @param {object} rawCase
 * @param {string} reason ข้อความเหตุผลที่ศาลแจ้ง (จะโชว์ให้พนักงานเห็นตอนล็อกอินเข้ามาดูคดีนี้)
 * @param {Date} [now]
 * @returns {{ case: object, ok: boolean, reason: string|null }}
 */
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
    return rawCase; // ตามกติกา: ยังไม่ดาวน์โหลด รับเรื่องไม่มีผลใดๆ
  }
  if (rawCase.courtFlag) {
    return rawCase; // ศาลเพิ่งแจ้งว่าไฟล์นี้ผิด ยังไม่ควรรับเรื่องด้วยไฟล์ที่ถูกโต้แย้งอยู่ — ต้องรอพนักงานอัพโหลดใหม่ก่อน (เคลียร์ courtFlag อัตโนมัติ)
  }
  const cap = newCap !== null ? newCap : rawCase.cap;
  const cumulativeDays = rawCase.cumulativeDays ?? (12 * (rawCase.k - 1));
  const { legalDeadline, filingDeadline, daysAvailable } = computeOccasionDeadlines(rawCase.startDate, cumulativeDays, holidays);
  const grantedDays = actualDays != null ? Math.max(1, Math.min(12, actualDays)) : daysAvailable;
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

  const capMaxK = cap === 48 ? 4 : cap === 84 ? 7 : null;
  if (capMaxK && rawCase.k >= capMaxK) {
    return { ...rawCase, cap, cumulativeDays: newCumulativeDays, closed: true, closedDate: toISO(now), fileName: null, downloaded: false, history };
  }
  return { ...rawCase, cap, cumulativeDays: newCumulativeDays, k: rawCase.k + 1, fileName: null, downloaded: false, history };
}

/**
 * ฝั่งตำรวจ "คืนสำนวน" — พนักงานตรวจแล้วพบว่าเจ้าหน้าที่ศาลจับคู่สถานีผิด (ไม่ใช่คดีของสภ.ตัวเอง)
 * เคลียร์ station/officer/fileName กลับเป็นค่าว่างทั้งหมด ส่งคดีกลับไปที่กองจับคู่สถานีของศาลใหม่ พร้อม
 * returnedNote บอกศาลว่าเคยจับคู่ผิดสถานีไหนมาแล้ว กันจับคู่ผิดซ้ำที่เดิม
 *
 * นโยบาย (ยืนยันแล้ว): ไม่บังคับให้พนักงานกรอกเหตุผล — กด "คืนสำนวน" แล้วยืนยันครั้งเดียวจบ ถ้าไม่ได้ส่ง reason
 * มาจะใช้ข้อความอัตโนมัติแทน (ลดขั้นตอนการใช้งานจริง เพราะบริบทชัดอยู่แล้วว่าคดีไม่ใช่ของสถานีนี้)
 *
 * จำกัดเฉพาะคดีที่ยังไม่เคยถูกศาลรับเรื่องเลยสักครั้ง (`history` ว่างเปล่า) เท่านั้น เพื่อกันไม่ให้การคืนสำนวน
 * ลบล้างประวัติการฝากขังจริงที่เกิดขึ้นไปแล้ว — ถ้าคดีผ่านการรับเรื่องมาแล้วอย่างน้อยหนึ่งครั้ง ต้องแก้ไขผ่าน
 * เจ้าหน้าที่ศาลโดยตรง ไม่ใช่ผ่านฟังก์ชันนี้ (นอกขอบเขตที่ตกลงกันไว้)
 *
 * @param {object} rawCase
 * @param {string} [reason] ข้อความเหตุผลที่พนักงานระบุตอนคืนสำนวน (ไม่บังคับ — มีค่าเริ่มต้นอัตโนมัติถ้าไม่ระบุ)
 * @param {Date} [now]
 * @returns {{ case: object, ok: boolean, reason: string|null }}
 */
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

module.exports = {
  daysUntil,
  enrichCase,
  deriveStatus,
  canUploadFile,
  uploadFile,
  flagWrongFile,
  returnToPool,
  receiveOccasion,
};
