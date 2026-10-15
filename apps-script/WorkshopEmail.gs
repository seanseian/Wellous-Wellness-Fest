/**
 * Wellness Fest 2026: workshop confirmation + cancellation emails (with calendar
 * invite / calendar removal), pass emails, and the server-side payment check used by Code.gs.
 *
 * One-time setup (Apps Script -> Project Settings -> Script properties):
 *   VERIFY_URL        https://makehealtheasierfest.wellous.com/api/verify-payment
 *   INTERNAL_API_KEY  the same secret you set in Vercel's environment variables
 *
 * Until both are set, bookings still work exactly as before (no payment check,
 * no email), so nothing breaks while you're setting it up.
 *
 * Passes (Oct 2026):
 *   BOTH  Wellness Experience Pass, RM50: both days + Wellous Trial Set + workshop booking
 *   EXP   Wellness Explorer Pass, free: both days, no trial set, no workshop booking
 *   D1/D2 1-Day Pass, RM35: no longer sold, but passes already bought still work
 */

// Workshop schedule (Malaysia time, UTC+8). Keep in sync with the website cards.
var WORKSHOPS = {
  'd1-sound-bath': { name: 'Hear Your Inner Sound: The NOICE Sound Bath with Ghynna Hen', date: '2026-10-24', start: '09:00', end: '09:45', stage: 'Move Zone', host: 'With Ghynna Hen', capacity: 100 },
  'd1-zumba': { name: 'Feel the Beat, Feel the Energy: Zumba with Hannah Kamal', date: '2026-10-24', start: '09:55', end: '10:35', stage: 'Main Zone', host: 'With Hannah Kamal', capacity: 50 },
  'd1-strength-yoga': { name: 'Find Your Flow: Strength Yoga with Jessica Lim', date: '2026-10-24', start: '10:00', end: '10:45', stage: 'Move Zone', host: 'With Jessica Lim', capacity: 100 },
  'd1-chair-yoga': { name: 'Easy Exercise for Seniors: Chair Yoga with Cheryl Chung', date: '2026-10-24', start: '11:45', end: '12:15', stage: 'Main Zone', host: 'With Cheryl Chung', capacity: 50 },
  'workshop2': { name: 'Good Food, Made Easy: Healthy Cooking Workshop with Tefal', date: '2026-10-24', start: '14:00', end: '14:40', stage: 'Main Zone', host: 'With Tefal Chef', capacity: 50 },
  'd1-yoga-mobility': { name: 'Move Freely: Yoga & Mobility with Niewei', date: '2026-10-24', start: '16:30', end: '17:15', stage: 'Move Zone', host: 'With Niewei', capacity: 100 },
  'd1-mat-pilates': { name: 'Align & Flow: Mat Pilates with Siow Yen', date: '2026-10-24', start: '17:30', end: '18:15', stage: 'Move Zone', host: 'With Siow Yen', capacity: 100 },
  'd1-floral': { name: 'Bloom with Meaning: Floral Workshop with Fleur Floristry', date: '2026-10-24', start: '17:35', end: '18:15', stage: 'Main Zone', host: 'With Fleur Floristry', capacity: 50 },
  'd1-breathwork': { name: 'Breathe In, Let Go: Breathwork Session with Rachel | IMD', date: '2026-10-24', start: '18:30', end: '19:15', stage: 'Move Zone', host: 'With Rachel | IMD', capacity: 100 },
  'd2-pound': { name: 'Find Your Rhythm: AFYAA Pound Workshop', date: '2026-10-25', start: '08:00', end: '09:00', stage: 'Move Zone', host: 'AFYAA Wellness Session', capacity: 100 },
  'd2-yin-yoga': { name: 'Slow Down & Flow: Yin Yoga with Cindy', date: '2026-10-25', start: '09:00', end: '09:45', stage: 'Move Zone', host: 'With Cindy', capacity: 100 },
  'workshop6': { name: 'Create & Connect: DIY Creative Tent for Parents & Kids', date: '2026-10-25', start: '10:00', end: '10:45', stage: 'Move Zone', host: 'With SEIA', capacity: 100 },
  'd2-hiit': { name: 'Ignite Your Energy: HIIT Workout with ZIN Cassy', date: '2026-10-25', start: '10:20', end: '11:00', stage: 'Main Zone', host: 'With ZIN Cassy', capacity: 50 },
  'd2-daddy-daughter': { name: 'Little Hands, Big Memories: Parent & Kids Bonding Workshop', date: '2026-10-25', start: '15:00', end: '15:30', stage: 'Main Zone', host: 'Melt Mellow \u00d7 Squishy Fun', capacity: 50 },
  'd2-hiit-strength': { name: 'Power Up: HIIT Strength with Vicky', date: '2026-10-25', start: '16:30', end: '17:15', stage: 'Move Zone', host: 'With Vicky', capacity: 100 },
  'd2-zumba': { name: 'Feel the Beat: Zumba with Grace', date: '2026-10-25', start: '17:30', end: '18:15', stage: 'Move Zone', host: 'With Grace', capacity: 100 },
  'd2-yoga-flow': { name: 'Flow Into Wellness: Yoga Flow with Edward Chung', date: '2026-10-25', start: '18:30', end: '19:15', stage: 'Move Zone', host: 'With Edward Chung', capacity: 100 }
};
var VENUE = 'KL Wellness City Gallery, Bukit Jalil, Kuala Lumpur';
var SITE_URL = 'https://makehealtheasierfest.wellous.com/#book';
var REGISTER_URL = 'https://makehealtheasierfest.wellous.com/#register';
// PNG hosted on the site (email apps don't show SVG). Swap for any hosted PNG/JPG.
var LOGO_URL = 'https://makehealtheasierfest.wellous.com/images/masthead.png';
// Pass ticket artwork shown in the "pass confirmed" email (PNG, hosted on the site)
var TICKET_URLS = {
  BOTH: 'https://makehealtheasierfest.wellous.com/images/ticket-2day.png',
  D1: 'https://makehealtheasierfest.wellous.com/images/ticket-1day.png',
  D2: 'https://makehealtheasierfest.wellous.com/images/ticket-1day.png'
};

var GREEN = '#2F8A17', BLUE = '#1F6FB2', INK = '#0F2A19', MUTED = '#5B6E62';

// ====================================================================
//  Emails
// ====================================================================

/** Booking confirmed. Never throws, so a mail problem can't undo a booking. */
function sendWorkshopConfirmation(booking) {
  try {
    var w = WORKSHOPS[booking.workshopId];
    var email = booking.email;
    if (!w || !email) {
      if (w) console.warn('No email for booking ' + booking.workshopId + ' / ' + booking.contactNumber);
      workshopEmailNote_('SKIPPED ' + booking.workshopId + ' / ' + booking.contactNumber + (w ? ' (no email found for this phone)' : ' (unknown workshop)'));
      return false;
    }
    var start = toUtc_(w.date, w.start), end = toUtc_(w.date, w.end);
    var phone = displayPhone_(booking.contactNumber);
    var name = String(booking.fullName || '').trim() || 'there';

    var ics = buildIcs_({
      method: 'REQUEST', status: 'CONFIRMED', sequence: 0,
      uid: eventUid_(booking.workshopId, booking.contactNumber), start: start, end: end,
      organiser: Session.getEffectiveUser().getEmail(), attendee: email, attendeeName: booking.fullName,
      summary: w.name + ' \u00B7 Wellness Fest 2026',
      description: 'Your reserved workshop slot at Make Health Easier Wellness Fest 2026.\n\n' +
        'TO ENTER: give the phone number you used to reserve this slot (' + phone + ') at the workshop entrance.',
      location: VENUE
    });

    var body =
      '<p style="margin:0 0 16px;font-size:15px;">Hi ' + esc_(name) + ',</p>' +
      '<p style="margin:0 0 18px;font-size:15px;line-height:1.5;">' + (booking.promoted
        ? 'Good news! A spot opened up and you were next on the wait list, so we\'ve reserved this workshop for you. Here are your details:'
        : 'You\'re booked in. Here are your details:') + '</p>' +
      detailsTable_(w) +
      '<div style="border:2px dashed ' + GREEN + ';border-radius:12px;padding:16px 18px;margin-top:20px;">' +
        '<div style="font-weight:bold;font-size:15px;margin-bottom:6px;">How to enter the workshop</div>' +
        '<div style="font-size:14px;line-height:1.5;color:' + MUTED + ';">Please provide the phone number you used to sign up for this slot at the workshop entrance:</div>' +
        '<div style="font-size:22px;font-weight:bold;letter-spacing:1px;margin-top:8px;color:' + GREEN + ';">' + esc_(phone) + '</div>' +
      '</div>' +
      '<p style="margin:20px 0 12px;font-size:14px;line-height:1.5;color:' + MUTED + ';">A calendar invite is attached. Tap <b>Yes</b> to add it to your calendar, or use the button below.</p>' +
      button_(googleCalendarLink_(w, start, end, phone), 'Add to Google Calendar') +
      '&nbsp;&nbsp;<a href="' + SITE_URL + '" style="display:inline-block;color:' + GREEN + ';text-decoration:none;font-weight:bold;padding:12px 6px;font-size:14px;">Manage my bookings</a>' +
      moreWorkshops_(booking.contactNumber, booking.pass, 'Make a day of it: more workshops you can join');

    MailApp.sendEmail({
      to: email,
      subject: (booking.promoted ? 'Good news! A spot opened up. You\'re in: ' : 'You\'re in: ') + w.name + ' (' + formatDay_(w.date) + ', ' + formatTime_(w.start) + ')',
      htmlBody: shell_(booking.promoted ? 'A spot opened up. You\'re in!' : 'Your workshop slot is reserved', body),
      body: 'Hi ' + name + ',\n\n' + (booking.promoted ? 'A spot opened up and you were next on the wait list, so your workshop slot is now reserved.' : 'Your workshop slot is reserved.') + '\n\n' + detailsText_(w) +
        '\n\nHOW TO ENTER: please provide the phone number you used to sign up for this slot (' + phone +
        ') at the workshop entrance.\n\nA calendar invite is attached.\nBook more workshops or manage your bookings: ' + SITE_URL + '\n',
      name: 'Make Health Easier Wellness Fest',
      attachments: [Utilities.newBlob(ics, 'text/calendar; charset=UTF-8; method=REQUEST', 'invite.ics')]
    });
    workshopEmailNote_('SENT ' + booking.workshopId + ' to ' + email);
    return true;
  } catch (err) {
    console.error('sendWorkshopConfirmation failed: ' + err);
    workshopEmailNote_('FAILED ' + booking.workshopId + ': ' + err);
    return false;
  }
}
function workshopEmailNote_(text) {
  try { PropertiesService.getScriptProperties().setProperty('zz_last_workshop_email', new Date().toISOString() + ' | ' + text); } catch (err) {}
}

/**
 * Wait list: someone cancelled and this guest was next, so they now hold the slot.
 * Same confirmation + calendar invite as a normal booking, with "you're in" wording.
 */
function sendWaitlistPromotion(promoted) {
  try {
    var pass = checkPass_(null, displayPhone_(promoted.contactNumber));
    return sendWorkshopConfirmation({
      workshopId: promoted.workshopId,
      fullName: promoted.fullName,
      contactNumber: promoted.contactNumber,
      email: (pass && pass.email) || emailForPhone_(promoted.contactNumber),
      pass: pass && pass.pass,
      promoted: true
    });
  } catch (err) {
    console.error('sendWaitlistPromotion failed: ' + err);
    return false;
  }
}

/**
 * Booking cancelled: tells the guest, removes the event from their calendar and
 * suggests other workshops. Looks up their email from their paid pass.
 */
function sendCancellationEmail(booking) {
  try {
    var w = WORKSHOPS[booking.workshopId];
    if (!w) return false;
    var pass = checkPass_(null, displayPhone_(booking.contactNumber));
    var email = (pass && pass.email) || emailForPhone_(booking.contactNumber);
    if (!email) {
      console.warn('No email for cancellation ' + booking.workshopId + ' / ' + booking.contactNumber);
      return false;
    }
    var start = toUtc_(w.date, w.start), end = toUtc_(w.date, w.end);
    var name = String(booking.fullName || '').trim() || 'there';

    var ics = buildIcs_({
      method: 'CANCEL', status: 'CANCELLED', sequence: 1,
      uid: eventUid_(booking.workshopId, booking.contactNumber), start: start, end: end,
      organiser: Session.getEffectiveUser().getEmail(), attendee: email, attendeeName: booking.fullName,
      summary: w.name + ' \u00B7 Wellness Fest 2026', description: 'This workshop reservation was cancelled.', location: VENUE
    });

    var body =
      '<p style="margin:0 0 16px;font-size:15px;">Hi ' + esc_(name) + ',</p>' +
      '<p style="margin:0 0 18px;font-size:15px;line-height:1.5;">Your reservation for this workshop has been cancelled, and your spot has been released for someone else:</p>' +
      detailsTable_(w) +
      '<p style="margin:20px 0 0;font-size:14px;line-height:1.5;color:' + MUTED + ';">We\'ve also removed it from your calendar. Changed your mind? If there are still spots left, you can book it again on the website.</p>' +
      moreWorkshops_(booking.contactNumber, pass && pass.pass, 'Still keen? These workshops have spots for you');

    MailApp.sendEmail({
      to: email,
      subject: 'Cancelled: ' + w.name + ' (' + formatDay_(w.date) + ', ' + formatTime_(w.start) + ')',
      htmlBody: shell_('Your workshop reservation is cancelled', body, BLUE),
      body: 'Hi ' + name + ',\n\nYour reservation has been cancelled and the spot released.\n\n' + detailsText_(w) +
        '\n\nBook another workshop: ' + SITE_URL + '\n',
      name: 'Make Health Easier Wellness Fest',
      attachments: [Utilities.newBlob(ics, 'text/calendar; charset=UTF-8; method=CANCEL', 'cancel.ics')]
    });
    return true;
  } catch (err) {
    console.error('sendCancellationEmail failed: ' + err);
    return false;
  }
}

/**
 * Pass paid: called from markPaid() (Stripe webhook). Confirms the pass and
 * payment, explains entry, and invites them to reserve workshop slots.
 */
function passEmailNote_(text) {
  try { PropertiesService.getScriptProperties().setProperty('zz_last_pass_email', new Date().toISOString() + ' | ' + text); } catch (err) {}
}
function sendPassConfirmation(pay) {
  try {
    var m = /^WWF_(D1|D2|BOTH|UPG)_(\d{6,15})_/.exec(pay.regId || '');
    if (!m || !pay.email) {
      console.warn('Pass email skipped for ' + pay.regId + ' (no email or unexpected reference)');
      passEmailNote_('SKIPPED ' + pay.regId + (pay.email ? ' (unexpected reference)' : ' (no buyer email)'));
      return false;
    }
    // Stripe retries webhooks; only ever send one email per payment.
    var props = PropertiesService.getScriptProperties();
    var sentKey = 'passmail_' + pay.regId;
    if (props.getProperty(sentKey)) { console.log('Pass email already sent earlier for ' + pay.regId); passEmailNote_('already sent earlier for ' + pay.regId); return false; }

    var upgraded = m[1] === 'UPG'; // RM15 top-up from a 1-Day Pass to the Wellness Experience Pass
    var pass = upgraded ? 'BOTH' : m[1], phone = displayPhone_(m[2]);
    // 1-Day holders: offer the RM15 top-up (on unless Script properties > TOP_UP_ENABLED = false;
    // keep in step with TOP_UP_ENABLED in index.html)
    var offerTopUp = !upgraded && pass !== 'BOTH' && props.getProperty('TOP_UP_ENABLED') !== 'false';
    var name = String(pay.fullName || '').trim() || 'there';
    var info = PASS_INFO[pass];
    var paid = formatAmount_(pay.amount, pay.currency);

    var body =
      '<p style="margin:0 0 16px;font-size:15px;">Hi ' + esc_(name) + ',</p>' +
      '<p style="margin:0 0 18px;font-size:15px;line-height:1.5;">' + (upgraded
        ? 'Great news, your top-up was successful! You now have the <b>Wellness Experience Pass</b>, which covers <b>both days</b> of the fest. See you there!'
        : 'Thank you, your payment was successful and your ' + esc_(info.short) + ' is confirmed. See you at the fest!') + '</p>' +
      '<div style="text-align:center;margin:4px 0 20px;"><img src="' + TICKET_URLS[pass] + '" width="320" alt="Your ' + esc_(info.short) + '" style="display:inline-block;width:320px;max-width:90%;height:auto;border:0;"></div>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2FAEC;border-radius:12px;">' +
        row_('Pass', esc_(info.name)) +
        row_('Valid on', esc_(info.days)) +
        row_('Event timing', '9:00 AM \u2013 7:00 PM daily') +
        row_('Venue', esc_(VENUE)) +
        (paid ? row_(upgraded ? 'Top-up paid' : 'Amount paid', esc_(paid) + ' <span style="color:' + GREEN + ';">\u2713 Paid</span>') : '') +
        row_('Reference', '<span style="font-family:monospace;font-size:13px;">' + esc_(pay.regId) + '</span>') +
      '</table>' +
      (pass === 'BOTH' ? experienceIncludes_() : '') +
      '<div style="border:2px dashed ' + GREEN + ';border-radius:12px;padding:16px 18px;margin-top:20px;">' +
        '<div style="font-weight:bold;font-size:15px;margin-bottom:6px;">At the entrance</div>' +
        '<div style="font-size:14px;line-height:1.5;color:' + MUTED + ';">Show this email or give the phone number you registered with' + (pass === 'BOTH' ? ', and collect your Wellous Trial Set at the counter' : '') + ':</div>' +
        '<div style="font-size:22px;font-weight:bold;letter-spacing:1px;margin-top:8px;color:' + GREEN + ';">' + esc_(phone) + '</div>' +
      '</div>' +
      (offerTopUp
        ? '<div style="border:2px solid #F5A623;background:#FFF6E5;border-radius:12px;padding:16px 18px;margin-top:20px;">' +
            '<div style="font-size:16px;font-weight:bold;color:' + INK + ';">Come on both days for just RM15 more</div>' +
            '<div style="font-size:14px;line-height:1.5;color:' + MUTED + ';margin:6px 0 12px;">Top up your 1-Day Pass to the Wellness Experience Pass and book workshops on both days.</div>' +
            button_(SITE_URL, 'Top up for RM15') +
          '</div>'
        : '') +
      '<div style="background:#FFFDE8;border-radius:12px;padding:18px;margin-top:20px;">' +
        '<div style="font-size:16px;font-weight:bold;color:' + INK + ';">Next: reserve your workshop slots</div>' +
        '<div style="font-size:14px;line-height:1.5;color:' + MUTED + ';margin:6px 0 14px;">Your pass gets you in, but workshops need a quick booking. Spots are limited, so grab the ones you love now and you\'re all set!</div>' +
        button_(SITE_URL, 'Reserve my workshops') +
      '</div>' +
      moreWorkshops_(phone, pass, 'Workshops you can book with your pass');

    MailApp.sendEmail({
      to: pay.email,
      subject: (upgraded ? 'Top-up confirmed: you now have the Wellness Experience Pass' : 'Payment confirmed: your ' + info.short) + ' for Make Health Easier Wellness Fest 2026',
      htmlBody: shell_(upgraded ? 'You\'re all set for both days' : 'Your pass is confirmed', body),
      body: 'Hi ' + name + ',\n\nYour payment was successful and your pass is confirmed.\n\n' +
        'Pass: ' + info.name + '\nValid on: ' + info.days + '\nEvent timing: 9:00 AM - 7:00 PM daily\nVenue: ' + VENUE +
        (paid ? '\nAmount paid: ' + paid : '') + '\nReference: ' + pay.regId +
        (pass === 'BOTH' ? '\n\nYOUR PASS INCLUDES: a Wellous Trial Set (collect it at the counter) and workshop & workout class booking.' : '') +
        '\n\nAT THE ENTRANCE: show this email or give the phone number you registered with (' + phone + ').' +
        '\n\nReserve your workshop slots: ' + SITE_URL + '\n',
      name: 'Make Health Easier Wellness Fest'
    });
    props.setProperty(sentKey, new Date().toISOString());
    console.log('Pass email sent for ' + pay.regId + ' (' + MailApp.getRemainingDailyQuota() + ' emails left today)');
    passEmailNote_('SENT for ' + pay.regId + ' to ' + pay.email + ' (' + MailApp.getRemainingDailyQuota() + ' emails left today)');
    return true;
  } catch (err) {
    console.error('sendPassConfirmation failed: ' + err);
    passEmailNote_('FAILED for ' + pay.regId + ': ' + err);
    return false;
  }
}

/** "What your Experience Pass includes" box for the paid pass email. */
function experienceIncludes_() {
  function item(title, text) {
    return '<tr><td style="padding:8px 0;vertical-align:top;width:26px;color:' + GREEN + ';font-weight:bold;font-size:16px;">\u2713</td>' +
      '<td style="padding:8px 0;font-size:14px;line-height:1.45;color:' + INK + ';"><b>' + title + '</b><br><span style="color:' + MUTED + ';">' + text + '</span></td></tr>';
  }
  return '<div style="border:1px solid #E1EBDC;border-radius:12px;padding:14px 18px;margin-top:20px;">' +
    '<div style="font-size:16px;font-weight:bold;color:' + INK + ';margin-bottom:4px;">Your Wellness Experience Pass includes</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
      item('2-day full festival access', 'Health talks, wellness sessions, games, rewards and festival-only deals on 24 &amp; 25 October.') +
      item('Complimentary health screening (worth RM200)', 'Drop by the screening booths any time during the fest.') +
      item('Wellous Trial Set (worth RM150)', 'Collect it at the counter with your registered phone number.') +
      item('Workshop &amp; workout class booking (worth RM300)', 'Yoga, Zumba, Sound Bath, Mobility and more. Limited slots, so book early.') +
      item('Goodie bag, brand vouchers, snacks &amp; refreshments', 'Enjoy them throughout both days.') +
    '</table>' +
  '</div>';
}

/**
 * Free Wellness Explorer Pass: call from Code.gs right after the registration row is saved,
 * when attendance is "Explorer" and an email was given. There is no payment, so this is the
 * only email they get. Sends once per registration reference.
 *   reg = { regId, email, fullName, contactNumber }
 */
function sendExplorerConfirmation(reg) {
  try {
    if (!reg || !reg.email || !/^WWF_EXP_\d{6,15}_/.test(reg.regId || '')) {
      passEmailNote_('SKIPPED explorer ' + (reg && reg.regId) + (reg && reg.email ? ' (unexpected reference)' : ' (no email)'));
      return false;
    }
    var props = PropertiesService.getScriptProperties();
    var sentKey = 'explorermail_' + reg.regId;
    if (props.getProperty(sentKey)) return false;

    var phone = displayPhone_(reg.contactNumber);
    var name = String(reg.fullName || '').trim() || 'there';
    var info = PASS_INFO.EXP;

    var body =
      '<p style="margin:0 0 16px;font-size:15px;">Hi ' + esc_(name) + ',</p>' +
      '<p style="margin:0 0 18px;font-size:15px;line-height:1.5;">Thanks for registering! Your free <b>Wellness Explorer Pass</b> is confirmed. See you at the fest!</p>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2FAEC;border-radius:12px;">' +
        row_('Pass', esc_(info.name)) +
        row_('Valid on', esc_(info.days)) +
        row_('Event timing', '9:00 AM \u2013 7:00 PM daily') +
        row_('Venue', esc_(VENUE)) +
        row_('Price', 'FREE') +
        row_('Reference', '<span style="font-family:monospace;font-size:13px;">' + esc_(reg.regId) + '</span>') +
      '</table>' +
      '<div style="border:2px dashed ' + GREEN + ';border-radius:12px;padding:16px 18px;margin-top:20px;">' +
        '<div style="font-weight:bold;font-size:15px;margin-bottom:6px;">At the entrance</div>' +
        '<div style="font-size:14px;line-height:1.5;color:' + MUTED + ';">Show this email or give the phone number you registered with:</div>' +
        '<div style="font-size:22px;font-weight:bold;letter-spacing:1px;margin-top:8px;color:' + GREEN + ';">' + esc_(phone) + '</div>' +
      '</div>' +
      '<div style="border:1px solid #E1EBDC;border-radius:12px;padding:14px 18px;margin-top:20px;font-size:14px;line-height:1.6;color:' + INK + ';">' +
        '<div style="font-size:16px;font-weight:bold;margin-bottom:4px;">Your Explorer Pass includes</div>' +
        '\u2713 2-day full festival access<br>\u2713 Unlimited health talks &amp; wellness sessions<br>' +
        '\u2713 Complimentary health screening (worth RM200)<br>\u2713 Goodie bag + brand vouchers<br>' +
        '\u2713 Snacks &amp; refreshments<br>\u2713 Games, rewards &amp; festival-only deals' +
      '</div>' +
      '<div style="border:2px solid #F5A623;background:#FFF6E5;border-radius:12px;padding:16px 18px;margin-top:20px;">' +
        '<div style="font-size:16px;font-weight:bold;color:' + INK + ';">Want to experience more?</div>' +
        '<div style="font-size:14px;line-height:1.5;color:' + MUTED + ';margin:6px 0 12px;">Upgrade to the <b>Wellness Experience Pass</b> for RM50 (RM650+ value) to get a <b>Wellous Trial Set</b> and <b>book workshop &amp; workout class slots</b>. Register again on the website with the same phone number and pick the Experience Pass.</div>' +
        button_(REGISTER_URL, 'Upgrade for RM50') +
      '</div>';

    MailApp.sendEmail({
      to: reg.email,
      subject: 'You\'re registered: your free Wellness Explorer Pass for Make Health Easier Wellness Fest 2026',
      htmlBody: shell_('Your free pass is confirmed', body),
      body: 'Hi ' + name + ',\n\nYour free Wellness Explorer Pass is confirmed.\n\n' +
        'Pass: ' + info.name + '\nValid on: ' + info.days + '\nEvent timing: 9:00 AM - 7:00 PM daily\nVenue: ' + VENUE +
        '\nReference: ' + reg.regId +
        '\n\nAT THE ENTRANCE: show this email or give the phone number you registered with (' + phone + ').' +
        '\n\nWant the Wellous Trial Set and workshop booking? Upgrade to the Wellness Experience Pass for RM50: ' + REGISTER_URL + '\n',
      name: 'Make Health Easier Wellness Fest'
    });
    props.setProperty(sentKey, new Date().toISOString());
    passEmailNote_('SENT explorer ' + reg.regId + ' to ' + reg.email);
    return true;
  } catch (err) {
    console.error('sendExplorerConfirmation failed: ' + err);
    passEmailNote_('FAILED explorer ' + (reg && reg.regId) + ': ' + err);
    return false;
  }
}

var PASS_INFO = {
  D1:   { short: '1-Day Pass', name: '1-Day Pass (Day 1)', days: 'Saturday, 24 October 2026' },
  D2:   { short: '1-Day Pass', name: '1-Day Pass (Day 2)', days: 'Sunday, 25 October 2026' },
  BOTH: { short: 'Wellness Experience Pass', name: 'Wellness Experience Pass', days: 'Saturday & Sunday, 24 \u2013 25 October 2026' },
  EXP:  { short: 'Wellness Explorer Pass', name: 'Wellness Explorer Pass (free)', days: 'Saturday & Sunday, 24 \u2013 25 October 2026' }
};

/** 5000 + "myr" -> "RM50.00" */
function formatAmount_(amount, currency) {
  var n = Number(amount);
  if (!amount || isNaN(n)) return '';
  var cur = String(currency || '').toUpperCase();
  return (cur === 'MYR' || !cur ? 'RM' : cur + ' ') + (n / 100).toFixed(2);
}

// ====================================================================
//  Payment check (used by bookSlot in Code.gs and by the cancellation email)
// ====================================================================

/**
 * Asks the site's /api/verify-payment whether this booking has a paid pass.
 * Returns { paid, pass, email } or null when the check isn't configured / reachable.
 * The free Explorer Pass is never "paid", so it can't book workshops.
 */
function checkPass_(sessionId, phone) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('VERIFY_URL');
  var key = props.getProperty('INTERNAL_API_KEY');
  if (!url || !key) return null;
  try {
    var query = sessionId ? 'session_id=' + encodeURIComponent(sessionId) : 'phone=' + encodeURIComponent(phone || '');
    var res = UrlFetchApp.fetch(url + '?' + query, { headers: { 'X-Internal-Key': key }, muteHttpExceptions: true });
    if (res.getResponseCode() >= 500) return null; // Stripe/Vercel hiccup: don't block the booking, just skip the email
    var data = JSON.parse(res.getContentText() || '{}');
    return { paid: !!data.paid, pass: data.pass || null, email: data.email || null };
  } catch (err) {
    console.error('checkPass_ failed: ' + err);
    return null;
  }
}

/** D1 covers Day 1 workshops, D2 covers Day 2, BOTH covers everything. */
function passCoversWorkshop_(pass, workshopId) {
  var w = WORKSHOPS[workshopId];
  if (!w || !pass || pass === 'BOTH') return true;
  return (pass === 'D1' && w.date === '2026-10-24') || (pass === 'D2' && w.date === '2026-10-25');
}

// ====================================================================
//  Email building blocks
// ====================================================================

/** Page frame shared by every email: logo, green title bar, body, footer. */
function shell_(title, bodyHtml, barColour) {
  return '' +
  '<div style="background:#F7FFF0;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;color:' + INK + ';">' +
   '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #E1EBDC;">' +
    '<tr><td align="center" style="background:#FFFDE8;padding:22px 28px 18px;">' +
      '<img src="' + LOGO_URL + '" width="300" alt="Make Health Easier Wellness Fest" style="display:block;width:300px;max-width:100%;height:auto;border:0;">' +
    '</td></tr>' +
    '<tr><td style="background:' + (barColour || GREEN) + ';padding:22px 28px;color:#ffffff;">' +
      '<div style="font-size:13px;letter-spacing:1px;text-transform:uppercase;opacity:.85;">Make Health Easier Wellness Fest 2026</div>' +
      '<div style="font-size:22px;font-weight:bold;margin-top:6px;">' + esc_(title) + '</div>' +
    '</td></tr>' +
    '<tr><td style="padding:26px 28px 26px;">' + bodyHtml + '</td></tr>' +
    '<tr><td style="padding:16px 28px;background:#F7FFF0;font-size:12px;color:' + MUTED + ';line-height:1.5;">' +
      'Can\'t make it? Please cancel on the website so someone else can take your spot.<br>' +
      'Presented by Wellous \u00B7 ' + esc_(VENUE) + ' \u00B7 24 &amp; 25 October 2026' +
    '</td></tr>' +
   '</table>' +
  '</div>';
}

function detailsTable_(w) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2FAEC;border-radius:12px;">' +
    row_('Workshop', esc_(w.name)) +
    row_('Date', formatDay_(w.date)) +
    row_('Time', formatTime_(w.start) + ' \u2013 ' + formatTime_(w.end)) +
    row_('Where', esc_(w.stage) + ', ' + esc_(VENUE)) +
    row_('Details', esc_(w.host)) +
  '</table>';
}

function detailsText_(w) {
  return 'Workshop: ' + w.name + '\nDate: ' + formatDay_(w.date) + '\nTime: ' + formatTime_(w.start) + ' - ' + formatTime_(w.end) + '\nWhere: ' + w.stage + ', ' + VENUE;
}

function row_(label, value) {
  return '<tr><td style="padding:10px 16px;font-size:13px;color:' + MUTED + ';width:34%;vertical-align:top;">' + label + '</td>' +
         '<td style="padding:10px 16px;font-size:14px;font-weight:bold;color:' + INK + ';">' + value + '</td></tr>';
}

function button_(href, label) {
  return '<a href="' + href + '" style="display:inline-block;background:' + GREEN + ';color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:999px;font-size:14px;">' + esc_(label) + '</a>';
}

/**
 * "More workshops" section: the workshops this guest's pass covers that they
 * haven't booked, with live spots left and a button to book on the website.
 */
function moreWorkshops_(contactNumber, pass, heading) {
  try {
    var workshopData = getWorkshopSheet().getDataRange().getValues();
    var bookingsData = getBookingsSheet().getDataRange().getValues();
    var mine = {};
    for (var b = 1; b < bookingsData.length; b++) {
      if (bookingsData[b][6] === 'Active' && samePhone(bookingsData[b][4], contactNumber)) mine[bookingsData[b][1]] = true;
    }

    var cards = '', shown = 0, MAX_SHOWN = 4; // keep the email short: the next few with spots left
    for (var i = 1; i < workshopData.length && shown < MAX_SHOWN; i++) {
      var id = workshopData[i][0], w = WORKSHOPS[id];
      if (!w || mine[id] || !passCoversWorkshop_(pass, id)) continue;
      var left = Number(workshopData[i][4]) - Number(workshopData[i][5]);
      if (left <= 0) continue; // fully booked ones aren't useful in an email
      shown++;
      var status = left > 0
        ? '<span style="color:' + (left <= 10 ? '#C26A00' : GREEN) + ';font-weight:bold;">' + left + ' spots left</span>'
        : '<span style="color:#C1453D;font-weight:bold;">Fully booked, check back later</span>';
      cards +=
        '<tr><td style="padding:14px 16px;border-top:1px solid #E1EBDC;">' +
          '<div style="font-size:15px;font-weight:bold;color:' + INK + ';">' + esc_(w.name) + '</div>' +
          '<div style="font-size:13px;color:' + MUTED + ';margin-top:4px;">' + dayLabel_(w.date) + ' \u00B7 ' + formatTime_(w.start) + ' \u2013 ' + formatTime_(w.end) + ' \u00B7 ' + esc_(w.stage) + ' \u00B7 ' + esc_(w.host) + '</div>' +
          '<div style="font-size:13px;margin-top:6px;">' + status + '</div>' +
          (left > 0 ? '<div style="margin-top:10px;"><a href="' + SITE_URL + '" style="display:inline-block;background:#74DE16;color:' + INK + ';text-decoration:none;font-weight:bold;padding:9px 16px;border-radius:999px;font-size:13px;">Book this slot</a></div>' : '') +
        '</td></tr>';
    }
    if (!cards) return '';
    return '<div style="margin-top:28px;">' +
      '<div style="font-size:17px;font-weight:bold;color:' + INK + ';margin-bottom:10px;">' + esc_(heading) + '</div>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAFDF7;border:1px solid #E1EBDC;border-radius:12px;">' + cards + '</table>' +
      '<div style="margin-top:14px;">' + button_(SITE_URL, 'See all workshops') + '</div>' +
    '</div>';
  } catch (err) {
    console.error('moreWorkshops_ failed: ' + err);
    return '';
  }
}

// ====================================================================
//  Calendar
// ====================================================================

function buildIcs_(e) {
  function fmt(d) { return Utilities.formatDate(d, 'UTC', "yyyyMMdd'T'HHmmss'Z'"); }
  function txt(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1'); }
  var lines = [
    'BEGIN:VCALENDAR', 'PRODID:-//Wellous//Wellness Fest 2026//EN', 'VERSION:2.0', 'CALSCALE:GREGORIAN', 'METHOD:' + e.method,
    'BEGIN:VEVENT',
    'UID:' + e.uid,
    'DTSTAMP:' + fmt(new Date()),
    'DTSTART:' + fmt(e.start),
    'DTEND:' + fmt(e.end),
    'SUMMARY:' + txt(e.summary),
    'DESCRIPTION:' + txt(e.description),
    'LOCATION:' + txt(e.location),
    'ORGANIZER;CN=Make Health Easier Wellness Fest:mailto:' + e.organiser,
    'ATTENDEE;CN=' + txt(e.attendeeName || e.attendee) + ';ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:' + e.attendee,
    'STATUS:' + e.status, 'SEQUENCE:' + e.sequence
  ];
  if (e.method === 'REQUEST') {
    lines.push('BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', 'DESCRIPTION:Your Wellness Fest workshop starts in 1 hour', 'END:VALARM');
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

/** Same id for the booking and its cancellation, so the calendar event gets removed. */
function eventUid_(workshopId, contactNumber) {
  return 'wwf-' + workshopId + '-' + phoneKey(contactNumber) + '@wellnessfest';
}

function googleCalendarLink_(w, start, end, phone) {
  function fmt(d) { return Utilities.formatDate(d, 'UTC', "yyyyMMdd'T'HHmmss'Z'"); }
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    '&text=' + encodeURIComponent(w.name + ' \u00B7 Wellness Fest 2026') +
    '&dates=' + fmt(start) + '/' + fmt(end) +
    '&location=' + encodeURIComponent(VENUE) +
    '&details=' + encodeURIComponent('To enter, give the phone number you used to reserve this slot: ' + phone);
}

// ====================================================================
//  Helpers
// ====================================================================

function toUtc_(date, time) { return new Date(date + 'T' + time + ':00+08:00'); }
function formatDay_(date) { return Utilities.formatDate(toUtc_(date, '12:00'), 'Asia/Kuala_Lumpur', 'EEEE, d MMMM yyyy'); }
function dayLabel_(date) { return (date === '2026-10-24' ? 'Day 1' : 'Day 2') + ', ' + Utilities.formatDate(toUtc_(date, '12:00'), 'Asia/Kuala_Lumpur', 'EEE d MMM'); }
function formatTime_(time) { return Utilities.formatDate(toUtc_('2026-10-24', time), 'Asia/Kuala_Lumpur', 'h:mm a'); }
/** Phone as the guest typed it, with the leading 0 Sheets may have dropped. */
function displayPhone_(raw) { var k = phoneKey(raw); return k ? '0' + k : String(raw || ''); }
function esc_(s) { return String(s || '').replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

// ====================================================================
//  Tests: run from the editor to preview the emails in your own inbox
// ====================================================================

function testWorkshopEmail() {
  var w = WORKSHOPS.workshop2, me = Session.getEffectiveUser().getEmail();
  var start = toUtc_(w.date, w.start), end = toUtc_(w.date, w.end);
  var body = '<p style="margin:0 0 18px;font-size:15px;">Hi Test Guest, you\'re booked in:</p>' + detailsTable_(w) +
    '<p style="margin:20px 0 12px;font-size:14px;color:' + MUTED + ';">' + button_(googleCalendarLink_(w, start, end, '0123456789'), 'Add to Google Calendar') + '</p>' +
    moreWorkshops_('0000000000', 'BOTH', 'Make a day of it: more workshops you can join');
  MailApp.sendEmail({
    to: me, subject: '[TEST] You\'re in: ' + w.name,
    htmlBody: shell_('Your workshop slot is reserved', body),
    body: 'Test confirmation email',
    attachments: [Utilities.newBlob(buildIcs_({ method: 'REQUEST', status: 'CONFIRMED', sequence: 0, uid: 'wwf-test@wellnessfest',
      start: start, end: end, organiser: me, attendee: me, summary: w.name + ' \u00B7 Wellness Fest 2026', description: 'Test invite', location: VENUE }),
      'text/calendar; charset=UTF-8; method=REQUEST', 'invite.ics')]
  });
}

function testCancellationEmail() {
  var w = WORKSHOPS.workshop2, me = Session.getEffectiveUser().getEmail();
  var body = '<p style="margin:0 0 18px;font-size:15px;">Hi Test Guest, your reservation has been cancelled:</p>' + detailsTable_(w) +
    moreWorkshops_('0000000000', 'BOTH', 'Still keen? These workshops have spots for you');
  MailApp.sendEmail({ to: me, subject: '[TEST] Cancelled: ' + w.name, htmlBody: shell_('Your workshop reservation is cancelled', body, BLUE), body: 'Test cancellation email' });
}

function testPassEmail() {
  var me = Session.getEffectiveUser().getEmail();
  // A fake reference each run, so the "send once" guard doesn't block repeat tests.
  sendPassConfirmation({ regId: 'WWF_BOTH_0123456789_TEST' + new Date().getTime() % 100000, email: me,
    fullName: 'Test Guest', amount: '5000', currency: 'myr' });
}

/** Run from the editor to see the free Explorer Pass email in your own inbox. */
function testExplorerEmail() {
  var me = Session.getEffectiveUser().getEmail();
  sendExplorerConfirmation({ regId: 'WWF_EXP_0123456789_TEST' + new Date().getTime() % 100000, email: me,
    fullName: 'Test Guest', contactNumber: '0123456789' });
}

/**
 * Run ONCE from the editor after pasting this file. Makes the "Workshops" sheet
 * match the WORKSHOPS list above: adds new workshops, updates names/days/times/
 * capacities, keeps each workshop's current Booked count, and removes workshops
 * that are no longer offered. Existing rows in "Bookings" are left untouched.
 */
function syncWorkshops() {
  var sheet = getWorkshopSheet();
  var data = sheet.getDataRange().getValues();
  var booked = {};
  for (var i = 1; i < data.length; i++) booked[data[i][0]] = Number(data[i][5]) || 0;
  var removed = Object.keys(booked).filter(function (id) { return !WORKSHOPS[id]; });
  var rows = Object.keys(WORKSHOPS).map(function (id) {
    var w = WORKSHOPS[id];
    return [id, w.name, w.date === '2026-10-24' ? 'Day 1' : 'Day 2',
      formatTime_(w.start) + ' - ' + formatTime_(w.end), w.capacity, booked[id] || 0];
  });
  if (data.length > 1) sheet.getRange(2, 1, data.length - 1, 6).clearContent();
  sheet.getRange(2, 1, rows.length, 6).setValues(rows);
  if (data.length - 1 > rows.length) sheet.deleteRows(rows.length + 2, data.length - 1 - rows.length);
  clearSlotsCache_();
  console.log('Workshops synced: ' + rows.length + ' workshops. Removed: ' + (removed.join(', ') || 'none'));
}

/** Run from the editor to see the wait list "you're in" email in your own inbox. */
function testWaitlistEmail() {
  var me = Session.getEffectiveUser().getEmail();
  sendWorkshopConfirmation({
    workshopId: 'd1-zumba', fullName: 'Test Guest', contactNumber: '0123456789',
    email: me, pass: 'BOTH', promoted: true
  });
}
