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

function doPost(e) {
  var out = { status: 'error' };
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var body = JSON.parse(e.postData.contents);
    out = claim_(String(body.c || ''), String(body.n || ''));
  } catch (err) {
    out = { status: 'error' };
  } finally {
    try { lock.releaseLock(); } catch (x) { /* not held */ }
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
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

/**
 * Run once from the editor to store the sheet's ID privately: put the ID (the long part of the
 * sheet's address between /d/ and /edit) in place of the text below, run this, then delete the ID again.
 */
function setSheetId() {
  var id = 'PASTE-YOUR-SHEET-ID-HERE';
  PropertiesService.getScriptProperties().setProperty(SHEET_PROP, id);
}
