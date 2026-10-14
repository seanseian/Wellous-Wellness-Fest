// Shared helpers for Wellfam members (free pass). Not an endpoint: Vercel skips files starting with _.
//
// The member list never reaches the browser. The website only ever learns "this number is / isn't
// a Wellfam member", and every free pass is re-checked here on the server.
//
// Where the list lives (Vercel → Project → Settings → Environment Variables):
//   WELLFAM_LOOKUP_URL  the /exec URL of the Wellfam lookup Apps Script (apps-script/wellfam-lookup.gs),
//                       which reads the member numbers from a private Google Sheet
//   WELLFAM_SECRET      must match the WELLFAM_SECRET Script Property of that Apps Script
//   WELLFAM_PHONES      (optional) placeholder list for testing before IT's list is in, e.g.
//                       0123456789,0198765432. Numbers here count as members too.
// With none of these set, nobody is a member and the site works exactly as before.

const DEFAULT_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzTAdy-aFw-B_0KAu5MtDrDf-ya5cw5IXb_hdEFom3deV4Ectg0BmTAx5S7h42Iz4tr5w/exec';
const PASS_CODES = { 'Day 1': 'D1', 'Day 2': 'D2', 'Both days': 'BOTH' };
const PASS_LABELS = { D1: 'Day 1', D2: 'Day 2', BOTH: 'Both days' };

function normalisePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('60')) d = d.slice(1); // +60 12-345 6789 → 0123456789
  if (d && !d.startsWith('0')) d = '0' + d; // 12-345 6789 → 0123456789
  return d;
}

function wellfamConfigured() {
  return Boolean(process.env.WELLFAM_PHONES || (process.env.WELLFAM_LOOKUP_URL && process.env.WELLFAM_SECRET));
}

// true / false. Throws only if the lookup sheet can't be reached (callers decide what that means).
async function isWellfamMember(rawPhone) {
  const phone = normalisePhone(rawPhone);
  if (phone.length < 9 || phone.length > 12) return false;

  const placeholder = String(process.env.WELLFAM_PHONES || '')
    .split(/[,;\n]+/)
    .map(normalisePhone)
    .filter(Boolean);
  if (placeholder.includes(phone)) return true;

  if (!process.env.WELLFAM_LOOKUP_URL || !process.env.WELLFAM_SECRET) return false;
  const url = new URL(process.env.WELLFAM_LOOKUP_URL);
  url.searchParams.set('phone', phone);
  url.searchParams.set('secret', process.env.WELLFAM_SECRET);
  const res = await fetch(url.toString(), { redirect: 'follow' });
  const data = JSON.parse(await res.text());
  if (!data || typeof data.member !== 'boolean') throw new Error('Unexpected Wellfam lookup response');
  return data.member;
}

function appsScriptPost(fields) {
  const url = process.env.APPS_SCRIPT_URL || DEFAULT_APPS_SCRIPT_URL;
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
    redirect: 'follow',
  })
    .then((r) => r.text())
    .then((t) => JSON.parse(t));
}

// The registration sheet's record for this number: { registered, paid, regId, attendance, paidPasses? }
async function findRegistration(phone) {
  const r = await appsScriptPost({ action: 'checkPhone', contactNumber: normalisePhone(phone) });
  return r && r.result === 'success' ? r : null;
}

// A registered Wellfam member, shaped like a verify-payment result, or null.
async function wellfamPass(phone) {
  phone = normalisePhone(phone);
  if (!wellfamConfigured() || !(await isWellfamMember(phone))) return null;
  const reg = await findRegistration(phone);
  if (!reg || !reg.registered) return null;
  const held = reg.paid && reg.paidPasses && reg.paidPasses.length ? reg.paidPasses : [reg.attendance];
  const pass =
    held.includes('Both days') || (held.includes('Day 1') && held.includes('Day 2'))
      ? 'BOTH'
      : PASS_CODES[held[0]] || 'BOTH';
  return {
    paid: true,
    waived: true,
    pass,
    attendance: PASS_LABELS[pass],
    regId: reg.regId || null,
    phone,
    sessionId: null,
    email: null,
    paidAt: null,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Marks the registration row "Paid" through the same Apps Script action Stripe's webhook uses,
// so the sheet, the duplicate-number check and payment reminders all treat it as a confirmed pass.
// The row may land a moment after the browser asks, so try a few times.
async function markWaived(regId) {
  if (!process.env.MARK_PAID_SECRET) return false;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(1500 * attempt);
    try {
      const r = await appsScriptPost({
        action: 'markPaid',
        regId,
        secret: process.env.MARK_PAID_SECRET,
        email: '',
        name: '',
        amount: '0',
        currency: 'myr',
        sessionId: 'WELLFAM',
      });
      if (r && r.result === 'success') return true;
    } catch (e) {
      // not in the sheet yet, or Apps Script busy: try again
    }
  }
  return false;
}

module.exports = { normalisePhone, wellfamConfigured, isWellfamMember, wellfamPass, markWaived };
