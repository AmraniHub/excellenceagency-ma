// Vercel serverless function: receives leads from the landing page,
// forwards them to Telegram and to a Google Sheets webhook (Apps Script).
//
// Required environment variables (set in Vercel project settings):
//   TELEGRAM_BOT_TOKEN        - bot token from @BotFather
//   TELEGRAM_CHAT_ID          - chat/group/channel id to receive leads
//   SHEETS_WEBHOOK_URL        - Google Apps Script Web App URL (doPost)
//
// If a variable is missing, that integration is skipped (not fatal) so
// the other one can still succeed. If both are missing, the request
// still returns 200 so the UI doesn't show a false error, but nothing
// is actually delivered anywhere — check Vercel logs.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, phone, source } = req.body || {};

  if (!name || !phone || typeof name !== 'string' || typeof phone !== 'string') {
    return res.status(400).json({ error: 'name and phone are required' });
  }

  const cleanName = name.trim().slice(0, 200);
  const cleanPhone = phone.trim().slice(0, 40);
  const cleanSource = (source || 'unknown').toString().slice(0, 50);
  const timestamp = new Date().toISOString();

  const results = { telegram: 'skipped', sheets: 'skipped' };

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (botToken && chatId) {
    try {
      const text =
        `🎓 *New lead — Excellence Study Agency*\n` +
        `👤 Name: ${cleanName}\n` +
        `📞 Phone: ${cleanPhone}\n` +
        `📍 Source: ${cleanSource}\n` +
        `🕐 ${timestamp}`;

      const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
      });
      results.telegram = tgRes.ok ? 'sent' : 'failed';
    } catch (err) {
      results.telegram = 'error';
    }
  }

  const sheetsUrl = process.env.SHEETS_WEBHOOK_URL;

  if (sheetsUrl) {
    try {
      const sheetRes = await fetch(sheetsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cleanName, phone: cleanPhone, source: cleanSource, timestamp })
      });
      results.sheets = sheetRes.ok ? 'sent' : 'failed';
    } catch (err) {
      results.sheets = 'error';
    }
  }

  return res.status(200).json({ ok: true, results });
}
