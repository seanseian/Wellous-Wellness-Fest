// ====================================================================
//  One-off: cancel "Little Hands, Big Memories: Parent & Kids Bonding Workshop"
//  (d2-daddy-daughter, shown as "Daddy & Daughter Play Date" in the Workshops sheet).
//  Add as a new script file named "CancelDaddyDaughter" next to Code.gs, WorkshopEmail.gs
//  and Sender.gs.
//
//  1. Run previewDaddyDaughterCancellation -> logs who will get the email and sends ONE sample
//                                            to you. Changes nothing and emails nobody else.
//  2. Run cancelDaddyDaughterAndEmail      -> cancels every booking for it, removes it from the
//                                            Workshops sheet and wait list, then emails each
//                                            guest. Safe to run twice: nobody is emailed twice.
// ====================================================================

var DD_ID = 'd2-daddy-daughter';
// The workshop is no longer in WORKSHOPS (WorkshopEmail.gs), so its details live here.
var DD_WORKSHOP = { name: 'Little Hands, Big Memories: Parent & Kids Bonding Workshop', date: '2026-10-25', start: '15:00', end: '15:30', stage: 'Main Zone', host: 'Melt Mellow × Squishy Fun', capacity: 50 };
// The workshop photo, dimmed with a "Cancelled" stamp (hosted on the site).
var DD_IMAGE_URL = 'https://makehealtheasierfest.wellous.com/images/ws-d2-daddy-daughter-cancelled.jpg';

/** Active bookings, one per phone number, with the email we'll send to. */
function ddRecipients_() {
  var data = getBookingsSheet().getDataRange().getValues();
  var seen = {}, list = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][1] !== DD_ID || data[i][6] !== 'Active') continue;
    var key = phoneKey(data[i][4]);
    if (!key || seen[key]) continue;
    seen[key] = true;
    list.push({ row: i + 1, fullName: data[i][3], contactNumber: data[i][4], email: emailForPhone_(data[i][4]) });
  }
  return list;
}

function ddCancelEmail_(guest) {
  var w = DD_WORKSHOP;
  var name = /[A-Za-z]/.test(String(guest.fullName || '')) ? String(guest.fullName).trim() : 'there';
  var start = toUtc_(w.date, w.start), end = toUtc_(w.date, w.end);
  var ics = buildIcs_({
    method: 'CANCEL', status: 'CANCELLED', sequence: 2,
    uid: eventUid_(DD_ID, guest.contactNumber), start: start, end: end,
    organiser: senderAddress_(), attendee: guest.email, attendeeName: guest.fullName,
    summary: w.name + ' · Wellness Fest 2026', description: 'This workshop has been cancelled.', location: VENUE
  });
  var body =
    '<img src="' + DD_IMAGE_URL + '" width="504" alt="' + esc_(w.name) + ' (cancelled)" style="display:block;width:100%;max-width:504px;height:auto;border:0;border-radius:12px;margin:0 0 22px;">' +
    '<p style="margin:0 0 16px;font-size:15px;">Hi ' + esc_(name) + ',</p>' +
    '<p style="margin:0 0 18px;font-size:15px;line-height:1.5;">We\'re sorry to let you know that <b>' + esc_(w.name) + '</b> has been cancelled, so your reservation for it has been released:</p>' +
    detailsTable_(w) +
    '<p style="margin:20px 0 0;font-size:15px;line-height:1.5;">Your festival pass is not affected, and we\'d still love to see you there. There are plenty of other workshops across both days, so why not book one (or a few) in its place?</p>' +
    '<p style="margin:12px 0 0;font-size:14px;line-height:1.5;color:' + MUTED + ';">We\'ve also removed this workshop from your calendar.</p>' +
    (moreWorkshops_(guest.contactNumber, null, 'Workshops with spots for you') ||
      '<div style="margin-top:24px;">' + button_(SITE_URL, 'Book another workshop') + '</div>');
  return {
    to: guest.email,
    subject: 'Cancelled: ' + w.name + ' (' + formatDay_(w.date) + ')',
    htmlBody: shell_('This workshop has been cancelled', body, BLUE),
    body: 'Hi ' + name + ',\n\nWe\'re sorry to let you know that ' + w.name + ' has been cancelled, so your reservation for it has been released.\n\n' +
      detailsText_(w) + '\n\nYour festival pass is not affected, and we\'d still love to see you there. Book another workshop in its place: ' + SITE_URL + '\n',
    attachments: [Utilities.newBlob(ics, 'text/calendar; charset=UTF-8; method=CANCEL', 'cancel.ics')]
  };
}

/** Step 1: dry run. Logs the recipients and sends one sample email to you. */
function previewDaddyDaughterCancellation() {
  var list = ddRecipients_();
  var withEmail = list.filter(function (g) { return g.email; });
  console.log('Active bookings: ' + list.length + '. With an email: ' + withEmail.length + '.');
  list.forEach(function (g) { console.log('  ' + displayPhone_(g.contactNumber) + '  ' + (g.email || '(NO EMAIL, will be skipped)') + '  ' + g.fullName); });
  var me = Session.getEffectiveUser().getEmail();
  var sample = ddCancelEmail_({ fullName: 'Test Guest', contactNumber: '0123456789', email: me });
  sample.subject = '[PREVIEW] ' + sample.subject;
  sample.attachments = []; // don't touch your own calendar
  sendMail_(sample);
  console.log('Sample sent to ' + me + '. Nothing else was changed.');
}

/** Step 2: cancels the bookings, removes the workshop, emails each guest once. */
function cancelDaddyDaughterAndEmail() {
  var props = PropertiesService.getScriptProperties();
  var sent = JSON.parse(props.getProperty('DD_CANCEL_SENT') || '{}');

  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  var list;
  try {
    list = ddRecipients_();
    var bookings = getBookingsSheet();
    var all = bookings.getDataRange().getValues();
    for (var i = 1; i < all.length; i++) {
      if (all[i][1] === DD_ID && all[i][6] === 'Active') bookings.getRange(i + 1, 7).setValue('Cancelled');
    }
    var ws = getWorkshopSheet();
    var wData = ws.getDataRange().getValues();
    for (var r = wData.length - 1; r >= 1; r--) {
      if (wData[r][0] === DD_ID) ws.deleteRow(r + 1);
    }
    var wl = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Waitlist');
    if (wl) {
      var wlData = wl.getDataRange().getValues();
      for (var k = 1; k < wlData.length; k++) {
        if (wlData[k][1] === DD_ID && wlData[k][5] === 'Waiting') wl.getRange(k + 1, 6, 1, 2).setValues([['Cancelled', new Date()]]);
      }
    }
  } finally {
    lock.releaseLock();
  }
  clearSlotsCache_();

  var ok = 0, skipped = 0, failed = 0;
  list.forEach(function (g) {
    var key = phoneKey(g.contactNumber);
    if (sent[key]) { skipped++; return; }
    if (!g.email) { console.warn('No email for ' + displayPhone_(g.contactNumber) + ', skipped.'); failed++; return; }
    try {
      sendMail_(ddCancelEmail_(g));
      sent[key] = g.email;
      props.setProperty('DD_CANCEL_SENT', JSON.stringify(sent));
      ok++;
    } catch (err) {
      console.error('Email to ' + g.email + ' failed: ' + err);
      failed++;
    }
  });
  console.log('Workshop cancelled. Bookings cancelled: ' + list.length + '. Emails sent: ' + ok + '. Already emailed before: ' + skipped + '. Problems: ' + failed + '.');
}
