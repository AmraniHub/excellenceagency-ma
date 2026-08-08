#!/usr/bin/env node
// Billing state machine for a client site.
//
//   node .github/scripts/billing.cjs accrue
//       Adds one month's fee to the outstanding balance and suspends the site
//       if anything is owed. Idempotent within a calendar month, so a re-run
//       (or a retried workflow) never double-charges.
//
//   node .github/scripts/billing.cjs apply '<json>'
//       Applies an update from the agency dashboard. Accepts any of
//       balanceDue, monthlyFee, currency, plus "suspend": "true"|"false"|"auto".
//       "auto" suspends when a balance is outstanding and restores the site
//       when it reaches zero.
//
// Exits 0 and prints "unchanged" when there is nothing to do, so the calling
// workflow can skip the commit.

const fs = require('fs');

const BILLING_FILE = 'billing.json';
const STATUS_FILE = 'site-status.js';
const SUSPENDED_RE = /^(export const suspended = )(true|false);/m;

function fail(message) {
  console.error(`billing: ${message}`);
  process.exit(1);
}

function money(value) {
  // Keep to cents; avoids 8.1 + 8.2 style drift accumulating over months.
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

  const balanceDue = money(data.balanceDue ?? 0);
  const monthlyFee = money(data.monthlyFee ?? 0);
  if (!Number.isFinite(balanceDue) || balanceDue < 0) fail('balanceDue must be a number >= 0');
  if (!Number.isFinite(monthlyFee) || monthlyFee < 0) fail('monthlyFee must be a number >= 0');

  return {
    currency: typeof data.currency === 'string' && data.currency ? data.currency : '$',
    monthlyFee,
    balanceDue,
    lastAccrual: typeof data.lastAccrual === 'string' ? data.lastAccrual : ''
  };
}

function writeBilling(billing) {
  fs.writeFileSync(BILLING_FILE, `${JSON.stringify(billing, null, 2)}\n`);
}

// Returns true when site-status.js actually changed.
function setSuspended(shouldSuspend) {
  const source = fs.readFileSync(STATUS_FILE, 'utf8');
  const match = source.match(SUSPENDED_RE);
  if (!match) fail(`could not find the suspended flag in ${STATUS_FILE}`);

  const current = match[2] === 'true';
  if (current === shouldSuspend) return false;

  fs.writeFileSync(STATUS_FILE, source.replace(SUSPENDED_RE, `$1${shouldSuspend};`));
  return true;
}

function todayIso() {
  // GitHub runners are UTC; billing periods are keyed on UTC month.
  return new Date().toISOString().slice(0, 10);
}

function accrue() {
  const billing = readBilling();
  const period = todayIso().slice(0, 7);

  if (billing.lastAccrual.slice(0, 7) === period) {
    console.log(`unchanged (already accrued for ${period})`);
    return false;
  }

  billing.balanceDue = money(billing.balanceDue + billing.monthlyFee);
  billing.lastAccrual = todayIso();
  writeBilling(billing);

  const suspendChanged = setSuspended(billing.balanceDue > 0);
  console.log(
    `accrued ${billing.currency}${billing.monthlyFee} for ${period} — ` +
    `balance now ${billing.currency}${billing.balanceDue}` +
    (suspendChanged ? ' (site suspended)' : '')
  );
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

  if (update.monthlyFee !== undefined) {
    const next = money(update.monthlyFee);
    if (!Number.isFinite(next) || next < 0) fail('monthlyFee must be a number >= 0');
    billing.monthlyFee = next;
  }

  if (update.currency !== undefined) {
    // Deliberately narrow: this string is rendered on the public notice page,
    // so only real currency marks get through — never arbitrary text.
    if (typeof update.currency !== 'string' || !/^[A-Za-z$€£¥.]{1,4}$/.test(update.currency)) {
      fail('currency must be 1-4 characters, letters or a currency symbol');
    }
    billing.currency = update.currency;
  }

  const mode = update.suspend === undefined ? 'auto' : String(update.suspend);
  if (!['auto', 'true', 'false'].includes(mode)) fail('suspend must be "auto", "true" or "false"');

  const shouldSuspend = mode === 'auto' ? billing.balanceDue > 0 : mode === 'true';

  const billingChanged = JSON.stringify(billing) !== before;
  if (billingChanged) writeBilling(billing);
  const suspendChanged = setSuspended(shouldSuspend);

  if (!billingChanged && !suspendChanged) {
    console.log('unchanged');
    return false;
  }

  console.log(
    `balance ${billing.currency}${billing.balanceDue}, ` +
    `fee ${billing.currency}${billing.monthlyFee}/mo, ` +
    `site ${shouldSuspend ? 'suspended' : 'active'}`
  );
  return true;
}

const [, , command, argument] = process.argv;
let changed;

if (command === 'accrue') changed = accrue();
else if (command === 'apply') changed = apply(argument);
else fail(`unknown command "${command || ''}" — expected "accrue" or "apply"`);

// The workflow reads this to decide whether to commit.
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed ? 'true' : 'false'}\n`);
}
