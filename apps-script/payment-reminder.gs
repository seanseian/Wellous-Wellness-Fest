// Unpaid registration reminder — paste this file into the Apps Script project bound to the
// registration Google Sheet (Extensions → Apps Script → + → Script, name it payment-reminder).
//
// What it does: every 15 minutes it looks at the Registrations sheet. Any registration that is
// at least 2 hours old, still not paid and has never been reminded gets ONE reminder (by email,
// WhatsApp or both, see CHANNELS) asking them to complete payment, with a link straight to their
// own Stripe checkout. The row is then stamped in the "Reminder Sent" column, so nobody is ever
// reminded twice.
//
// Setup (once):
//   1. Check the CONFIG names below match your sheet's tab and column headers.
//   2. Make sure doPost saves e.parameter.email into the "Email" column (the website now sends it).
//   3. Run previewPaymentReminders() — it only logs who WOULD get an email, and sends nothing.
//   4. For WhatsApp: in Project Settings → Script Properties add WHATSAPP_TOKEN (a permanent
//      access token from Meta) and WHATSAPP_PHONE_ID (the "Phone number ID" in WhatsApp Manager),
//      and create the approved template named in WHATSAPP_TEMPLATE (see buildWhatsApp_ below).
//   5. When happy, run installPaymentReminderTrigger() once and approve the permissions.
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
  // How to remind. Each row gets every channel it has details for.
  CHANNELS: { email: true, whatsapp: false },
  WHATSAPP_TEMPLATE: 'payment_reminder', // approved template, body uses {{1}} name, {{2}} pass, {{3}} link
  WHATSAPP_LANG: 'en',
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
      var email = col.email === -1 ? '' : String(r[col.email] || '').trim();
      var useEmail = C.CHANNELS.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      var waPhone = whatsAppNumber_(r[col.phone]);
      var useWa = C.CHANNELS.whatsapp && !!waPhone;
      if (!useEmail && !useWa) continue;
      var ts = r[col.timestamp] instanceof Date ? r[col.timestamp].getTime() : new Date(r[col.timestamp]).getTime();
      if (!ts) continue;
      var ageHours = (now - ts) / 3600000;
      if (ageHours < C.WAIT_HOURS || ageHours > C.MAX_AGE_HOURS) continue;
      // Paid under another registration with the same phone (e.g. they changed pass): no reminder.
      if (paidPhones[phoneKey_(r[col.phone])]) continue;

      var msg = buildReminder_(r, col);
      if (dryRun) {
        Logger.log('Would remind ' + [useEmail ? email : '', useWa ? 'WhatsApp ' + waPhone : ''].filter(String).join(' + ') +
          ' (' + r[col.regId] + ', ' + ageHours.toFixed(1) + 'h old)');
        continue;
      }
      // Stamp first, then send: if sending fails we'd rather miss one reminder than send two.
      sheet.getRange(i + 1, col.reminded + 1).setValue(new Date());
      SpreadsheetApp.flush();
      var failures = [];
      if (useEmail) {
        try { MailApp.sendEmail({ to: email, subject: msg.subject, body: msg.text, htmlBody: msg.html, name: C.SENDER_NAME }); }
        catch (err) { failures.push('email: ' + err.message); }
      }
      if (useWa) {
        try { sendWhatsApp_(waPhone, msg); }
        catch (err) { failures.push('WhatsApp: ' + err.message); }
      }
      if (failures.length) sheet.getRange(i + 1, col.reminded + 1).setValue('FAILED ' + failures.join('; '));
      else sent++;
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
  return { subject: subject, text: text, html: html, name: name, pass: pass + (price ? ' (' + price + ')' : ''), link: link };
}

// WhatsApp Cloud API. Suggested template body (category "Utility") to submit in WhatsApp Manager:
//   Hi {{1}}, thanks for registering for Make Health Easier Wellness Fest 2026! Your payment hasn't
//   come through yet. Your pass is only secured once payment is made, and slots are limited.
//   Pass: {{2}}
//   Complete your payment here: {{3}}
//   If you have already paid, please ignore this message.
function sendWhatsApp_(to, msg) {
  var C = REMINDER_CONFIG;
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('WHATSAPP_TOKEN');
  var phoneId = props.getProperty('WHATSAPP_PHONE_ID');
  if (!token || !phoneId) throw new Error('WHATSAPP_TOKEN / WHATSAPP_PHONE_ID script properties are not set');
  var res = UrlFetchApp.fetch('https://graph.facebook.com/v21.0/' + phoneId + '/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      messaging_product: 'whatsapp',
      to: to,
      type: 'template',
      template: {
        name: C.WHATSAPP_TEMPLATE,
        language: { code: C.WHATSAPP_LANG },
        components: [{ type: 'body', parameters: [
          { type: 'text', text: msg.name }, { type: 'text', text: msg.pass }, { type: 'text', text: msg.link }
        ] }]
      }
    })
  });
  if (res.getResponseCode() >= 300) throw new Error(res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
}

// "012-345 6789" → "60123456789" (WhatsApp wants the country code, no leading 0 or +).
function whatsAppNumber_(v) {
  var d = String(v || '').replace(/\D/g, '');
  if (d.indexOf('60') === 0) return d.length >= 10 ? d : '';
  if (d.indexOf('0') === 0) d = '6' + d;
  return d.length >= 10 && d.length <= 13 ? d : '';
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
    email: find(C.COL_EMAIL, !C.CHANNELS.whatsapp), // optional when reminding by WhatsApp
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
