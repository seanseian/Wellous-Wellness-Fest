// Unpaid registration reminder — paste this file into the Apps Script project bound to the
// registration Google Sheet (Extensions → Apps Script → + → Script, name it payment-reminder).
//
// What it does: every 15 minutes it looks at the Registrations sheet. Any registration that is
// at least 2 hours old, still not paid, has an email address and has never been reminded gets
// ONE email asking them to complete payment, with a link straight to their own Stripe checkout.
// The row is then stamped in the "Reminder Sent" column, so nobody is ever emailed twice.
//
// Setup (once):
//   1. Check the CONFIG names below match your sheet's tab and column headers.
//   2. Make sure doPost saves e.parameter.email into the "Email" column (the website now sends it).
//   3. Run previewPaymentReminders() — it only logs who WOULD get an email, and sends nothing.
//   4. When happy, run installPaymentReminderTrigger() once and approve the Gmail permission.
//   To stop it: run removePaymentReminderTrigger().

var REMINDER_CONFIG = {
  SHEET_NAME: 'Registrations',
  // Column headers (row 1). Matching ignores case and extra spaces.
  COL_TIMESTAMP: 'Timestamp',
  COL_REG_ID: 'Reg ID',
  COL_NAME: 'Full Name',
  COL_PHONE: 'Contact Number',
  COL_EMAIL: 'Email',
  COL_ATTENDANCE: 'Attendance',
  COL_PAYMENT: 'Payment Status', // the column markPaid sets to "Paid"
  COL_REMINDED: 'Reminder Sent',  // created automatically if missing
  WAIT_HOURS: 2,
  // Rows older than this are left alone, so switching the reminder on never emails old registrations.
  MAX_AGE_HOURS: 48,
  // Stop reminding once pass sales close (keep in step with PASS_SALES_OPEN on the website).
  SALES_OPEN: true,
  SENDER_NAME: 'Make Health Easier Wellness Fest',
  STRIPE_LINKS: {
    'Day 1': 'https://buy.stripe.com/4gMeVfeaZ6g52jy6rHe3e01',
    'Day 2': 'https://buy.stripe.com/28EdRb1odeMB4rG3fve3e04',
    'Both days': 'https://buy.stripe.com/6oUbJ3eaZ6g5gaoeYde3e05'
  },
  PRICES: { 'Day 1': 'RM35', 'Day 2': 'RM35', 'Both days': 'RM50' },
  // Fallback link if a row has no Reg ID or pass (replace with your live site address).
  SITE_URL: 'https://wellous-wellness-fest.vercel.app/#register'
};

function sendPaymentReminders() { return runPaymentReminders_(false); }
function previewPaymentReminders() { return runPaymentReminders_(true); }

function runPaymentReminders_(dryRun) {
  var C = REMINDER_CONFIG;
  if (!C.SALES_OPEN) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return; // another run is still going
  try {
    var sheet = SpreadsheetApp.getActive().getSheetByName(C.SHEET_NAME);
    if (!sheet) throw new Error('No sheet named ' + C.SHEET_NAME);
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return;

    var col = headerIndex_(sheet, data[0]);
    var now = Date.now();
    var paidPhones = {};
    data.slice(1).forEach(function (r) {
      if (isPaid_(r[col.payment])) paidPhones[phoneKey_(r[col.phone])] = true;
    });

    var sent = 0;
    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      if (r[col.reminded] || isPaid_(r[col.payment])) continue;
      var email = String(r[col.email] || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
      var ts = r[col.timestamp] instanceof Date ? r[col.timestamp].getTime() : new Date(r[col.timestamp]).getTime();
      if (!ts) continue;
      var ageHours = (now - ts) / 3600000;
      if (ageHours < C.WAIT_HOURS || ageHours > C.MAX_AGE_HOURS) continue;
      // Paid under another registration with the same phone (e.g. they changed pass): no reminder.
      if (paidPhones[phoneKey_(r[col.phone])]) continue;

      var msg = buildReminder_(r, col);
      if (dryRun) {
        Logger.log('Would email ' + email + ' (' + r[col.regId] + ', ' + ageHours.toFixed(1) + 'h old)');
        continue;
      }
      // Stamp first, then send: if sending fails we'd rather miss one email than send two.
      sheet.getRange(i + 1, col.reminded + 1).setValue(new Date());
      SpreadsheetApp.flush();
      try {
        MailApp.sendEmail({ to: email, subject: msg.subject, body: msg.text, htmlBody: msg.html, name: C.SENDER_NAME });
        sent++;
      } catch (err) {
        sheet.getRange(i + 1, col.reminded + 1).setValue('FAILED: ' + err.message);
      }
    }
    Logger.log((dryRun ? 'Preview done.' : 'Reminders sent: ' + sent));
  } finally {
    lock.releaseLock();
  }
}

function buildReminder_(r, col) {
  var C = REMINDER_CONFIG;
  var name = String(r[col.name] || '').trim().split(/\s+/)[0] || 'there';
  var pass = String(r[col.attendance] || 'Both days');
  var regId = String(r[col.regId] || '');
  var base = C.STRIPE_LINKS[pass];
  var link = base && regId ? base + '?client_reference_id=' + encodeURIComponent(regId) : C.SITE_URL;
  var price = C.PRICES[pass] || '';

  var subject = 'Your Wellness Fest pass is not secured yet';
  var text =
    'Hi ' + name + ',\n\n' +
    'Thanks for registering for Make Health Easier Wellness Fest 2026! We noticed your payment hasn\'t come through yet.\n\n' +
    'Your pass is only secured once payment is made. Registrations without payment are not counted, and slots are limited.\n\n' +
    'Pass: ' + pass + (price ? ' (' + price + ')' : '') + '\n' +
    'Complete your payment here: ' + link + '\n\n' +
    'Once paid, you can book your workshop slots straight away.\n\n' +
    'If you have already paid, please ignore this email.\n\n' +
    'See you on 24 & 25 October 2026 at KL Wellness City Gallery, Bukit Jalil!\n' +
    'Make Health Easier Wellness Fest team';
  var html =
    '<p>Hi ' + esc_(name) + ',</p>' +
    '<p>Thanks for registering for <b>Make Health Easier Wellness Fest 2026</b>! We noticed your payment hasn&rsquo;t come through yet.</p>' +
    '<p><b>Your pass is only secured once payment is made.</b> Registrations without payment are not counted, and slots are limited.</p>' +
    '<p>Pass: <b>' + esc_(pass) + '</b>' + (price ? ' (' + price + ')' : '') + '</p>' +
    '<p><a href="' + esc_(link) + '" style="display:inline-block;background:#2fa84f;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold;">Pay now &amp; secure my pass</a></p>' +
    '<p>Once paid, you can book your workshop slots straight away.</p>' +
    '<p style="color:#666;">If you have already paid, please ignore this email.</p>' +
    '<p>See you on 24 &amp; 25 October 2026 at KL Wellness City Gallery, Bukit Jalil!<br>Make Health Easier Wellness Fest team</p>';
  return { subject: subject, text: text, html: html };
}

function headerIndex_(sheet, headers) {
  var C = REMINDER_CONFIG;
  var norm = headers.map(function (h) { return String(h).toLowerCase().replace(/\s+/g, ' ').trim(); });
  function find(name, required) {
    var i = norm.indexOf(name.toLowerCase());
    if (i === -1 && required) throw new Error('Column "' + name + '" not found in ' + C.SHEET_NAME);
    return i;
  }
  var reminded = find(C.COL_REMINDED, false);
  if (reminded === -1) {
    reminded = headers.length;
    sheet.getRange(1, reminded + 1).setValue(C.COL_REMINDED);
  }
  return {
    timestamp: find(C.COL_TIMESTAMP, true),
    regId: find(C.COL_REG_ID, true),
    name: find(C.COL_NAME, true),
    phone: find(C.COL_PHONE, true),
    email: find(C.COL_EMAIL, true),
    attendance: find(C.COL_ATTENDANCE, true),
    payment: find(C.COL_PAYMENT, true),
    reminded: reminded
  };
}

function isPaid_(v) { return /^paid/i.test(String(v || '').trim()); }
function phoneKey_(v) { return String(v || '').replace(/\D/g, '').replace(/^60/, '0'); }
function esc_(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

function installPaymentReminderTrigger() {
  removePaymentReminderTrigger();
  ScriptApp.newTrigger('sendPaymentReminders').timeBased().everyMinutes(15).create();
}
function removePaymentReminderTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendPaymentReminders') ScriptApp.deleteTrigger(t);
  });
}
