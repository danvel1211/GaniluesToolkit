/**
 * Studiolo activation server (Google Apps Script).
 *
 * Runs as YOU inside your Google account. The Studiolo app sends it a licence code and a
 * name; it looks the code up in your private Google Sheet and answers with just
 * ok / used / invalid. A code works once: the first name to activate it is written into the sheet,
 * and after that the code is refused for everyone. The sheet itself is never shared, and its ID is kept in Script
 * Properties, not in this code or in the app.
 *
 * Sheet layout (first sheet, row 1 = headings): a column headed "Licence code" holds the codes. This
 * script adds and fills two more columns, "Activated by" and "Activated on". Other columns (such as
 * "Given to") are left alone.
 *
 * Setup: see activation-server/SETUP.md
 */

var SHEET_PROP = 'SHEET_ID';
var CODE_HEADING = 'Licence code';   // the column that holds the codes
var NAME_HEADING = 'Activated by';   // filled in by this script (created if missing)
var DATE_HEADING = 'Activated on';   // filled in by this script (created if missing)
var CHUNK = 1500000;                 // bytes of the update file sent per request

function doPost(e) {
  var out = { status: 'error' };
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.a === 'update' || body.a === 'chunk') {
      // App updates: only for a licence that is still active. The file stays private in your Drive.
      var who = checkCached_(String(body.c || ''), String(body.n || ''));
      out = who.status !== 'valid' ? { status: 'denied' }
        : body.a === 'update' ? updateInfo_() : updateChunk_(parseInt(body.i, 10));
    } else if (body.a === 'check') {
      // Read-only and very frequent (every app launch): no queue, and "valid" answers are cached for a few minutes.
      out = checkCached_(String(body.c || ''), String(body.n || ''));
    } else {
      // Claiming a code writes to the sheet, so claims go through one at a time.
      var lock = LockService.getScriptLock();
      try {
        lock.waitLock(20000);
        out = claim_(String(body.c || ''), String(body.n || ''));
      } finally {
        try { lock.releaseLock(); } catch (x) { /* not held */ }
      }
    }
  } catch (err) {
    out = { status: 'error' };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function checkCached_(code, name) {
  var cache = CacheService.getScriptCache();
  var key = 'v:' + norm_(code) + ':' + name.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 40);
  if (cache.get(key)) return { status: 'valid' };
  var result = check_(code, name);
  if (result.status === 'valid') cache.put(key, '1', 300);   // a revoked code stops working within 5 minutes
  return result;
}

// Opening the address in a browser shows nothing useful.
function doGet() {
  return ContentService.createTextOutput('{}').setMimeType(ContentService.MimeType.JSON);
}

function norm_(s) {
  return String(s).toUpperCase().replace(/[\s-]/g, '');
}

// Finds a column by its heading in row 1 (1-based), or adds the heading at the end.
function column_(sheet, headings, heading, create) {
  var i = headings.indexOf(heading);
  if (i >= 0) return i + 1;
  if (!create) return 0;
  var col = headings.length + 1;
  sheet.getRange(1, col).setValue(heading);
  headings.push(heading);
  return col;
}

function claim_(code, name) {
  var raw = norm_(code);
  name = name.replace(/\s+/g, ' ').trim();
  if (!/^[0-9A-HJKMNP-TV-Z]{16}$/.test(raw) || !name || name.length > 40) return { status: 'invalid' };

  var id = PropertiesService.getScriptProperties().getProperty(SHEET_PROP);
  var sheet = SpreadsheetApp.openById(id).getSheets()[0];
  var last = sheet.getLastRow();
  var width = sheet.getLastColumn();
  if (last < 2 || width < 1) return { status: 'invalid' };
  var headings = sheet.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h).trim(); });
  var codeCol = column_(sheet, headings, CODE_HEADING, false);
  if (!codeCol) return { status: 'error' };

  var codes = sheet.getRange(2, codeCol, last - 1, 1).getValues();
  for (var i = 0; i < codes.length; i++) {
    if (norm_(codes[i][0]) !== raw) continue;
    var nameCol = column_(sheet, headings, NAME_HEADING, true);
    var dateCol = column_(sheet, headings, DATE_HEADING, true);
    var owner = String(sheet.getRange(i + 2, nameCol).getValue() || '').trim();
    if (owner) return { status: 'used' };   // any name already there, even the same one, means used
    sheet.getRange(i + 2, nameCol).setValue(name);
    sheet.getRange(i + 2, dateCol).setValue(new Date());
    return { status: 'ok' };
  }
  return { status: 'invalid' };
}

// Called every time the app opens: is this code still registered to this name? Changes nothing.
// 'valid' = yes; 'revoked' = the code's Activated-by cell was cleared or holds another name.
function check_(code, name) {
  var raw = norm_(code);
  name = name.replace(/\s+/g, ' ').trim();
  var id = PropertiesService.getScriptProperties().getProperty(SHEET_PROP);
  var sheet = SpreadsheetApp.openById(id).getSheets()[0];
  var last = sheet.getLastRow();
  var width = sheet.getLastColumn();
  if (last < 2 || width < 1) return { status: 'error' };
  var headings = sheet.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h).trim(); });
  var codeCol = column_(sheet, headings, CODE_HEADING, false);
  var nameCol = column_(sheet, headings, NAME_HEADING, false);
  if (!codeCol) return { status: 'error' };
  if (!nameCol) return { status: 'revoked' };
  var codes = sheet.getRange(2, codeCol, last - 1, 1).getValues();
  var owners = sheet.getRange(2, nameCol, last - 1, 1).getValues();
  for (var i = 0; i < codes.length; i++) {
    if (norm_(codes[i][0]) !== raw) continue;
    var owner = String(owners[i][0] || '').replace(/\s+/g, ' ').trim();
    return { status: owner && owner.toLowerCase() === name.toLowerCase() ? 'valid' : 'revoked' };
  }
  return { status: 'revoked' };
}

// What the app is told about the newest version (set with setUpdate below).
function updateInfo_() {
  var p = PropertiesService.getScriptProperties();
  var version = p.getProperty('UPDATE_VERSION'), id = p.getProperty('UPDATE_FILE_ID');
  if (!version || !id) return { status: 'none' };
  var size = parseInt(p.getProperty('UPDATE_SIZE'), 10);
  return {
    status: 'ok', version: version, notes: p.getProperty('UPDATE_NOTES') || '',
    sha256: p.getProperty('UPDATE_SHA256'), size: size, chunks: Math.ceil(size / CHUNK)
  };
}

// One slice of the update file, base64-encoded, read straight from your private Drive file.
function updateChunk_(i) {
  var p = PropertiesService.getScriptProperties();
  var id = p.getProperty('UPDATE_FILE_ID'), size = parseInt(p.getProperty('UPDATE_SIZE'), 10);
  if (!id || isNaN(i) || i < 0 || i * CHUNK >= size) return { status: 'error' };
  var bytes = DriveApp.getFileById(id).getBlob().getBytes();
  return { status: 'ok', data: Utilities.base64Encode(bytes.slice(i * CHUNK, Math.min(size, (i + 1) * CHUNK))) };
}

/**
 * Publishing an update (run from the editor, once per new version):
 *   1. Upload the new Studiolo.exe to your Drive (keep it private).
 *   2. Put its file ID, the new version number and a short note below, then Run this function.
 * The ID is the long part of the file's link between /d/ and /view.
 */
function setUpdate() {
  var fileId = 'PASTE-THE-EXE-FILE-ID-HERE';
  var version = '1.1.0';
  var notes = 'What is new in this version.';

  var bytes = DriveApp.getFileById(fileId).getBlob().getBytes();
  if (bytes.length < 1000000 || bytes[0] !== 77 || bytes[1] !== 90) throw new Error('That file does not look like Studiolo.exe');
  var hex = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(function (b) {
    return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2);
  }).join('');
  PropertiesService.getScriptProperties().setProperties({
    UPDATE_FILE_ID: fileId, UPDATE_VERSION: version, UPDATE_NOTES: notes,
    UPDATE_SHA256: hex, UPDATE_SIZE: String(bytes.length)
  });
  Logger.log('Update ' + version + ' published: ' + bytes.length + ' bytes, sha256 ' + hex);
}

/**
 * Run once from the editor to store the sheet's ID privately: put the ID (the long part of the
 * sheet's address between /d/ and /edit) in place of the text below, run this, then delete the ID again.
 */
function setSheetId() {
  var id = 'PASTE-YOUR-SHEET-ID-HERE';
  PropertiesService.getScriptProperties().setProperty(SHEET_PROP, id);
}
