// Vercel Serverless Function — /api/wellfam
//
// Wellfam VVIPs get their pass free once their phone number AND birthday match their Wellfam
// account. The registration form asks this endpoint; Wellfam's data stays on the server
// (see api/_wellfam.js).
//
//   GET  /api/wellfam?phone=0123456789&dob=1990-05-12
//        → { status: 'verified' | 'mismatch' | 'none' }
//          mismatch: a VVIP's number, but the birthday on Wellous's record is different or missing
//   POST /api/wellfam  { phone, dob, regId }     → { waived: true, marked: true|false }
//        called right after a VVIP's registration is submitted: re-checks phone + birthday and marks
//        that registration "Paid" (RM0) in the sheet, instead of sending them to Stripe.
//
// Environment variables: see api/_wellfam.js, plus MARK_PAID_SECRET (already set for the Stripe webhook).

const { normalisePhone, checkVvip, markWaived } = require('./_wellfam');

const REF_RE = /^WWF_(D1|D2|BOTH)_(\d{6,15})_([A-Za-z0-9]{4,40})$/;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const q = req.query || {};
    try {
      return res.status(200).json({ status: await checkVvip(q.phone, q.dob) });
    } catch (err) {
      console.error('wellfam lookup failed:', err.message);
      return res.status(502).json({ status: 'error', error: 'Could not check Wellfam right now.' });
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
    // The reference carries the phone number, so a VVIP's details can only waive their own registration.
    if (!m || normalisePhone(m[2]) !== phone) {
      return res.status(400).json({ waived: false, error: 'Invalid registration reference.' });
    }
    try {
      const status = await checkVvip(phone, body.dob);
      if (status !== 'verified') return res.status(403).json({ waived: false, status });
    } catch (err) {
      console.error('wellfam lookup failed:', err.message);
      return res.status(502).json({ waived: false, error: 'Could not check Wellfam right now.' });
    }
    const marked = await markWaived(regId);
    if (!marked) console.error('wellfam: could not mark', regId, 'as paid in the sheet');
    return res.status(200).json({ waived: true, marked });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
};
