// staff_mobile_api.gs - Google Apps Script backend for doclick.tw staff mobile app
// Deploy this script as a Web App (Execute the app as: Me, Who has access: Anyone, even anonymous)
// Then copy the deployed URL into config.json's apiUrl field.

// === Configuration ===
var SCRIPT_PROPERTIES = PropertiesService.getScriptProperties();
// Optional: you can set a Spreadsheet ID via script property "SPREADSHEET_ID".
// If not set, a new spreadsheet will be created automatically.
var SPREADSHEET_ID = SCRIPT_PROPERTIES.getProperty('SPREADSHEET_ID');

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  var params = e.parameter || {};
  var action = params.action || '';
  var response = { ok: false, message: '未知 action', data: null };
  try {
    // Ensure required sheets exist
    var ss = getOrCreateSpreadsheet();
    // Dispatch based on action
    switch (action) {
      // ---- Personnel ----
      case 'personnel_get':
        response = personnelGet(ss, params);
        break;
      case 'personnel_update':
        response = personnelUpdate(ss, params);
        break;
      case 'personnel_review':
        // GET list pending, POST approve/reject
        if (e.method === 'GET') {
          response = personnelReviewList(ss, params);
        } else {
          response = personnelReviewProcess(ss, params);
        }
        break;
      case 'personnel_history':
        response = personnelHistory(ss, params);
        break;

      // ---- SOP ----
      case 'sop_get':
        response = sopGet(ss, params);
        break;
      case 'sop_save':
        response = sopSave(ss, params);
        break;
      case 'sop_delete':
        response = sopDelete(ss, params);
        break;
      case 'sop_publish':
        response = sopPublish(ss, params);
        break;
      case 'sop_folder':
        response = { ok: true, data: getOrCreateSopFolder().getId() };
        break;
      case 'sop_upload':
        response = sopUpload(params);
        break;
      default:
        response = { ok: false, message: '未支援的 action: ' + action };
    }
  } catch (err) {
    response = { ok: false, message: err.message || String(err) };
  }
  return ContentService
    .createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- Helper: Spreadsheet ----------
function getOrCreateSpreadsheet() {
  if (SPREADSHEET_ID) {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  // Create a new spreadsheet in the user's Drive
  var ss = SpreadsheetApp.create('doclick_tw_backend_' + new Date().toISOString());
  SCRIPT_PROPERTIES.setProperty('SPREADSHEET_ID', ss.getId());
  // Create required sheets
  createRequiredSheets(ss);
  return ss;
}

function createRequiredSheets(ss) {
  // Personnel review (pending) sheet
  var pending = ss.insertSheet('PersonnelReview');
  pending.appendRow(['requestId','staffId','staffName','submittedAt','field','oldValue','newValue','reviewStatus','reviewedBy','reviewedAt','reviewNote']);
  // Personnel history sheet
  var history = ss.insertSheet('PersonnelHistory');
  history.appendRow(['requestId','staffId','staffName','submittedAt','field','oldValue','newValue','reviewStatus','reviewedBy','reviewedAt','reviewNote']);
  // SOP sheet
  var sop = ss.insertSheet('SOP');
  sop.appendRow(['id','category','title','content','images','tableData','attachments','importantNote','sortOrder','published','createdAt','updatedAt']);
  // SOP Attachments meta sheet (optional, used for quick lookup)
  var attach = ss.insertSheet('SOPAttachments');
  attach.appendRow(['fileId','fileName','fileType','fileUrl','uploadedAt']);
}

function getOrCreateSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }
  return sheet;
}

// ---------- Helper: Drive ----------
function getOrCreateSopFolder() {
  var folderName = '愜易居_SOP附件';
  var folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  }
  return DriveApp.createFolder(folderName);
}

// ---------- Personnel ----------
function personnelGet(ss, params) {
  var staffId = params.staffId || '';
  if (!staffId) return { ok: false, message: '缺少 staffId' };
  // Assume the official staff data lives in a sheet named "StaffData" (managed elsewhere).
  var staffSheet = ss.getSheetByName('StaffData');
  if (!staffSheet) return { ok: false, message: '未找到 StaffData 工作表' };
  var data = staffSheet.getDataRange().getValues();
  var headers = data.shift();
  var idx = headers.findIndex(h => /^(code|id|staffId|employeeId|staff|realName)$/i.test(h));
  if (idx < 0) return { ok: false, message: 'StaffData 中無法識別員工編號欄位' };
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][idx]) === String(staffId)) {
      var rowObj = {};
      headers.forEach((h, j) => rowObj[h] = data[i][j]);
      return { ok: true, data: rowObj };
    }
  }
  return { ok: false, message: '找不到該員工資料' };
}

function personnelUpdate(ss, params) {
  var staffId = params.staffId || '';
  if (!staffId) return { ok: false, message: '缺少 staffId' };
  var staffName = params.staffName || '';
  var pendingSheet = getOrCreateSheet(ss, 'PersonnelReview', ['requestId','staffId','staffName','submittedAt','field','oldValue','newValue','reviewStatus','reviewedBy','reviewedAt','reviewNote']);
  var requestId = Utilities.getUuid();
  var submittedAt = new Date().toISOString();
  // For each mutable field, compare with current value and create a row if changed.
  var mutable = ['phone','mobile','tel','email','address','contactAddress','emergencyContact','emergencyPhone','bank','bankName','bankBranch','bankAccount','accountNo'];
  var staffSheet = ss.getSheetByName('StaffData');
  if (!staffSheet) return { ok: false, message: '未找到 StaffData 工作表' };
  var data = staffSheet.getDataRange().getValues();
  var headers = data.shift();
  var staffIdx = headers.findIndex(h => /^(code|id|staffId|employeeId|staff|realName)$/i.test(h));
  var staffRow = null;
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][staffIdx]) === String(staffId)) {
      staffRow = data[i];
      break;
    }
  }
  if (!staffRow) return { ok: false, message: '員工不存在於 StaffData' };

  mutable.forEach(field => {
    var paramVal = params[field] || '';
    if (paramVal === undefined) return;
    var colIdx = headers.findIndex(h => new RegExp('^' + field + '$', 'i').test(h));
    var oldVal = colIdx >= 0 ? staffRow[colIdx] : '';
    if (String(oldVal) !== String(paramVal)) {
      pendingSheet.appendRow([requestId, staffId, staffName, submittedAt, field, oldVal, paramVal, 'pending', '', '', '']);
    }
  });
  return { ok: true, message: '已建立待審核紀錄' };
}

function personnelReviewList(ss, params) {
  var sheet = getOrCreateSheet(ss, 'PersonnelReview', []);
  var data = sheet.getDataRange().getValues();
  var headers = data.shift();
  var pending = data.filter(row => row[headers.indexOf('reviewStatus')] === 'pending');
  var result = pending.map(row => {
    var obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
  return { ok: true, data: result };
}

function personnelReviewProcess(ss, params) {
  var decision = params.decision; // approve or reject
  var requestId = params.id || params.requestId;
  var reviewNote = params.reviewNote || '';
  var reviewer = params.reviewer || 'admin'; // you may replace with actual admin ID
  var sheet = getOrCreateSheet(ss, 'PersonnelReview', []);
  var data = sheet.getDataRange().getValues();
  var headers = data.shift();
  var idx = data.findIndex(row => row[headers.indexOf('requestId')] === requestId);
  if (idx < 0) return { ok: false, message: '找不到審核項目' };
  var row = data[idx];
  var statusCol = headers.indexOf('reviewStatus');
  var reviewedByCol = headers.indexOf('reviewedBy');
  var reviewedAtCol = headers.indexOf('reviewedAt');
  var reviewNoteCol = headers.indexOf('reviewNote');
  row[statusCol] = decision === 'approve' ? 'approved' : 'rejected';
  row[reviewedByCol] = reviewer;
  row[reviewedAtCol] = new Date().toISOString();
  row[reviewNoteCol] = reviewNote;
  // Write back entire sheet (simple approach)
  sheet.getRange(2,1, data.length, headers.length).setValues(data);

  // If approved, update official StaffData
  if (decision === 'approve') {
    var staffId = row[headers.indexOf('staffId')];
    var field = row[headers.indexOf('field')];
    var newValue = row[headers.indexOf('newValue')];
    var staffSheet = ss.getSheetByName('StaffData');
    if (!staffSheet) return { ok: false, message: '未找到 StaffData 工作表' };
    var staffData = staffSheet.getDataRange().getValues();
    var staffHeaders = staffData.shift();
    var staffIdx = staffHeaders.findIndex(h => /^(code|id|staffId|employeeId|staff|realName)$/i.test(h));
    var staffRowIdx = staffData.findIndex(r => String(r[staffIdx]) === String(staffId));
    if (staffRowIdx < 0) return { ok: false, message: '員工在 StaffData 中不存在' };
    var colIdx = staffHeaders.findIndex(h => new RegExp('^' + field + '$', 'i').test(h));
    if (colIdx >= 0) {
      staffSheet.getRange(staffRowIdx + 2, colIdx + 1).setValue(newValue);
    }
  }

  // Move processed record to history sheet
  var historySheet = getOrCreateSheet(ss, 'PersonnelHistory', []);
  var historyData = historySheet.getDataRange().getValues();
  // Append row to history
  historySheet.appendRow(row);
  // Remove from pending (re-fetch data without the processed row)
  data.splice(idx,1);
  sheet.getRange(2,1, data.length, headers.length).clearContent();
  if (data.length > 0) {
    sheet.getRange(2,1, data.length, headers.length).setValues(data);
  }
  return { ok: true, message: decision === 'approve' ? '核准完成' : '退回完成' };
}

function personnelHistory(ss, params) {
  var sheet = getOrCreateSheet(ss, 'PersonnelHistory', []);
  var data = sheet.getDataRange().getValues();
  var headers = data.shift();
  return { ok: true, data: data.map(row => {
    var obj = {};
    headers.forEach((h,i)=>obj[h]=row[i]);
    return obj;
  }) };
}

// ---------- SOP ----------
function sopGet(ss, params) {
  var sheet = getOrCreateSheet(ss, 'SOP', []);
  var data = sheet.getDataRange().getValues();
  var headers = data.shift();
  // Optional filters: id, category, published, etc.
  var filtered = data.filter(row => {
    var keep = true;
    if (params.id) keep = keep && row[headers.indexOf('id')] === params.id;
    if (params.category) keep = keep && row[headers.indexOf('category')] === params.category;
    if (params.published) keep = keep && String(row[headers.indexOf('published')]) === String(params.published);
    return keep;
  });
  var result = filtered.map(row => {
    var obj = {};
    headers.forEach((h,i)=>obj[h]=row[i]);
    return obj;
  });
  return { ok: true, data: result };
}

function sopSave(ss, params) {
  var sheet = getOrCreateSheet(ss, 'SOP', []);
  var headers = sheet.getDataRange().offset(0,0,1,1).getValues()[0]; // first row headers
  var id = params.id || Utilities.getUuid();
  var now = new Date().toISOString();
  var rowIdx = -1;
  var data = sheet.getDataRange().getValues();
  var rows = data.slice(1);
  var idCol = headers.indexOf('id');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][idCol] === id) { rowIdx = i+2; break; }
  }
  var values = [];
  // Ensure consistent order of columns
  var cols = ['id','category','title','content','images','tableData','attachments','importantNote','sortOrder','published','createdAt','updatedAt'];
  cols.forEach(col => {
    var v = params[col] !== undefined ? params[col] : (rowIdx ? sheet.getRange(rowIdx, headers.indexOf(col)+1).getValue() : '');
    if (col === 'createdAt') v = rowIdx ? v : now;
    if (col === 'updatedAt') v = now;
    values.push(v);
  });
  if (rowIdx) {
    sheet.getRange(rowIdx,1,1,cols.length).setValues([values]);
  } else {
    sheet.appendRow(values);
  }
  return { ok: true, message: rowIdx ? '已更新 SOP' : '已新增 SOP', data: { id: id } };
}

function sopDelete(ss, params) {
  var id = params.id;
  if (!id) return { ok: false, message: '缺少 id' };
  var sheet = getOrCreateSheet(ss, 'SOP', []);
  var data = sheet.getDataRange().getValues();
  var headers = data.shift();
  var idCol = headers.indexOf('id');
  var rowIdx = data.findIndex(r => r[idCol] === id);
  if (rowIdx < 0) return { ok: false, message: '找不到 SOP' };
  // Delete the row (shift up)
  sheet.deleteRow(rowIdx + 2);
  return { ok: true, message: '已刪除 SOP' };
}

function sopPublish(ss, params) {
  var id = params.id;
  var publish = params.publish; // true / false
  if (!id) return { ok: false, message: '缺少 id' };
  var sheet = getOrCreateSheet(ss, 'SOP', []);
  var data = sheet.getDataRange().getValues();
  var headers = data.shift();
  var idCol = headers.indexOf('id');
  var publishCol = headers.indexOf('published');
  var rowIdx = data.findIndex(r => r[idCol] === id);
  if (rowIdx < 0) return { ok: false, message: '找不到 SOP' };
  sheet.getRange(rowIdx + 2, publishCol + 1).setValue(publish);
  return { ok: true, message: publish ? '已發佈' : '已下架' };
}

// ---------- SOP Upload ----------
function sopUpload(params) {
  var fileName = params.fileName;
  var mimeType = params.mimeType || '';
  var base64Data = params.fileData; // Expected to be base64 string without data URI prefix
  if (!fileName || !base64Data) return { ok: false, message: '缺少檔案資訊' };
  var folder = getOrCreateSopFolder();
  var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);
  var file = folder.createFile(blob);
  var fileId = file.getId();
  var fileUrl = file.getUrl();
  var uploadedAt = new Date().toISOString();
  // Store meta in SOPAttachments sheet
  var ss = getOrCreateSpreadsheet();
  var attachSheet = getOrCreateSheet(ss, 'SOPAttachments', ['fileId','fileName','fileType','fileUrl','uploadedAt']);
  attachSheet.appendRow([fileId, fileName, mimeType, fileUrl, uploadedAt]);
  return {
    ok: true,
    data: {
      fileId: fileId,
      fileName: fileName,
      fileType: mimeType,
      fileUrl: fileUrl,
      uploadedAt: uploadedAt
    }
  };
}

// ---------- Utility ----------
function isValidAction(action) {
  var allowed = ['personnel_get','personnel_update','personnel_review','personnel_history','sop_get','sop_save','sop_delete','sop_publish','sop_folder','sop_upload'];
  return allowed.indexOf(action) >= 0;
}

// Export a function for testing (optional)
function test() {
  // placeholder
}
