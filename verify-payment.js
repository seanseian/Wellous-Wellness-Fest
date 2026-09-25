// Vercel Serverless Function — GET /api/verify-payment
//
// Asks Stripe (server-side, with your secret key) whether a Wellness Fest pass
// has really been paid for. The browser can't be trusted to decide this itself,
// so the booking page only unlocks when this endpoint says { paid: true }.
//
// Two ways to call it:
//   /api/verify-payment?session_id=cs_live_...   ← right after Stripe redirects back
//   /api/verify-payment?phone=0123456789          ← "Already paid?" lookup on another device
//
// Environment variables (Vercel → Project → Settings → Environment Variables):
//   STRIPE_SECRET_KEY  (required) a restricted key with "Checkout Sessions: Read" is enough
//   PASS_LINKS         (optional) map your Payment Link IDs to pass types, e.g.
//                      plink_1AbC...:BOTH,plink_1DeF...:D1,plink_1GhI...:D2
//                      When set, only payments made through these three links count.
//   LOOKUP_SINCE       (optional) ISO date; phone lookups ignore payments before it,
//                      e.g. 2026-09-01

const STRIPE_API = 'https://api.stripe.com/v1';

// Expected pass prices in sen (RM35 = 3500). Used to make sure nobody pays for the
// cheaper pass and then edits the reference to claim the 2-day pass.
const PASS_PRICES = { D1: 3500, D2: 3500, BOTH: 5000 };
const PASS_LABELS = { D1: 'Day 1', D2: 'Day 2', BOTH: 'Both days' };

// Reference format written by the registration form: WWF_<PASS>_<phone digits>_<random>
const REF_RE = /^WWF_(D1|D2|BOTH)_(\d{6,15})_[A-Za-z0-9]{4,20}$/;

function normalisePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('60')) d = d.slice(1); // +60 12-345 6789 → 0123456789
  if (d && !d.startsWith('0')) d = '0' + d; // 12-345 6789 → 0123456789
  return d;
}

function parsePassLinks() {
  const map = {};
  String(process.env.PASS_LINKS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const [id, pass] = pair.split(':').map((s) => s.trim());
      if (id && PASS_LABELS[pass]) map[id] = pass;
    });
  return map;
}

async function stripeGet(path, params) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const res = await fetch(STRIPE_API + path + qs, {
    headers: { Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY },
  });
  const body = await res.json();
  if (!res.ok) {
    const err = new Error((body.error && body.error.message) || 'Stripe request failed');
    err.status = res.status;
    throw err;
  }
  return body;
}

// Decide whether one Checkout Session is a valid, paid Wellness Fest pass.
// Returns the pass details, or null if it doesn't qualify.
function evaluateSession(session, passLinks) {
  if (!session || session.object !== 'checkout.session') return null;
  if (session.status !== 'complete') return null;
  // 'no_payment_required' covers 100%-off promo codes you may hand out yourself.
  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') return null;

  const ref = session.client_reference_id || '';
  const m = REF_RE.exec(ref);
  const linkPass = passLinks[session.payment_link];
  const hasLinkMap = Object.keys(passLinks).length > 0;

  // If you've told us your three Payment Link IDs, ignore anything else in the account.
  if (hasLinkMap && !linkPass) return null;

  let pass = linkPass || (m && m[1]) || null;

  if (!linkPass) {
    // No link map: fall back to the reference + price check.
    if (!m) {
      // Paid through a raw link with no reference (e.g. shared before this change).
      // Only the 2-day price is unambiguous.
      if ((session.amount_subtotal || 0) === PASS_PRICES.BOTH) pass = 'BOTH';
      else return null;
    }
    if (String(session.currency).toLowerCase() !== 'myr') return null;
    if ((session.amount_subtotal || 0) < PASS_PRICES[pass]) return null;
  }

  const custPhone = session.customer_details && session.customer_details.phone;
  return {
    paid: true,
    pass,
    attendance: PASS_LABELS[pass],
    regId: m ? ref : null,
    phone: m ? m[2] : normalisePhone(custPhone) || null,
    sessionId: session.id,
    paidAt: session.created ? new Date(session.created * 1000).toISOString() : null,
  };
}

async function findByPhone(phone, passLinks) {
  const params = { status: 'complete', limit: '100' };
  if (process.env.LOOKUP_SINCE) {
    const t = Math.floor(new Date(process.env.LOOKUP_SINCE).getTime() / 1000);
    if (t > 0) params['created[gte]'] = String(t);
  }

  // With a link map we can ask Stripe for just those links; otherwise scan the account.
  const linkIds = Object.keys(passLinks);
  const scopes = linkIds.length ? linkIds.map((id) => ({ payment_link: id })) : [{}];

  const RANK = { BOTH: 2, D1: 1, D2: 1 };
  let best = null;
  const seenPasses = new Set();

  for (const scope of scopes) {
    let startingAfter = null;
    for (let page = 0; page < 50; page++) {
      const q = Object.assign({}, params, scope);
      if (startingAfter) q.starting_after = startingAfter;
      const list = await stripeGet('/checkout/sessions', q);

      for (const s of list.data) {
        const ev = evaluateSession(s, passLinks);
        if (!ev) continue;
        const refPhone = ev.regId ? REF_RE.exec(ev.regId)[2] : null;
        const custPhone = normalisePhone(s.customer_details && s.customer_details.phone);
        if (normalisePhone(refPhone) !== phone && custPhone !== phone) continue;
        seenPasses.add(ev.pass);
        if (!best || RANK[ev.pass] > RANK[best.pass]) best = ev;
      }
      if (!list.has_more || !list.data.length) break;
      startingAfter = list.data[list.data.length - 1].id;
    }
  }

  // Someone who bought Day 1 and Day 2 separately effectively holds both days.
  if (best && seenPasses.has('D1') && seenPasses.has('D2')) {
    best = Object.assign({}, best, { pass: 'BOTH', attendance: PASS_LABELS.BOTH });
  }
  return best;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ paid: false, error: 'Method not allowed' });
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ paid: false, error: 'Payment check is not configured yet (STRIPE_SECRET_KEY missing).' });
  }

  const passLinks = parsePassLinks();
  const sessionId = String((req.query && req.query.session_id) || '');
  const phoneRaw = String((req.query && req.query.phone) || '');

  try {
    if (sessionId) {
      if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(sessionId)) {
        return res.status(400).json({ paid: false, error: 'Invalid payment reference.' });
      }
      const session = await stripeGet('/checkout/sessions/' + encodeURIComponent(sessionId));
      const result = evaluateSession(session, passLinks);
      if (!result) {
        return res.status(200).json({
          paid: false,
          status: session.status,
          payment_status: session.payment_status,
          error: 'We could not confirm a completed payment for this checkout.',
        });
      }
      // Name is only returned for the session-based check (the payer just came from Stripe).
      result.name = (session.customer_details && session.customer_details.name) || null;
      return res.status(200).json(result);
    }

    if (phoneRaw) {
      const phone = normalisePhone(phoneRaw);
      if (phone.length < 9 || phone.length > 12) {
        return res.status(400).json({ paid: false, error: 'Please enter a valid phone number.' });
      }
      const result = await findByPhone(phone, passLinks);
      if (!result) {
        return res.status(200).json({ paid: false, error: 'No completed payment found for that phone number.' });
      }
      return res.status(200).json(result);
    }

    return res.status(400).json({ paid: false, error: 'Missing session_id or phone.' });
  } catch (err) {
    console.error('verify-payment failed:', err.message);
    if (err.status === 404 || err.status === 400) {
      return res.status(200).json({ paid: false, error: 'We could not find that payment.' });
    }
    return res.status(502).json({ paid: false, error: 'Could not reach Stripe right now. Please try again.' });
  }
};

module.exports._internal = { evaluateSession, normalisePhone, parsePassLinks };
