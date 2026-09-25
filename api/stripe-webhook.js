// Vercel Serverless Function — POST /api/stripe-webhook
//
// Stripe calls this automatically whenever a checkout finishes. When a payment
// completes, this looks up the registration by its reference (client_reference_id,
// e.g. WWF_D1_0123456789_K7QX2M) and tells your Apps Script to mark that row
// "Paid" in the Registrations sheet — no manual checking needed.
//
// Environment variables (Vercel → Project → Settings → Environment Variables):
//   STRIPE_WEBHOOK_SECRET  (required) the "Signing secret" Stripe shows you when
//                          you create the webhook endpoint (starts with whsec_...)
//   APPS_SCRIPT_URL        (required) your Apps Script Web App /exec URL
//   MARK_PAID_SECRET       (required) must match the Script Property of the same
//                          name in your Apps Script project — proves this call
//                          really came from your Vercel deployment
//
// This function must see the exact raw request body (not a re-serialised copy)
// to verify Stripe's signature, so Vercel's automatic JSON body parsing is
// turned off below.

const crypto = require('crypto');

const REF_RE = /^WWF_(D1|D2|BOTH)_(\d{6,15})_[A-Za-z0-9]{4,20}$/;

module.exports.config = {
  api: { bodyParser: false },
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Verifies Stripe's "Stripe-Signature" header without needing the Stripe SDK.
// Header looks like: t=1690000000,v1=<hex hmac>,v0=<hex hmac (legacy)>
function verifyStripeSignature(rawBody, signatureHeader, secret, toleranceSeconds) {
  if (!signatureHeader) return { ok: false, reason: 'Missing Stripe-Signature header.' };

  const parts = {};
  signatureHeader.split(',').forEach((part) => {
    const [k, v] = part.split('=');
    if (k && v) {
      if (k === 'v1') (parts.v1 = parts.v1 || []).push(v);
      else parts[k] = v;
    }
  });

  const timestamp = parts.t;
  const signatures = parts.v1 || [];
  if (!timestamp || !signatures.length) {
    return { ok: false, reason: 'Malformed Stripe-Signature header.' };
  }

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > (toleranceSeconds || 300)) {
    return { ok: false, reason: 'Signature timestamp is outside tolerance (possible replay).' };
  }

  const signedPayload = timestamp + '.' + rawBody.toString('utf8');
  const expected = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');

  const expectedBuf = Buffer.from(expected, 'hex');
  const matches = signatures.some((sig) => {
    const sigBuf = Buffer.from(sig, 'hex');
    return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
  });

  return matches ? { ok: true } : { ok: false, reason: 'Signature does not match payload.' };
}

async function markPaid(regId) {
  const url = new URL(process.env.APPS_SCRIPT_URL);
  const body = new URLSearchParams({
    action: 'markPaid',
    regId,
    secret: process.env.MARK_PAID_SECRET || '',
  });
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    redirect: 'follow',
  });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    // Apps Script sometimes wraps the response in an HTML redirect page on error;
    // treat anything non-JSON as a failure but don't crash the webhook handler.
  }
  return { ok: res.ok && data && data.result === 'success', status: res.status, data };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method not allowed');
  }

  if (!process.env.STRIPE_WEBHOOK_SECRET || !process.env.APPS_SCRIPT_URL || !process.env.MARK_PAID_SECRET) {
    console.error('stripe-webhook is missing required environment variables.');
    return res.status(500).send('Webhook not configured.');
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    return res.status(400).send('Could not read request body.');
  }

  const verification = verifyStripeSignature(
    rawBody,
    req.headers['stripe-signature'],
    process.env.STRIPE_WEBHOOK_SECRET,
    300
  );
  if (!verification.ok) {
    console.error('stripe-webhook signature check failed:', verification.reason);
    return res.status(400).send('Invalid signature.');
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch (err) {
    return res.status(400).send('Invalid JSON payload.');
  }

  // Card payments complete immediately; some methods (e.g. FPX, bank transfers)
  // confirm asynchronously, so both events are handled the same way.
  const relevant =
    event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded';

  if (!relevant) {
    // Acknowledge anything else so Stripe doesn't keep retrying it.
    return res.status(200).json({ received: true, ignored: event.type });
  }

  const session = event.data && event.data.object;
  const paid = session && (session.payment_status === 'paid' || session.payment_status === 'no_payment_required');
  const ref = (session && session.client_reference_id) || '';
  const match = REF_RE.exec(ref);

  if (!paid || !match) {
    // Nothing to do — e.g. a payment that failed, or a checkout with no
    // registration reference attached.
    return res.status(200).json({ received: true, skipped: true });
  }

  try {
    const result = await markPaid(ref);
    if (!result.ok) {
      console.error('markPaid call did not succeed:', result.status, result.data);
      // Still return 200 so Stripe doesn't hammer retries for a problem on our
      // side that a retry won't fix (e.g. the regId isn't in the sheet yet).
      // Check Vercel's function logs if rows aren't updating.
    }
    return res.status(200).json({ received: true, regId: ref, marked: result.ok });
  } catch (err) {
    console.error('stripe-webhook failed to reach Apps Script:', err.message);
    // A 500 here makes Stripe retry the webhook later, which is what we want
    // if the failure was transient (Apps Script briefly unavailable, etc.).
    return res.status(500).send('Could not update the registration sheet.');
  }
};
