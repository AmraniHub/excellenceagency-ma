// Vercel serverless function: receives leads from the landing page and the
// full apply form, forwards them to Telegram, Google Sheets, and the Meta
// Conversions API.
//
// Required / optional environment variables (set in Vercel project settings):
//   TELEGRAM_BOT_TOKEN        - bot token from @BotFather
//   TELEGRAM_CHAT_ID          - chat/group/channel id to receive leads
//   TELEGRAM_BOT_TOKEN_2      - optional second bot token (broadcasts to a second chat too)
//   TELEGRAM_CHAT_ID_2        - optional second bot's chat id
//   SHEETS_WEBHOOK_URL        - Google Apps Script Web App URL (doPost)
//   META_CAPI_ACCESS_TOKEN    - Conversions API access token (Events Manager → Settings → Conversions API)
//
// If a variable is missing, that integration is skipped (not fatal) so the
// others can still succeed. The request still returns 200 so the UI doesn't
// show a false error even if nothing is configured — check Vercel logs.

import { createHash } from 'crypto';

const META_PIXEL_ID = '2423938361461208';

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

async function sendTelegram(token, chatId, text) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
    });
    return res.ok ? 'sent' : 'failed';
  } catch (err) {
    return 'error';
  }
}

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

  const results = { telegram: 'skipped', telegram2: 'skipped', sheets: 'skipped', metaCapi: 'skipped' };

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
  const text = lines.join('\n');

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (botToken && chatId) {
    results.telegram = await sendTelegram(botToken, chatId, text);
  }

  const botToken2 = process.env.TELEGRAM_BOT_TOKEN_2;
  const chatId2 = process.env.TELEGRAM_CHAT_ID_2;
  if (botToken2 && chatId2) {
    results.telegram2 = await sendTelegram(botToken2, chatId2, text);
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

  const capiToken = process.env.META_CAPI_ACCESS_TOKEN;

  if (capiToken && lead.eventId) {
    try {
      const normalizedPhone = lead.phone.replace(/\D/g, '');
      const hashedPhone = normalizedPhone ? createHash('sha256').update(normalizedPhone).digest('hex') : undefined;
      const forwardedFor = req.headers['x-forwarded-for'];
      const clientIp = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(',')[0]?.trim();

      const capiRes = await fetch(`https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events?access_token=${capiToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: [{
            event_name: 'Lead',
            event_time: Math.floor(Date.now() / 1000),
            event_id: lead.eventId,
            event_source_url: lead.eventSourceUrl || undefined,
            action_source: 'website',
            user_data: {
              ph: hashedPhone ? [hashedPhone] : undefined,
              client_ip_address: clientIp,
              client_user_agent: req.headers['user-agent'],
              fbp: lead.fbp || undefined,
              fbc: lead.fbc || undefined
            },
            custom_data: {
              content_name: lead.source
            }
          }]
        })
      });
      results.metaCapi = capiRes.ok ? 'sent' : 'failed';
    } catch (err) {
      results.metaCapi = 'error';
    }
  }

  return res.status(200).json({ ok: true, results });
}
