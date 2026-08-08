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
const SNIPPETS_DIR = 'snippets';
const GATE_FILE = path.join(SNIPPETS_DIR, 'subscription-gate.liquid');
const SUSPENDED_RE = /^(export const suspended = )(true|false);/m;

// Known services. `label` is what the client sees on the notice page.
const CATALOG = {
  hosting: { label: 'Hébergement', fee: 8 },
  chatbot: { label: 'Assistant IA', fee: 12 },
  maintenance: { label: 'Maintenance', fee: 10 },
  optimizations: { label: 'Optimisations', fee: 2 },
  crm: { label: 'CRM', fee: 0 }
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

function money(value) {
  // Keep to cents; stops fractional fees drifting across months of accrual.
  return Math.round(Number(value) * 100) / 100;
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

  let items;
  if (Array.isArray(data.items)) {
    items = data.items.map((item) => ({
      id: String(item.id || ''),
      label: String(item.label || CATALOG[item.id]?.label || item.id || ''),
      fee: money(item.fee ?? 0),
      active: item.active === true
    }));
  } else {
    // Back-compat with the original single-fee format, so a repo that hasn't
    // been migrated yet keeps working instead of erroring on the next accrual.
    items = [{
      id: 'hosting',
      label: CATALOG.hosting.label,
      fee: money(data.monthlyFee ?? 0),
      active: true
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

function monthlyTotal(billing) {
  return money(billing.items.filter((i) => i.active).reduce((sum, i) => sum + i.fee, 0));
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

  for (const [id, widget] of Object.entries(THEME_WIDGETS)) {
    const item = billing.items.find((i) => i.id === id);
    if (!item || !item.active) continue;
    lines.push(`{%- render '${shouldSuspend ? widget.suspended : widget.active}' -%}`);
  }

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
  return changed;
}

// --- commands --------------------------------------------------------------

function todayIso() {
  return new Date().toISOString().slice(0, 10); // runners are UTC
}

function summarise(billing, shouldSuspend) {
  const active = billing.items.filter((i) => i.active);
  return (
    `balance ${billing.currency}${billing.balanceDue}, ` +
    `${active.length ? active.map((i) => `${i.label} ${billing.currency}${i.fee}`).join(' + ') : 'no services'} ` +
    `= ${billing.currency}${monthlyTotal(billing)}/mo, ` +
    `${shouldSuspend ? 'gated' : 'running'}`
  );
}

function accrue() {
  const billing = readBilling();
  const period = todayIso().slice(0, 7);

  if (billing.lastAccrual.slice(0, 7) === period) {
    console.log(`unchanged (already accrued for ${period})`);
    return false;
  }

  const due = monthlyTotal(billing);
  if (due <= 0) {
    console.log('unchanged (no active services to charge)');
    return false;
  }

  billing.balanceDue = money(billing.balanceDue + due);
  billing.lastAccrual = todayIso();
  writeBilling(billing);

  const shouldSuspend = billing.balanceDue > 0;
  enforce(billing, shouldSuspend);
  console.log(`accrued ${billing.currency}${due} for ${period} — ${summarise(billing, shouldSuspend)}`);
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
        item = { id, label: CATALOG[id].label, fee: CATALOG[id].fee, active: false };
        billing.items.push(item);
      }

      if (change.fee !== undefined) {
        const fee = money(change.fee);
        if (!Number.isFinite(fee) || fee < 0) fail(`services.${id}.fee must be a number >= 0`);
        item.fee = fee;
      }

      if (change.active !== undefined) {
        if (typeof change.active !== 'boolean') fail(`services.${id}.active must be true or false`);
        item.active = change.active;
      }
    }
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
