/**
 * Excellence Agency — lead webhook for Google Sheets.
 *
 * Setup:
 * 1. Create a new Google Sheet (or open an existing one for leads).
 * 2. Extensions → Apps Script, delete the default code, paste this file's contents.
 * 3. Deploy → New deployment → type "Web app".
 *      - Execute as: Me
 *      - Who has access: Anyone
 * 4. Copy the deployment URL (ends in /exec) — that is SHEETS_WEBHOOK_URL in Vercel.
 * 5. Re-run "Deploy → Manage deployments → Edit → New version" any time you edit this file,
 *    otherwise the live webhook keeps running the old code.
 */

const HEADERS = [
  'timestamp', 'name', 'phone', 'source', 'city', 'educLevel',
  'destination', 'specialty', 'startDate', 'budget', 'hearAbout',
  'notes', 'eventId', 'eventSourceUrl', 'fbp', 'fbc'
];

function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
  }

  const data = JSON.parse(e.postData.contents);
  const row = HEADERS.map(key => data[key] || '');
  sheet.appendRow(row);

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
