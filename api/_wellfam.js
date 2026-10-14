// Shared helpers for Wellfam VVIPs (free pass). Not an endpoint: Vercel skips files starting with _.
//
// A guest gets the free pass when Wellfam's own API confirms their phone number belongs to a VVIP
// AND the birthday on that Wellfam account matches the birthday they typed. The comparison happens
// here on the server: the browser never sees a Wellfam birthday, only verified / no_dob / mismatch / none.
//
// Environment variables (Vercel → Project → Settings → Environment Variables):
//   WELLFAM_API_URL   Wellfam's VVIP lookup endpoint (from IT). Called as GET <url>?phone=0123456789
//   WELLFAM_API_KEY   (optional) sent as "Authorization: Bearer <key>"
//   WELLFAM_PHONES    (optional) placeholder VVIPs for testing before IT's API is ready, comma separated.
//                     "0123456789:1990-05-12" is a VVIP with that birthday; "0123456789" alone is a
//                     VVIP who hasn't added a birthday on Wellfam yet.
// With none of these set, nobody is a VVIP and the site works exactly as before.
//
// Expected API answer (lookupVvip below is the only place to change if IT's format differs):
//   { "member": true, "dob": "1990-05-12" }   VVIP with a birthday on file
//   { "member": true, "dob": null }           VVIP, no birthday on file yet
//   { "member": false }                       not a VVIP

const DEFAULT_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzTAdy-aFw-B_0KAu5MtDrDf-ya5cw5IXb_hdEFom3deV4Ectg0BmTAx5S7h42Iz4tr5w/exec';
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
  return Boolean(process.env.WELLFAM_PHONES || process.env.WELLFAM_API_URL);
}

// { member: boolean, dob: 'YYYY-MM-DD' | null }. Throws if Wellfam's API can't be reached.
async function lookupVvip(phone) {
  for (const entry of String(process.env.WELLFAM_PHONES || '').split(/[,;\n]+/)) {
    const [p, dob] = entry.split(/[:=]/);
    if (p && normalisePhone(p) === phone) return { member: true, dob: normaliseDob(dob) || null };
  }
  if (!process.env.WELLFAM_API_URL) return { member: false, dob: null };

  const url = new URL(process.env.WELLFAM_API_URL);
  url.searchParams.set('phone', phone);
  const headers = { Accept: 'application/json' };
  if (process.env.WELLFAM_API_KEY) headers.Authorization = 'Bearer ' + process.env.WELLFAM_API_KEY;
  const res = await fetch(url.toString(), { headers, redirect: 'follow' });
  if (res.status === 404) return { member: false, dob: null };
  if (!res.ok) throw new Error('Wellfam API answered ' + res.status);
  const data = await res.json();
  const member = Boolean(data && (data.member ?? data.vvip ?? data.found));
  const dob = data && (data.dob ?? data.birthday ?? data.dateOfBirth);
  return { member, dob: member ? normaliseDob(dob) || null : null };
}

// 'verified' (free pass) | 'no_dob' (VVIP, birthday not on Wellfam yet) | 'mismatch' | 'none'
async function checkVvip(rawPhone, rawDob) {
  const phone = normalisePhone(rawPhone);
  if (phone.length < 9 || phone.length > 12 || !wellfamConfigured()) return 'none';
  const vvip = await lookupVvip(phone);
  if (!vvip.member) return 'none';
  if (!vvip.dob) return 'no_dob';
  return vvip.dob === normaliseDob(rawDob) ? 'verified' : 'mismatch';
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
// so this relies on the sheet: the row is only marked paid after /api/wellfam verified the birthday.
async function wellfamPass(phone) {
  phone = normalisePhone(phone);
  if (!wellfamConfigured() || !(await lookupVvip(phone)).member) return null;
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

module.exports = { normalisePhone, normaliseDob, checkVvip, wellfamPass, markWaived };
