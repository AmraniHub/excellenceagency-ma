#!/usr/bin/env node
// Billing state machine for a client site. Works for both kinds of client:
//
//   Vercel site   — has site-status.js; suspension takes the whole site dark.
//   Shopify theme — has snippets/; only paid ADD-ONS are gated. The storefront
//                   and checkout are never touched, because taking a live shop
//                   offline to collect a small monthly fee costs the client far
//                   more than the invoice.
//
// Which one applies is detected from the files present, so the same script
// ships to every client repo unchanged.
//
//   node .github/scripts/billing.cjs accrue
//       Adds this month's subscribed services to the balance. Idempotent
//       within a calendar month, so a retry can never double-charge.
//
//   node .github/scripts/billing.cjs apply '<json>'
//       Applies a dashboard update. Accepts balanceDue, currency,
//       services ({ id: { active, fee } }), and suspend ("auto"|"true"|"false").
//
// Prints "unchanged" and exits 0 when there is nothing to do, so the calling
// workflow can skip the commit.

const fs = require('fs');
const path = require('path');

const BILLING_FILE = 'billing.json';
const STATUS_FILE = 'site-status.js';
const NOTICE_FILE = 'suspended.html';
const SNIPPETS_DIR = 'snippets';
const GATE_FILE = path.join(SNIPPETS_DIR, 'subscription-gate.liquid');
const SUSPENDED_RE = /^(export const suspended = )(true|false);/m;
const AMOUNT_RE = /<!--amount-->[\s\S]*?<!--\/amount-->/;

// Known services. `label` is what the client sees on the notice page.
// `fee` is the MONTHLY rate even for services that default to yearly — the
// yearly price is derived from it, so the two terms stay comparable.
// `defaultPeriod` only sets what a service starts as; any period can be chosen
// per client in the dashboard.
const CATALOG = {
  hosting: { label: 'Hébergement', fee: 8 },
  maintenance: { label: 'Maintenance', fee: 10 },
  optimizations: { label: 'Optimisations', fee: 2 },
  // Sold as annual commitments: cash up front, 19% off, and no monthly chasing.
  theme: { label: 'Licence du thème', fee: 2, defaultPeriod: 'yearly' },
  chatbot: { label: 'Assistant IA', fee: 12, defaultPeriod: 'yearly' },
  crm: { label: 'CRM', fee: 13, defaultPeriod: 'yearly' },
  // Charged to REMOVE the agency credit from the footer. Active means the
  // client is paying for a clean footer, so the credit is hidden.
  whitelabel: { label: 'Sans marque (white-label)', fee: 5, defaultPeriod: 'yearly' },
  // Billed once on setup, never renewed.
  pagespeed: { label: 'Optimisation PageSpeed', fee: 15, defaultPeriod: 'once' }
};

// Add-ons that render something in a Shopify theme. Anything not listed here
// is billing-only — it has no widget to switch off.
const THEME_WIDGETS = {
  chatbot: { active: 'chatbot', suspended: 'chatbot-suspended' }
};

function fail(message) {
  console.error(`billing: ${message}`);
  process.exit(1);
}

// Paying for a year up front earns a discount off twelve monthly payments.
const YEARLY_DISCOUNT = 0.19;

function money(value) {
  // Keep to cents; stops fractional fees drifting across months of accrual.
  return Math.round(Number(value) * 100) / 100;
}

const PERIODS = ['monthly', 'yearly', 'once'];

// What one charge costs. For monthly and yearly, `fee` is the monthly rate so
// the two stay comparable; for a one-off, `fee` is simply the price.
function chargeAmount(item) {
  return item.period === 'yearly'
    ? money(item.fee * 12 * (1 - YEARLY_DISCOUNT))
    : money(item.fee);
}

// Months between two 'YYYY-MM' keys.
function monthsBetween(from, to) {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

function readBilling() {
  let raw;
  try {
    raw = fs.readFileSync(BILLING_FILE, 'utf8');
  } catch {
    fail(`${BILLING_FILE} not found`);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    fail(`${BILLING_FILE} is not valid JSON: ${err.message}`);
  }

  const seededPeriod = typeof data.lastAccrual === 'string' ? data.lastAccrual.slice(0, 7) : '';

  let items;
  if (Array.isArray(data.items)) {
    items = data.items.map((item) => ({
      id: String(item.id || ''),
      label: String(item.label || CATALOG[item.id]?.label || item.id || ''),
      fee: money(item.fee ?? 0),
      period: PERIODS.includes(item.period) ? item.period : 'monthly',
      active: item.active === true,
      // Items predating per-service tracking inherit the client's last accrual,
      // so migrating cannot cause a second charge in the same month.
      lastCharged: typeof item.lastCharged === 'string' ? item.lastCharged : seededPeriod
    }));
  } else {
    // Back-compat with the original single-fee format, so a repo that hasn't
    // been migrated yet keeps working instead of erroring on the next accrual.
    items = [{
      id: 'hosting',
      label: CATALOG.hosting.label,
      fee: money(data.monthlyFee ?? 0),
      period: 'monthly',
      active: true,
      lastCharged: seededPeriod
    }];
  }

  if (items.some((i) => !i.id || !Number.isFinite(i.fee) || i.fee < 0)) {
    fail('every item needs an id and a fee >= 0');
  }

  const balanceDue = money(data.balanceDue ?? 0);
  if (!Number.isFinite(balanceDue) || balanceDue < 0) fail('balanceDue must be a number >= 0');

  return {
    currency: typeof data.currency === 'string' && data.currency ? data.currency : '$',
    items,
    balanceDue,
    lastAccrual: typeof data.lastAccrual === 'string' ? data.lastAccrual : ''
  };
}

function writeBilling(billing) {
  fs.writeFileSync(BILLING_FILE, `${JSON.stringify(billing, null, 2)}\n`);
}

// What the plan costs per month on average — a yearly line spreads its
// discounted charge across twelve months so the figure stays comparable.
function monthlyTotal(billing) {
  return money(billing.items.filter((i) => i.active && i.period !== 'once').reduce(
    (sum, i) => sum + (i.period === 'yearly' ? chargeAmount(i) / 12 : i.fee), 0));
}

// --- enforcement -----------------------------------------------------------

function setVercelSuspended(shouldSuspend) {
  const source = fs.readFileSync(STATUS_FILE, 'utf8');
  const match = source.match(SUSPENDED_RE);
  if (!match) fail(`could not find the suspended flag in ${STATUS_FILE}`);

  if ((match[2] === 'true') === shouldSuspend) return false;
  fs.writeFileSync(STATUS_FILE, source.replace(SUSPENDED_RE, `$1${shouldSuspend};`));
  return true;
}

// Renders the amount block on the Vercel notice page. Escapes nothing by hand
// because every value here is a number or a validated currency mark.
function writeNoticeAmount(billing) {
  if (!fs.existsSync(NOTICE_FILE)) return false;

  const cur = billing.currency;
  const fmt = (n) => `${Number(n).toFixed(2).replace(/\.00$/, '')} ${cur}`;
  const active = billing.items.filter((i) => i.active);
  const monthly = monthlyTotal(billing);

  let block;
  if (billing.balanceDue > 0) {
    // What they owe now, what it costs per month, and the annual alternative —
    // the discount is the reason to settle for a year rather than chase monthly.
    const yearly = money(monthly * 12 * (1 - YEARLY_DISCOUNT));
    const lines = [
      `<div class="amount">Montant dû : ${fmt(billing.balanceDue)}</div>`,
      active.length
        ? `<p class="terms">Abonnement mensuel : ${fmt(monthly)} / mois` +
          (monthly > 0
            ? `<br>Ou ${fmt(yearly)} / an — soit ${Math.round(YEARLY_DISCOUNT * 100)}% d'économie.`
            : '') +
          `</p>`
        : ''
    ];
    block = lines.filter(Boolean).join('\n    ');
  } else {
    block = `<div class="amount">Veuillez contacter votre agence pour le montant dû.</div>`;
  }

  const next = `<!--amount-->\n    ${block}\n    <!--/amount-->`;
  const source = fs.readFileSync(NOTICE_FILE, 'utf8');
  if (!AMOUNT_RE.test(source)) {
    fail(`${NOTICE_FILE} has no <!--amount--> block to fill in`);
  }

  const updated = source.replace(AMOUNT_RE, next);
  if (updated === source) return false;
  fs.writeFileSync(NOTICE_FILE, updated);
  return true;
}

// Writes the render call directly rather than Liquid conditionals: `render`
// runs in an isolated scope, so a snippet cannot hand variables back to
// theme.liquid. Generating the decision here keeps the theme side trivial.
function writeShopifyGate(billing, shouldSuspend) {
  const lines = [
    '{%- comment -%}',
    '  Generated from billing.json by .github/workflows — do not edit by hand.',
    '  Any manual change is overwritten on the next billing update.',
    '',
    '  Only paid add-ons are gated here. The storefront is never affected.',
    '{%- endcomment -%}'
  ];

  // `render` accepts parameters, so the live figures are passed in rather than
  // hardcoded in the snippet — otherwise the notice goes stale the moment a
  // service is added to the plan.
  const fmt = (n) => `${Number(n).toFixed(2).replace(/\.00$/, '')} ${billing.currency}`;

  for (const [id, widget] of Object.entries(THEME_WIDGETS)) {
    const item = billing.items.find((i) => i.id === id);
    if (!item || !item.active) continue;

    if (!shouldSuspend) {
      lines.push(`{%- render '${widget.active}' -%}`);
      continue;
    }
    lines.push(
      `{%- render '${widget.suspended}'` +
      `, monthly: '${fmt(monthlyTotal(billing))}'` +
      `, balance: '${fmt(billing.balanceDue)}' -%}`
    );
  }

  // The agency credit shows unless the client pays to have it removed, so
  // subscribing to white-label is what takes it away.
  const whitelabel = billing.items.find((i) => i.id === 'whitelabel');
  if (!whitelabel?.active) lines.push(`{%- render 'agency-credit' -%}`);

  const next = `${lines.join('\n')}\n`;
  const current = fs.existsSync(GATE_FILE) ? fs.readFileSync(GATE_FILE, 'utf8') : '';
  if (current === next) return false;

  fs.mkdirSync(SNIPPETS_DIR, { recursive: true });
  fs.writeFileSync(GATE_FILE, next);
  return true;
}

function enforce(billing, shouldSuspend) {
  let changed = false;
  if (fs.existsSync(STATUS_FILE)) changed = setVercelSuspended(shouldSuspend) || changed;
  if (fs.existsSync(SNIPPETS_DIR)) changed = writeShopifyGate(billing, shouldSuspend) || changed;
  // The amount is refreshed even while the site is live, so the notice is
  // already correct the moment a suspension takes effect.
  changed = writeNoticeAmount(billing) || changed;
  return changed;
}

// --- commands --------------------------------------------------------------

function todayIso() {
  return new Date().toISOString().slice(0, 10); // runners are UTC
}

function summarise(billing, shouldSuspend) {
  const active = billing.items.filter((i) => i.active);
  const parts = active.map((i) => i.period === 'yearly'
    ? `${i.label} ${billing.currency}${chargeAmount(i)}/an`
    : `${i.label} ${billing.currency}${i.fee}`);
  return (
    `balance ${billing.currency}${billing.balanceDue}, ` +
    `${parts.length ? parts.join(' + ') : 'no services'} ` +
    `≈ ${billing.currency}${monthlyTotal(billing)}/mo, ` +
    `${shouldSuspend ? 'gated' : 'running'}`
  );
}

function accrue() {
  const billing = readBilling();
  const period = todayIso().slice(0, 7);

  // Each service runs on its own cycle: monthly lines charge every month,
  // yearly lines only once the twelve months they paid for have elapsed.
  const charges = [];
  for (const item of billing.items) {
    if (!item.active || item.fee <= 0) continue;
    // A one-off is charged the first time it is seen and never again.
    if (item.period === 'once') {
      if (item.lastCharged) continue;
    } else {
      const every = item.period === 'yearly' ? 12 : 1;
      if (item.lastCharged && monthsBetween(item.lastCharged, period) < every) continue;
    }

    const amount = chargeAmount(item);
    billing.balanceDue = money(billing.balanceDue + amount);
    item.lastCharged = period;
    const suffix = item.period === 'yearly' ? '/an' : item.period === 'once' ? ' (unique)' : '';
    charges.push(`${item.label} ${billing.currency}${amount}${suffix}`);
  }

  if (!charges.length) {
    console.log(`unchanged (nothing due for ${period})`);
    return false;
  }

  billing.lastAccrual = todayIso();
  writeBilling(billing);

  const shouldSuspend = billing.balanceDue > 0;
  enforce(billing, shouldSuspend);
  console.log(`charged ${charges.join(' + ')} for ${period} — ${summarise(billing, shouldSuspend)}`);
  return true;
}

function apply(rawJson) {
  if (!rawJson) fail('apply requires a JSON argument');

  let update;
  try {
    update = JSON.parse(rawJson);
  } catch (err) {
    fail(`update is not valid JSON: ${err.message}`);
  }

  const billing = readBilling();
  const before = JSON.stringify(billing);

  if (update.balanceDue !== undefined) {
    const next = money(update.balanceDue);
    if (!Number.isFinite(next) || next < 0) fail('balanceDue must be a number >= 0');
    billing.balanceDue = next;
  }

  if (update.currency !== undefined) {
    // Rendered on the public notice page, so only real currency marks pass.
    if (typeof update.currency !== 'string' || !/^[A-Za-z$€£¥.]{1,4}$/.test(update.currency)) {
      fail('currency must be 1-4 characters, letters or a currency symbol');
    }
    billing.currency = update.currency;
  }

  if (update.services !== undefined) {
    if (typeof update.services !== 'object' || update.services === null) {
      fail('services must be an object keyed by service id');
    }

    for (const [id, change] of Object.entries(update.services)) {
      if (!CATALOG[id]) fail(`unknown service "${id}"`);
      if (typeof change !== 'object' || change === null) fail(`services.${id} must be an object`);

      let item = billing.items.find((i) => i.id === id);
      if (!item) {
        item = {
          id, label: CATALOG[id].label, fee: CATALOG[id].fee,
          period: CATALOG[id].defaultPeriod || 'monthly', active: false, lastCharged: ''
        };
        billing.items.push(item);
      }

      if (change.fee !== undefined) {
        const fee = money(change.fee);
        if (!Number.isFinite(fee) || fee < 0) fail(`services.${id}.fee must be a number >= 0`);
        item.fee = fee;
      }

      if (change.period !== undefined) {
        if (!PERIODS.includes(change.period)) {
          fail(`services.${id}.period must be one of: ${PERIODS.join(', ')}`);
        }
        item.period = change.period;
      }

      // Anchors the renewal cycle. Set this when a client has already paid for
      // a year elsewhere: a yearly line anchored to 2026-03 next renews in
      // 2027-03 rather than being charged again now. Empty means "never
      // charged", so the next accrual bills it.
      if (change.lastCharged !== undefined) {
        if (change.lastCharged !== '' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(change.lastCharged)) {
          fail(`services.${id}.lastCharged must be YYYY-MM or empty`);
        }
        item.lastCharged = change.lastCharged;
      }

      if (change.active !== undefined) {
        if (typeof change.active !== 'boolean') fail(`services.${id}.active must be true or false`);
        item.active = change.active;
      }
    }
  }

  // A one-off charge billed immediately rather than waiting for the 8th —
  // a setup fee the client has just agreed to. The label lands in the commit
  // message, which is what the payment history displays.
  let chargeNote = '';
  if (update.charge !== undefined) {
    const { amount, label } = update.charge || {};
    const value = money(amount);
    if (!Number.isFinite(value) || value <= 0) fail('charge.amount must be a number > 0');

    // Sanitised because it becomes a git commit message.
    const clean = String(label || 'Frais ponctuel')
      .replace(/[^\w\s\-().,'€$£¥éèêàçûôîÉÈÀÇ]/g, '')
      .trim()
      .slice(0, 60) || 'Frais ponctuel';

    billing.balanceDue = money(billing.balanceDue + value);
    chargeNote = `${clean} — ${billing.currency}${value}`;
  }

  const mode = update.suspend === undefined ? 'auto' : String(update.suspend);
  if (!['auto', 'true', 'false'].includes(mode)) fail('suspend must be "auto", "true" or "false"');
  const shouldSuspend = mode === 'auto' ? billing.balanceDue > 0 : mode === 'true';

  const billingChanged = JSON.stringify(billing) !== before;
  if (billingChanged) writeBilling(billing);
  const enforcementChanged = enforce(billing, shouldSuspend);

  if (!billingChanged && !enforcementChanged) {
    console.log('unchanged');
    return false;
  }

  // The workflow uses this as the commit message, so an ad-hoc charge is
  // self-describing in the payment history rather than a generic "Update".
  if (chargeNote && process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `summary=${chargeNote}\n`);
  }

  console.log(summarise(billing, shouldSuspend));
  return true;
}

const [, , command, argument] = process.argv;
let changed;

if (command === 'accrue') changed = accrue();
else if (command === 'apply') changed = apply(argument);
else fail(`unknown command "${command || ''}" — expected "accrue" or "apply"`);

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed ? 'true' : 'false'}\n`);
}
