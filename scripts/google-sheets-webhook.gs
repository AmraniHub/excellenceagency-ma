/**
 * Excellence Agency — lead webhook for Google Sheets.
 *
 * Setup:
 * 1. Create a new Google Sheet (or open an existing one for leads).
 * 2. Extensions → Apps Script, delete the default code, paste this file's contents.
 * 3. Deploy → New deployment → type "Web app".
 *      - Execute as: Me
 *      - Who has access: Anyone   <-- must be "Anyone", not "Anyone with Google account"
 * 4. Copy the deployment URL (ends in /exec) — that is SHEETS_WEBHOOK_URL in Vercel.
 * 5. Re-run "Deploy → Manage deployments → pencil icon → New version" any time you
 *    edit this file — editing the code alone does NOT update the live /exec URL.
 *
 * Self-test: open the /exec URL directly in your browser. You should see
 * "Excellence Agency lead webhook is live." as plain text — no Google login
 * prompt, no error page. If you see a login prompt or a 404, the deployment's
 * "Who has access" setting is wrong or the URL isn't the deployed one.
 */

const HEADERS = [
  'timestamp', 'name', 'phone', 'source', 'city', 'educLevel',
  'destination', 'specialty', 'startDate', 'budget', 'hearAbout',
  'notes', 'eventId', 'eventSourceUrl', 'fbp', 'fbc'
];

function doGet(e) {
  return ContentService
    .createTextOutput('Excellence Agency lead webhook is live.')
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOutput({ ok: false, error: 'no postData received' });
    }

    const data = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
    }

    const row = HEADERS.map(key => data[key] || '');
    sheet.appendRow(row);

    return jsonOutput({ ok: true });
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function jsonOutput(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
