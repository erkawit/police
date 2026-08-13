/**
 * e-REDT System - Google Apps Script Web App Backend
 * Google Sheet ID: 1Y-OA9B8cPRwTcILCB9lmLny2GrfcEnNqR5i07lTGDM4
 * Target Drive Folder: https://drive.google.com/drive/u/2/folders/1l5ZDlXI14lgFc6WGqmZ3kQ9qB-ci-ArM
 * Root Admin: admin / caogikojt02 (Permanent System Root Account)
 * ศาลจังหวัดอุดรธานี — ระบบติดตามคำร้องขอฝากขังออนไลน์
 */

const SPREADSHEET_ID = '1Y-OA9B8cPRwTcILCB9lmLny2GrfcEnNqR5i07lTGDM4';
const DEFAULT_DRIVE_FOLDER_ID = '1l5ZDlXI14lgFc6WGqmZ3kQ9qB-ci-ArM';

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) ? e.parameter.action : 'getRequests';
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  // 1. GET USERS (Tab: users)
  if (action === 'getUsers') {
    const sheet = ss.getSheetByName('users') || initUsersSheet(ss);
    const rows = sheet.getDataRange().getValues();
    
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
    return responseJSON(users);
  }
  
  // 2. GET HOLIDAYS (Tab: holidays)
  if (action === 'getHolidays') {
    const sheet = ss.getSheetByName('holidays') || initHolidaysSheet(ss);
    const rows = sheet.getDataRange().getValues();
    if (rows.length <= 1) return responseJSON([]);
    
    const holidays = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r[0]) continue;
      holidays.push({
        date: toISODate(r[0]),
        name: String(r[1])
      });
    }
    return responseJSON(holidays);
  }
  
  // 3. GET REQUESTS (Tab: data or requests)
  const sheet = ss.getSheetByName('data') || ss.getSheetByName('requests') || initRequestsSheet(ss);
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return responseJSON([]);
  
  const requests = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue;
    
    requests.push({
      caseNumber: String(r[0]),
      type: String(r[1] || 'ฝ.'),
      startDate: toISODate(r[2]),
      k: Number(r[3]) || 2,
      cap: Number(r[4]) || 84,
      cumulativeDays: Number(r[5]) || 12,
      station: r[6] ? String(r[6]) : null,
      officer: r[7] ? String(r[7]) : null,
      fileName: r[8] ? String(r[8]) : null,
      fileUrl: r[9] ? String(r[9]) : null,
      downloaded: r[10] === true || String(r[10]).toUpperCase() === 'TRUE',
      closed: r[11] === true || String(r[11]).toUpperCase() === 'TRUE',
      closedDate: r[12] ? toISODate(r[12]) : null,
      courtFlag: r[13] ? parseJSON(r[13]) : null,
      returnedNote: r[14] ? parseJSON(r[14]) : null,
      history: r[15] ? parseJSON(r[15]) : [],
      createdAt: r[16] ? String(r[16]) : ''
    });
  }
  return responseJSON(requests);
}

function doPost(e) {
  try {
    const postData = JSON.parse(e.postData.contents);
    const action = postData.action;
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    // 1. SAVE ALL REQUESTS (Tab: data)
    if (action === 'saveRequests' || action === 'createRequest' || action === 'deleteRequest') {
      const sheet = ss.getSheetByName('data') || ss.getSheetByName('requests') || initRequestsSheet(ss);
      const oldRows = sheet.getDataRange().getValues();
      
      const reqList = postData.requests || [];
      if (action === 'createRequest' && postData.caseNumber) {
        reqList.push(postData);
      }

      // Automatically delete/trash associated PDF files in Google Drive when a data case is removed
      if (oldRows && oldRows.length > 1) {
        const newCaseNumbers = new Set(reqList.map(r => String(r.caseNumber || r.detentionNo || '').trim()));
        for (let i = 1; i < oldRows.length; i++) {
          const oldCaseNum = String(oldRows[i][0] || '').trim();
          const oldFileUrl = String(oldRows[i][9] || '').trim();
          
          if (oldCaseNum && (!newCaseNumbers.has(oldCaseNum) || (action === 'deleteRequest' && postData.caseNumber === oldCaseNum)) && oldFileUrl) {
            try {
              let fileId = null;
              const match1 = oldFileUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
              const match2 = oldFileUrl.match(/id=([a-zA-Z0-9_-]+)/);
              if (match1) fileId = match1[1];
              else if (match2) fileId = match2[1];

              if (fileId) {
                DriveApp.getFileById(fileId).setTrashed(true);
              }
            } catch (errDrive) {
              Logger.log('Warning trashing Drive file for case ' + oldCaseNum + ': ' + errDrive);
            }
          }
        }
      }

      sheet.clearContents();
      sheet.appendRow(['CaseNumber', 'Type', 'StartDate', 'K', 'Cap', 'CumulativeDays', 'Station', 'Officer', 'FileName', 'FileUrl', 'Downloaded', 'Closed', 'ClosedDate', 'CourtFlag', 'ReturnedNote', 'History', 'CreatedAt']);
      
      reqList.forEach(item => {
        if (!item.caseNumber && item.detentionNo) item.caseNumber = item.detentionNo;
        if (!item.caseNumber) return;

        sheet.appendRow([
          item.caseNumber,
          item.type || 'ฝ.',
          item.startDate || new Date().toISOString().split('T')[0],
          item.k || 2,
          item.cap || 84,
          item.cumulativeDays || 12,
          item.station || item.policeStation || '',
          item.officer || item.officerName || '',
          item.fileName || '',
          item.fileUrl || item.driveLink || '',
          item.downloaded || false,
          item.closed || false,
          item.closedDate || '',
          item.courtFlag ? (typeof item.courtFlag === 'string' ? item.courtFlag : JSON.stringify(item.courtFlag)) : '',
          item.returnedNote ? (typeof item.returnedNote === 'string' ? item.returnedNote : JSON.stringify(item.returnedNote)) : '',
          item.history ? (typeof item.history === 'string' ? item.history : JSON.stringify(item.history)) : '[]',
          item.createdAt || new Date().toISOString()
        ]);
      });
      return responseJSON({ success: true, count: reqList.length });
    }

    // 2. UPLOAD PDF FILE TO GOOGLE DRIVE (Subfolder by สภ.)
    if (action === 'uploadFile') {
      let fileUrl = '';
      let fileName = postData.fileName;
      const folderId = postData.driveFolderId || DEFAULT_DRIVE_FOLDER_ID;

      if (postData.fileData && postData.fileName) {
        const bytes = Utilities.base64Decode(postData.fileData.split(',')[1] || postData.fileData);
        const blob = Utilities.newBlob(bytes, 'application/pdf', postData.fileName);
        
        let targetFolder;
        try {
          targetFolder = DriveApp.getFolderById(folderId);
        } catch (err) {
          targetFolder = DriveApp.getRootFolder();
        }
        
        const stationName = postData.station || postData.policeStation || 'ทั่วไป';
        const folders = targetFolder.getFoldersByName(stationName);
        let stationFolder;
        
        // Use existing subfolder if found, otherwise create subfolder
        if (folders.hasNext()) {
          stationFolder = folders.next();
        } else {
          stationFolder = targetFolder.createFolder(stationName);
        }
        
        const file = stationFolder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        fileUrl = file.getUrl();
      }

      return responseJSON({ success: true, fileName: fileName, fileUrl: fileUrl });
    }

    // 3. SAVE USER & SAVE USERS (Tab: users)
    if (action === 'saveUser' || action === 'saveUsers') {
      const sheet = ss.getSheetByName('users') || initUsersSheet(ss);
      
      if (action === 'saveUsers' || postData.users) {
        const userList = postData.users || [];
        sheet.clearContents();
        sheet.appendRow(['Username', 'Password', 'Role', 'Station', 'Name', 'Status']);
        userList.forEach(u => {
          const uname = u.username ? String(u.username).trim() : '';
          if (!uname) return;
          const pass = uname === 'admin' ? 'caogikojt02' : (u.password || '123456');
          const role = uname === 'admin' ? 'admin' : (u.role || 'officer');
          const name = u.name ? String(u.name).trim() : uname;
          sheet.appendRow([uname, pass, role, u.station || '', name, u.status || 'approved']);
        });
        return responseJSON({ success: true, count: userList.length });
      }

      const username = postData.username ? String(postData.username).trim() : '';
      if (!username) {
        return responseJSON({ success: false, error: 'Empty username' });
      }

      const rows = sheet.getDataRange().getValues();
      let foundIndex = -1;
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]).trim() === username) {
          foundIndex = i + 1;
          break;
        }
      }
      const pass = username === 'admin' ? 'caogikojt02' : (postData.password || '123456');
      const role = username === 'admin' ? 'admin' : (postData.role || 'officer');
      const name = postData.name ? String(postData.name).trim() : username;

      if (foundIndex > 0) {
        sheet.getRange(foundIndex, 2).setValue(pass);
        sheet.getRange(foundIndex, 3).setValue(role);
        sheet.getRange(foundIndex, 4).setValue(postData.station || '');
        sheet.getRange(foundIndex, 5).setValue(name);
        sheet.getRange(foundIndex, 6).setValue('approved');
      } else {
        sheet.appendRow([username, pass, role, postData.station || '', name, 'approved']);
      }
      return responseJSON({ success: true });
    }

    // 4. SAVE HOLIDAYS (Tab: holidays)
    if (action === 'saveHolidays') {
      const sheet = ss.getSheetByName('holidays') || initHolidaysSheet(ss);
      sheet.clearContents();
      sheet.appendRow(['Date', 'Name']);
      (postData.holidays || []).forEach(h => {
        sheet.appendRow([h.date, h.name]);
      });
      return responseJSON({ success: true });
    }

    return responseJSON({ success: false, error: 'Unknown action' });

  } catch (err) {
    return responseJSON({ success: false, error: err.toString() });
  }
}

function initRequestsSheet(ss) {
  const s = ss.insertSheet('requests');
  s.appendRow(['CaseNumber', 'Type', 'StartDate', 'K', 'Cap', 'CumulativeDays', 'Station', 'Officer', 'FileName', 'FileUrl', 'Downloaded', 'Closed', 'ClosedDate', 'CourtFlag', 'ReturnedNote', 'History', 'CreatedAt']);
  return s;
}

function initUsersSheet(ss) {
  const s = ss.insertSheet('users');
  s.appendRow(['Username', 'Password', 'Role', 'Station', 'Name', 'Status']);
  s.appendRow(['admin', 'caogikojt02', 'admin', '', 'ผู้ดูแลระบบสูงสุด (System Admin)', 'approved']);
  return s;
}

function initHolidaysSheet(ss) {
  const s = ss.insertSheet('holidays');
  s.appendRow(['Date', 'Name']);
  return s;
}

function parseJSON(str) {
  try {
    return typeof str === 'string' ? JSON.parse(str) : str;
  } catch (e) {
    return null;
  }
}

/**
 * แปลง Date object หรือ string ต่างๆ ที่ได้จาก Google Sheet
 * ให้เป็น ISO date string รูปแบบ YYYY-MM-DD เสมอ
 * ถ้า val ว่างหรือ invalid คืนค่า ''
 */
function toISODate(val) {
  if (!val) return '';
  var d;
  if (val instanceof Date) {
    d = val;
  } else {
    var str = String(val).trim();
    if (!str || str.toLowerCase() === 'date' || str === 'วันที่') return '';
    if (str.includes('/')) {
      var parts = str.split('/');
      if (parts.length === 3) {
        var p1 = parseInt(parts[0], 10);
        var p2 = parseInt(parts[1], 10);
        var p3 = parseInt(parts[2], 10);
        if (p3 > 2400) p3 -= 543;
        if (p1 > 2400) p1 -= 543;
        if (p1 > 31) {
          d = new Date(p1, p2 - 1, p3);
        } else {
          d = new Date(p3, p2 - 1, p1);
        }
      }
    } else if (str.includes('-')) {
      var parts = str.split('-');
      if (parts.length === 3) {
        var y = parseInt(parts[0], 10);
        if (y > 2400) y -= 543;
        var m = parseInt(parts[1], 10) - 1;
        var day = parseInt(parts[2], 10);
        d = new Date(y, m, day);
      }
    }
    if (!d || isNaN(d.getTime())) d = new Date(str);
  }
  if (!d || isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function responseJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
