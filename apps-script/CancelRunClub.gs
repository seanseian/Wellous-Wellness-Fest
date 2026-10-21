// ====================================================================
//  One-off: cancel "Make Health Easier Run Club: 5km Flag Off" (d1-run-club)
//  Add as a new script file named "CancelRunClub" next to Code.gs, Sender.gs and WorkshopEmail.gs.
//
//  1. Run previewRunClubCancellation  -> logs who will get the email and sends ONE sample to you.
//                                       Changes nothing in the sheet and emails nobody else.
//  2. Run cancelRunClubAndEmail       -> cancels every Run Club booking, removes the workshop
//                                       from the Workshops sheet (so nobody can book or wait-list
//                                       it), then emails each guest. Safe to run twice: a guest
//                                       who was already emailed is never emailed again.
// ====================================================================

var RUN_CLUB_ID = 'd1-run-club';
// The Run Club photo, greyed out with a "Cancelled" stamp. It goes live on the site with PR #18, so merge that before sending.
var RUN_CLUB_IMAGE_URL = 'https://makehealtheasierfest.wellous.com/images/ws-d1-run-club-cancelled.jpg';

/** Active Run Club bookings, one per phone number, with the email we'll send to. */
function runClubRecipients_() {
  var data = getBookingsSheet().getDataRange().getValues();
  var seen = {}, list = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][1] !== RUN_CLUB_ID || data[i][6] !== 'Active') continue;
    var key = phoneKey(data[i][4]);
    if (!key || seen[key]) continue;
    seen[key] = true;
    list.push({ row: i + 1, fullName: data[i][3], contactNumber: data[i][4], email: emailForPhone_(data[i][4]) });
  }
  return list;
}

/** Booking names are sometimes blank or a number (IC typed in the name box): fall back to "there". */
function friendlyName_(raw) {
  var s = String(raw || '').trim();
  return /[A-Za-z]/.test(s) ? s : 'there';
}

function runClubCancelEmail_(guest) {
  var w = WORKSHOPS[RUN_CLUB_ID];
  var name = friendlyName_(guest.fullName);
  var start = toUtc_(w.date, w.start), end = toUtc_(w.date, w.end);
  var ics = buildIcs_({
    method: 'CANCEL', status: 'CANCELLED', sequence: 2,
    uid: eventUid_(RUN_CLUB_ID, guest.contactNumber), start: start, end: end,
    organiser: senderAddress_(), attendee: guest.email, attendeeName: guest.fullName,
    summary: w.name + ' · Wellness Fest 2026', description: 'This workshop has been cancelled.', location: VENUE
  });
  var body =
    '<img src="' + RUN_CLUB_IMAGE_URL + '" width="504" alt="Make Health Easier Run Club: 5km Flag Off" style="display:block;width:100%;max-width:504px;height:auto;border:0;border-radius:12px;margin:0 0 22px;">' +
    '<p style="margin:0 0 16px;font-size:15px;">Hi ' + esc_(name) + ',</p>' +
    '<p style="margin:0 0 18px;font-size:15px;line-height:1.5;">We\'re sorry to let you know that the <b>Make Health Easier Run Club: 5km Flag Off</b> has been cancelled, so your reservation for it has been released:</p>' +
    detailsTable_(w) +
    '<p style="margin:20px 0 0;font-size:15px;line-height:1.5;">Your festival pass is not affected, and we\'d still love to see you there. There are plenty of other workshops across both days, so why not book one (or a few) in its place?</p>' +
    '<p style="margin:12px 0 0;font-size:14px;line-height:1.5;color:' + MUTED + ';">We\'ve also removed the Run Club from your calendar.</p>' +
    (moreWorkshops_(guest.contactNumber, null, 'Workshops with spots for you') ||
      '<div style="margin-top:24px;">' + button_(SITE_URL, 'Book another workshop') + '</div>');
  return {
    to: guest.email,
    subject: 'Cancelled: ' + w.name + ' (' + formatDay_(w.date) + ')',
    htmlBody: shell_('The Run Club has been cancelled', body, BLUE),
    body: 'Hi ' + name + ',\n\nWe\'re sorry to let you know that the Make Health Easier Run Club: 5km Flag Off has been cancelled, so your reservation for it has been released.\n\n' +
      detailsText_(w) + '\n\nYour festival pass is not affected, and we\'d still love to see you there. Book another workshop in its place: ' + SITE_URL + '\n',
    attachments: [Utilities.newBlob(ics, 'text/calendar; charset=UTF-8; method=CANCEL', 'cancel.ics')]
  };
}

/** Step 1: dry run. Logs the recipients and sends one sample email to you. */
function previewRunClubCancellation() {
  var list = runClubRecipients_();
  var withEmail = list.filter(function (g) { return g.email; });
  console.log('Active Run Club bookings: ' + list.length + '. With an email: ' + withEmail.length + '.');
  list.forEach(function (g) { console.log('  ' + displayPhone_(g.contactNumber) + '  ' + (g.email || '(NO EMAIL, will be skipped)') + '  ' + g.fullName); });
  var me = Session.getEffectiveUser().getEmail();
  var sample = runClubCancelEmail_({ fullName: 'Test Guest', contactNumber: '0123456789', email: me });
  sample.subject = '[PREVIEW] ' + sample.subject;
  sample.attachments = []; // don't touch your own calendar
  sendMail_(sample);
  console.log('Sample sent to ' + me + '. Nothing else was changed.');
}

/** Step 2: cancels the bookings, removes the workshop, emails each guest once. */
function cancelRunClubAndEmail() {
  var props = PropertiesService.getScriptProperties();
  var sent = JSON.parse(props.getProperty('RUN_CLUB_CANCEL_SENT') || '{}');

  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  var list;
  try {
    list = runClubRecipients_();
    var bookings = getBookingsSheet();
    var all = bookings.getDataRange().getValues();
    for (var i = 1; i < all.length; i++) {
      if (all[i][1] === RUN_CLUB_ID && all[i][6] === 'Active') bookings.getRange(i + 1, 7).setValue('Cancelled');
    }
    var ws = getWorkshopSheet();
    var wData = ws.getDataRange().getValues();
    for (var r = wData.length - 1; r >= 1; r--) {
      if (wData[r][0] === RUN_CLUB_ID) ws.deleteRow(r + 1);
    }
    var wl = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Waitlist');
    if (wl) {
      var wlData = wl.getDataRange().getValues();
      for (var k = 1; k < wlData.length; k++) {
        if (wlData[k][1] === RUN_CLUB_ID && wlData[k][5] === 'Waiting') wl.getRange(k + 1, 6, 1, 2).setValues([['Cancelled', new Date()]]);
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
      sendMail_(runClubCancelEmail_(g));
      sent[key] = g.email;
      props.setProperty('RUN_CLUB_CANCEL_SENT', JSON.stringify(sent));
      ok++;
    } catch (err) {
      console.error('Email to ' + g.email + ' failed: ' + err);
      failed++;
    }
  });
  console.log('Run Club cancelled. Bookings cancelled: ' + list.length + '. Emails sent: ' + ok + '. Already emailed before: ' + skipped + '. Problems: ' + failed + '.');
}
