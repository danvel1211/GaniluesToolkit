/**
 * Studiolo activation server (Google Apps Script).
 *
 * Runs as YOU inside your Google account. The Studiolo app sends it a licence code and a
 * name; it looks the code up in your private Google Sheet and answers with just
 * ok / used / invalid. A code works once: the first name to activate it is written into the sheet,
 * and after that the code is refused for everyone. The sheet itself is never shared, and its ID is kept in Script
 * Properties, not in this code or in the app.
 *
 * Sheet layout (first sheet, row 1 = headings):
 *   A: Code      B: Name (filled in by this script)      C: Activated (date, filled in by this script)
 *
 * Setup: see activation-server/SETUP.md
 */

var SHEET_PROP = 'SHEET_ID';

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

function claim_(code, name) {
  var raw = norm_(code);
  name = name.replace(/\s+/g, ' ').trim();
  if (!/^[0-9A-HJKMNP-TV-Z]{16}$/.test(raw) || !name || name.length > 40) return { status: 'invalid' };

  var id = PropertiesService.getScriptProperties().getProperty(SHEET_PROP);
  var sheet = SpreadsheetApp.openById(id).getSheets()[0];
  var last = sheet.getLastRow();
  if (last < 2) return { status: 'invalid' };
  var rows = sheet.getRange(2, 1, last - 1, 2).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (norm_(rows[i][0]) !== raw) continue;
    var owner = String(rows[i][1] || '').trim();
    if (!owner) {
      sheet.getRange(i + 2, 2, 1, 2).setValues([[name, new Date()]]);
      return { status: 'ok' };
    }
    // Name cell empty = first use (registered above). Any name already there, even the same one, means used.
    return { status: 'used' };
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
