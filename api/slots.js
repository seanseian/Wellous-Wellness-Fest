// Vercel Serverless Function — GET /api/slots
//
// A cached copy of the workshop slot counts. Every visitor's first look at the booking
// section reads from here instead of the Google Sheet, and Vercel's CDN keeps the answer
// for a few seconds, so a crowd opening the page at once becomes roughly one request to
// Apps Script every few seconds. (Google only allows a limited number of simultaneous
// spreadsheet calls; without this, ~150 visitors at the same moment start getting errors.)
//
// Bookings and cancellations never go through this cache: the sheet always checks the
// real capacity, and the page refreshes the exact numbers right after any action.
//
// Environment variable (optional): APPS_SCRIPT_URL, if the Apps Script web app URL changes.

const DEFAULT_URL = 'https://script.google.com/macros/s/AKfycbzTAdy-aFw-B_0KAu5MtDrDf-ya5cw5IXb_hdEFom3deV4Ectg0BmTAx5S7h42Iz4tr5w/exec';

module.exports = async function handler(req, res) {
  const base = process.env.APPS_SCRIPT_URL || DEFAULT_URL;
  try {
    const r = await fetch(base + '?action=getSlots', { redirect: 'follow' });
    const json = JSON.parse(await r.text());
    if (!json || !Array.isArray(json.slots)) throw new Error('Unexpected response');
    // fresh for 5s at the edge, then served stale for up to 30s while it refreshes in the background
    res.setHeader('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=30');
    return res.status(200).json(json);
  } catch (err) {
    console.error('slots proxy failed:', err.message);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'Slot counts unavailable right now.' });
  }
};
