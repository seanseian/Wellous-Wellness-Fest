// Shared helpers for Wellfam VVIPs (free pass). Not an endpoint: Vercel skips files starting with _.
//
// A guest gets the free pass when Wellous's membership API confirms that their phone number AND
// birthday belong to a VVIP. The API is called from here only: its secret never reaches the browser,
// which only hears back verified / mismatch / none.
//
// Environment variables (Vercel → Project → Settings → Environment Variables):
//   WELLFAM_API_KEY     API key from Wellous IT
//   WELLFAM_API_SECRET  API secret from Wellous IT
//   WELLFAM_API_URL     (optional) defaults to the production checkVvip endpoint below
//   WELLFAM_PHONES      (optional) placeholder VVIPs for testing without the API, comma separated,
//                       e.g. 0123456789:1990-05-12
// With none of these set, nobody is a VVIP and the site works exactly as before.
//
// API: "Wellous Membership · VVIP Check API" v1.0 (POST, HMAC-SHA256 signed).

const crypto = require('crypto');

const DEFAULT_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzTAdy-aFw-B_0KAu5MtDrDf-ya5cw5IXb_hdEFom3deV4Ectg0BmTAx5S7h42Iz4tr5w/exec';
const DEFAULT_VVIP_URL = 'https://membership-api.wellous.com/openapi/member/checkVvip';
const PASS_CODES = { 'Day 1': 'D1', 'Day 2': 'D2', 'Both days': 'BOTH' };
const PASS_LABELS = { D1: 'Day 1', D2: 'Day 2', BOTH: 'Both days' };

function normalisePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('60')) d = d.slice(1); // +60 12-345 6789 → 0123456789
  if (d && !d.startsWith('0')) d = '0' + d; // 12-345 6789 → 0123456789
  return d;
}

// Any common date shape → "YYYY-MM-DD", or '' if it isn't a real date.
// Day-first for slashes and dashes (12/05/1990 = 12 May), as written in Malaysia.
function normaliseDob(raw) {
  const s = String(raw || '').trim();
  let y, m, d;
  let x = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s); // 1990-05-12, also ISO date-times
  if (x) [, y, m, d] = x;
  else if ((x = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) [, d, m, y] = x;
  else if ((x = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) [, y, m, d] = x; // 19900512
  else return '';
  const dt = new Date(Date.UTC(+y, +m - 1, +d));
  if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +m - 1 || dt.getUTCDate() !== +d) return '';
  return dt.toISOString().slice(0, 10);
}

function wellfamConfigured() {
  return Boolean(process.env.WELLFAM_PHONES || (process.env.WELLFAM_API_KEY && process.env.WELLFAM_API_SECRET));
}

// One signed call to the VVIP Check API: 'verified' | 'mismatch' | 'none'. Throws on anything else
// (auth failure, bad request, timeout), which callers report as "couldn't check right now".
async function callVvipApi(phone, dob) {
  const apiKey = process.env.WELLFAM_API_KEY;
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(12).toString('hex'); // new for every request, retries included
  const signature = crypto
    .createHmac('sha256', nonce + process.env.WELLFAM_API_SECRET)
    .update(ts + apiKey + nonce)
    .digest('hex');
  const res = await fetch(process.env.WELLFAM_API_URL || DEFAULT_VVIP_URL, {
    method: 'POST',
    headers: {
      Authorization: `HMAC-SHA256 apikey=${apiKey} ts=${ts} nonce=${nonce} signature=${signature}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mobilePrefix: '60', mobile: phone, birthday: dob }),
    signal: AbortSignal.timeout(10000),
  });
  let body = null;
  try { body = await res.json(); } catch (e) { /* not JSON: handled below */ }
  if (res.ok && body && body.status === 'ok' && body.data) return body.data.isVvip === true ? 'verified' : 'none';
  // A VVIP's number, but the birthday on Wellous's record is different or missing
  if (body && body.error === 'birthday_mismatch') return 'mismatch';
  throw new Error('VVIP API answered ' + res.status + ' ' + ((body && body.error) || ''));
}

// 'verified' (free pass) | 'mismatch' (VVIP number, birthday wrong or not on record) | 'none'
async function checkVvip(rawPhone, rawDob) {
  const phone = normalisePhone(rawPhone);
  const dob = normaliseDob(rawDob);
  if (phone.length < 9 || phone.length > 12 || !dob || !wellfamConfigured()) return 'none';

  for (const entry of String(process.env.WELLFAM_PHONES || '').split(/[,;\n]+/)) {
    const [p, d] = entry.split(/[:=]/);
    if (p && normalisePhone(p) === phone) return normaliseDob(d) === dob ? 'verified' : 'mismatch';
  }
  if (!process.env.WELLFAM_API_KEY || !process.env.WELLFAM_API_SECRET) return 'none';
  return callVvipApi(phone, dob);
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

// A VVIP's free pass, shaped like a verify-payment result, or null. Phone lookups carry no birthday,
// so it can't ask the VVIP API again. It relies on the sheet instead: /api/wellfam marks the row paid
// (RM0, session WELLFAM) only after the API verified the phone number and birthday. Only reached when
// Stripe has no payment for the number.
async function wellfamPass(phone) {
  phone = normalisePhone(phone);
  if (!wellfamConfigured()) return null;
  const reg = await findRegistration(phone);
  if (!reg || !reg.registered || !reg.paid) return null;
  const held = reg.paidPasses && reg.paidPasses.length ? reg.paidPasses : [reg.attendance];
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
async function markWaived(regId, email, name) {
  if (!process.env.MARK_PAID_SECRET) return false;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(1500 * attempt);
    try {
      const r = await appsScriptPost({
        action: 'markPaid',
        regId,
        secret: process.env.MARK_PAID_SECRET,
        email: email || '', // the pass confirmation email goes here (WorkshopEmail.gs)
        name: name || '',
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

module.exports = { normalisePhone, normaliseDob, checkVvip, wellfamPass, markWaived };
