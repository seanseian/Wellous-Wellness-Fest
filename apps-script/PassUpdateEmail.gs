// ====================================================================
//  One-off "what's changed" email to everyone who already secured a pass
// ====================================================================
//
// Add this as a new script file (+ > Script, name it PassUpdateEmail) next to Code.gs and
// WorkshopEmail.gs. It uses their helpers (shell_, button_, experienceIncludes_, ...).
//
//   1. countPassUpdateRecipients()  dry run: logs how many of each email would go out
//   2. previewPassUpdateEmails()    sends both versions to your own inbox
//   3. sendPassUpdateEmails()       sends for real, once per pass holder
//
// Who gets what (paid rows in Registrations, registered before the new passes went live):
//   - 1-Day Pass holders (Day 1 or Day 2 only): "your pass is now the Wellness Experience Pass"
//   - 2-Day / Experience Pass holders (incl. Day 1 + Day 2, or topped up): "what's changed"
// Free Explorer registrations are skipped. Each phone number gets one email, ever: re-running
// only sends to people who haven't had it yet. If the daily email quota or the 6-minute run
// limit is reached, it stops and schedules itself to carry on.

// Registrations made after this moment already saw the new passes, so they're left out.
var PASS_UPDATE_CUTOFF = new Date('2026-10-15T09:25:00Z'); // 5:25 PM Malaysia time, 15 Oct

/** The email for one pass holder. kind: 'upgrade' (1-Day holder) or 'experience'. */
function passUpdateContent_(kind, fullName, phone) {
  var name = String(fullName || '').trim() || 'there';
  var upgrade = kind === 'upgrade';
  var changed =
    '<div style="background:#F2FAEC;border-radius:12px;padding:16px 18px;margin-top:20px;">' +
      '<div style="font-size:16px;font-weight:bold;color:' + INK + ';margin-bottom:6px;">What\'s changed at the fest</div>' +
      '<ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.6;color:' + MUTED + ';">' +
        '<li><b style="color:' + INK + ';">Entry is now free for everyone</b> with the new Wellness Explorer Pass.</li>' +
        '<li><b style="color:' + INK + ';">The Wellous Trial Set and workshop booking</b> are now only for Wellness Experience Pass holders.</li>' +
        '<li><b style="color:' + INK + ';">You\'re a Wellness Experience Pass holder</b>, so you keep all of it.</li>' +
      '</ul>' +
    '</div>';
  var body =
    '<p style="margin:0 0 16px;font-size:15px;">Hi ' + esc_(name) + ',</p>' +
    (upgrade
      ? '<p style="margin:0 0 18px;font-size:15px;line-height:1.5;">Good news! We\'ve made some changes to Make Health Easier Wellness Fest 2026, and your <b>1-Day Pass has been upgraded to the Wellness Experience Pass</b> at no extra cost. You can now join us on <b>both days</b>, collect a <b>Wellous Trial Set</b> and <b>book workshops</b> on 24 and 25 October.</p>'
      : '<p style="margin:0 0 18px;font-size:15px;line-height:1.5;">Thank you for securing your <b>Wellness Experience Pass</b>! We\'ve made a few changes to Make Health Easier Wellness Fest 2026, and we wanted you to hear them from us first. Your pass gives you everything you signed up for, and more.</p>') +
    '<div style="text-align:center;margin:4px 0 20px;"><img src="' + TICKET_URLS.BOTH + '" width="320" alt="Wellness Experience Pass" style="display:inline-block;width:320px;max-width:90%;height:auto;border:0;"></div>' +
    changed +
    experienceIncludes_() +
    '<div style="background:#FFFDE8;border-radius:12px;padding:18px;margin-top:20px;">' +
      '<div style="font-size:16px;font-weight:bold;color:' + INK + ';">Reserve your workshop slots now</div>' +
      '<div style="font-size:14px;line-height:1.5;color:' + MUTED + ';margin:6px 0 14px;">Workshops and workout classes have limited spots and are first come, first served. ' +
        'Book as many as you like, as long as the times don\'t overlap. Use the phone number you registered with.</div>' +
      button_(SITE_URL, 'Book my workshops') +
    '</div>' +
    '<div style="border:2px dashed ' + GREEN + ';border-radius:12px;padding:16px 18px;margin-top:20px;">' +
      '<div style="font-weight:bold;font-size:15px;margin-bottom:6px;">At the entrance</div>' +
      '<div style="font-size:14px;line-height:1.5;color:' + MUTED + ';">Give the phone number you registered with to collect your pass and Wellous Trial Set:</div>' +
      '<div style="font-size:22px;font-weight:bold;letter-spacing:1px;margin-top:8px;color:' + GREEN + ';">' + esc_(displayPhone_(phone)) + '</div>' +
    '</div>' +
    '<p style="margin:20px 0 0;font-size:14px;line-height:1.5;color:' + MUTED + ';">Bringing friends or family? Entry is free for them. They can register here: ' +
      '<a href="' + REGISTER_URL + '" style="color:' + GREEN + ';font-weight:bold;">makehealtheasierfest.wellous.com</a></p>';

  var subject = upgrade
    ? 'Your 1-Day Pass is now the Wellness Experience Pass, at no extra cost'
    : 'An update on your Wellness Experience Pass for Make Health Easier Wellness Fest 2026';
  var text = 'Hi ' + name + ',\n\n' +
    (upgrade
      ? 'Good news! Your 1-Day Pass has been upgraded to the Wellness Experience Pass at no extra cost. You can now join us on both days (24 & 25 October), collect a Wellous Trial Set and book workshops.\n\n'
      : 'Thank you for securing your Wellness Experience Pass! Here is what has changed at the fest.\n\n') +
    'WHAT\'S CHANGED\n- Entry is now free for everyone with the new Wellness Explorer Pass.\n' +
    '- The Wellous Trial Set and workshop booking are now only for Wellness Experience Pass holders.\n' +
    '- You\'re a Wellness Experience Pass holder, so you keep all of it.\n\n' +
    'Reserve your workshop slots (limited spots, no daily limit as long as times don\'t overlap): ' + SITE_URL + '\n\n' +
    'At the entrance, give the phone number you registered with (' + displayPhone_(phone) + ') to collect your pass and Wellous Trial Set.\n\n' +
    'Bringing friends or family? Entry is free for them: ' + REGISTER_URL + '\n';
  return {
    subject: subject,
    html: shell_(upgrade ? 'Your pass just got an upgrade' : 'What\'s new for your pass', body),
    text: text
  };
}

/** Pass holders to email, one per phone number: [{ key, phone, name, email, kind }] */
function passUpdateRecipients_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Registrations');
  if (!sheet || sheet.getLastRow() < 2) return [];
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 11).getValues();
  var people = {}, order = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (String(r[8] || '').toLowerCase() !== 'yes') continue;            // paid only
    var att = String(r[6] || '').trim();
    if (att === 'Explorer') continue;                                     // free pass
    var when = r[0] instanceof Date ? r[0] : new Date(r[0]);
    if (!isNaN(when) && when >= PASS_UPDATE_CUTOFF) continue;             // registered after the change
    var key = phoneKey(r[3]);
    if (!key) continue;
    if (!people[key]) { people[key] = { key: key, phone: r[3], name: '', email: '', passes: [] }; order.push(key); }
    var p = people[key];
    p.passes.push(att);
    if (r[1] && !/^\(/.test(String(r[1]))) p.name = r[1];                  // skip "(RM15 top-up)" style rows
    if (r[10]) p.email = String(r[10]).trim();                            // latest email wins
  }
  return order.map(function (k) {
    var p = people[k], has = function (s) { return p.passes.indexOf(s) !== -1; };
    var twoDay = p.passes.some(function (a) { return /^Both days|^Upgrade to Both days/.test(a); }) || (has('Day 1') && has('Day 2'));
    return { key: k, phone: p.phone, name: p.name, email: p.email, kind: twoDay ? 'experience' : 'upgrade' };
  });
}

/** Dry run: how many emails of each kind would go out, and who has no email on file. */
function countPassUpdateRecipients() {
  var props = PropertiesService.getScriptProperties();
  var list = passUpdateRecipients_(), c = { upgrade: 0, experience: 0, noEmail: 0, alreadySent: 0 };
  list.forEach(function (p) {
    if (props.getProperty('passupdate_' + p.key)) c.alreadySent++;
    else if (!p.email) c.noEmail++;
    else c[p.kind]++;
  });
  var msg = 'Pass update email: ' + c.upgrade + ' x 1-Day upgrade, ' + c.experience + ' x Experience Pass, ' +
    c.noEmail + ' with no email on file, ' + c.alreadySent + ' already sent. Emails left today: ' + MailApp.getRemainingDailyQuota();
  console.log(msg);
  return msg;
}

/** Sends both versions to your own inbox. */
function previewPassUpdateEmails() {
  var me = Session.getEffectiveUser().getEmail();
  ['upgrade', 'experience'].forEach(function (kind) {
    var m = passUpdateContent_(kind, 'Test Guest', '0123456789');
    MailApp.sendEmail({ to: me, subject: '[PREVIEW] ' + m.subject, htmlBody: m.html, body: m.text, name: 'Make Health Easier Wellness Fest' });
  });
}

/** Sends the update to every pass holder who hasn't had it yet. Safe to run again. */
function sendPassUpdateEmails() {
  var props = PropertiesService.getScriptProperties();
  ScriptApp.getProjectTriggers().forEach(function (t) {                  // clear any scheduled continuation
    if (t.getHandlerFunction() === 'sendPassUpdateEmails') ScriptApp.deleteTrigger(t);
  });
  var started = Date.now(), sent = 0, failed = 0, more = false;
  var list = passUpdateRecipients_();
  for (var i = 0; i < list.length; i++) {
    var p = list[i], sentKey = 'passupdate_' + p.key;
    if (!p.email || props.getProperty(sentKey)) continue;
    if (MailApp.getRemainingDailyQuota() < 2 || Date.now() - started > 5 * 60 * 1000) { more = true; break; }
    try {
      var m = passUpdateContent_(p.kind, p.name, p.phone);
      MailApp.sendEmail({ to: p.email, subject: m.subject, htmlBody: m.html, body: m.text, name: 'Make Health Easier Wellness Fest' });
      props.setProperty(sentKey, new Date().toISOString() + ' ' + p.kind);
      sent++;
    } catch (err) {
      failed++;
      console.error('Pass update email failed for ' + p.email + ': ' + err);
    }
  }
  if (more) {
    // Out of quota (resets daily) or out of run time: carry on automatically.
    var quotaLeft = MailApp.getRemainingDailyQuota();
    ScriptApp.newTrigger('sendPassUpdateEmails').timeBased().after(quotaLeft < 2 ? 6 * 60 * 60 * 1000 : 60 * 1000).create();
  }
  var note = new Date().toISOString() + ' | pass update: sent ' + sent + ', failed ' + failed + (more ? ', more to send (scheduled)' : ', all done');
  props.setProperty('zz_pass_update', note);
  console.log(note);
  return note;
}
