// Vercel serverless function: receives leads from the landing page and the
// full apply form, forwards them to Telegram and to a Google Sheets webhook
// (Apps Script).
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

const clean = (val, max) => (val == null ? '' : String(val).trim().slice(0, max));

const EDUC_LABELS = {
  bac_student: 'يدرس في سنة البكالوريا',
  bac_holder: 'حاصل على البكالوريا',
  license: 'يدرس/حاصل على الإجازة',
  master: 'يدرس/حاصل على الماجستير'
};

const DEST_LABELS = {
  lithuania: 'ليتوانيا', russia: 'روسيا', poland: 'بولندا',
  spain: 'إسبانيا', china: 'الصين', other: 'وجهة أخرى'
};

const START_LABELS = {
  '2026_sept': 'سبتمبر 2026', '2027_feb': 'فبراير 2027',
  '2027_sept': 'سبتمبر 2027', not_sure: 'لم يحدد بعد'
};

const BUDGET_LABELS = {
  low: 'أقل من 3000$', mid: '3000–6000$', high: 'أكثر من 6000$', flexible: 'مرن حسب الوجهة'
};

const HEAR_LABELS = {
  facebook: 'فيسبوك / إنستغرام', friend: 'توصية من صديق أو عائلة',
  tiktok: 'تيك توك', google: 'بحث في جوجل', other: 'مصدر آخر'
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};
  const { name, phone } = body;

  if (!name || !phone || typeof name !== 'string' || typeof phone !== 'string') {
    return res.status(400).json({ error: 'name and phone are required' });
  }

  const lead = {
    name: clean(name, 200),
    phone: clean(phone, 40),
    source: clean(body.source, 50) || 'unknown',
    city: clean(body.city, 100),
    educLevel: clean(body.educLevel, 50),
    destination: Array.isArray(body.destination) ? body.destination.map(d => clean(d, 30)).join(', ') : clean(body.destination, 100),
    specialty: clean(body.specialty, 50),
    startDate: clean(body.startDate, 30),
    budget: clean(body.budget, 30),
    hearAbout: clean(body.hearAbout, 30),
    notes: clean(body.notes, 1000),
    eventId: clean(body.eventId, 100),
    eventSourceUrl: clean(body.eventSourceUrl, 300),
    fbp: clean(body.fbp, 100),
    fbc: clean(body.fbc, 100)
  };
  const timestamp = new Date().toISOString();

  const results = { telegram: 'skipped', sheets: 'skipped' };

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (botToken && chatId) {
    try {
      const lines = [
        `🎓 *New lead — Excellence Agency*`,
        `👤 Name: ${lead.name}`,
        `📞 Phone: ${lead.phone}`
      ];
      if (lead.city) lines.push(`🏙 City: ${lead.city}`);
      if (lead.educLevel) lines.push(`📚 Education: ${EDUC_LABELS[lead.educLevel] || lead.educLevel}`);
      if (lead.destination) lines.push(`🌍 Destination: ${lead.destination.split(', ').map(d => DEST_LABELS[d] || d).join(', ')}`);
      if (lead.specialty) lines.push(`🧭 Specialty: ${lead.specialty}`);
      if (lead.startDate) lines.push(`🗓 Start: ${START_LABELS[lead.startDate] || lead.startDate}`);
      if (lead.budget) lines.push(`💰 Budget: ${BUDGET_LABELS[lead.budget] || lead.budget}`);
      if (lead.hearAbout) lines.push(`📣 Heard via: ${HEAR_LABELS[lead.hearAbout] || lead.hearAbout}`);
      if (lead.notes) lines.push(`📝 Notes: ${lead.notes}`);
      lines.push(`📍 Page: ${lead.source}`);
      lines.push(`🕐 ${timestamp}`);

      const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: lines.join('\n'), parse_mode: 'Markdown' })
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
        body: JSON.stringify({ ...lead, timestamp })
      });
      results.sheets = sheetRes.ok ? 'sent' : 'failed';
    } catch (err) {
      results.sheets = 'error';
    }
  }

  return res.status(200).json({ ok: true, results });
}
