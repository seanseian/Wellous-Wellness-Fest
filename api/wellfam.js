// Vercel Serverless Function — /api/wellfam
//
// Wellfam members get their pass free. The registration form asks this endpoint about the phone
// number the guest typed; the member list itself stays on the server (see api/_wellfam.js).
//
//   GET  /api/wellfam?phone=0123456789          → { member: true|false }
//   POST /api/wellfam  { phone, regId }          → { waived: true, marked: true|false }
//        called right after a member's registration is submitted: re-checks membership and marks
//        that registration "Paid" (RM0) in the sheet, instead of sending them to Stripe.
//
// Environment variables: see api/_wellfam.js, plus MARK_PAID_SECRET (already set for the Stripe webhook).

const { normalisePhone, isWellfamMember, wellfamConfigured, markWaived } = require('./_wellfam');

const REF_RE = /^WWF_(D1|D2|BOTH)_(\d{6,15})_([A-Za-z0-9]{4,40})$/;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const phone = normalisePhone(req.query && req.query.phone);
    if (phone.length < 9 || phone.length > 12) return res.status(200).json({ member: false });
    if (!wellfamConfigured()) return res.status(200).json({ member: false });
    try {
      return res.status(200).json({ member: await isWellfamMember(phone) });
    } catch (err) {
      console.error('wellfam lookup failed:', err.message);
      return res.status(502).json({ member: false, error: 'Could not check Wellfam membership right now.' });
    }
  }

  if (req.method === 'POST') {
    let body = req.body || {};
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    const phone = normalisePhone(body.phone);
    const regId = String(body.regId || '');
    const m = REF_RE.exec(regId);
    // The reference carries the phone number, so a member's number can only waive its own registration.
    if (!m || normalisePhone(m[2]) !== phone) {
      return res.status(400).json({ waived: false, error: 'Invalid registration reference.' });
    }
    try {
      if (!(await isWellfamMember(phone))) return res.status(403).json({ waived: false });
    } catch (err) {
      console.error('wellfam lookup failed:', err.message);
      return res.status(502).json({ waived: false, error: 'Could not check Wellfam membership right now.' });
    }
    const marked = await markWaived(regId);
    if (!marked) console.error('wellfam: could not mark', regId, 'as paid in the sheet');
    // Even if the sheet update lags, verify-payment still recognises the member by phone number.
    return res.status(200).json({ waived: true, marked });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
};
