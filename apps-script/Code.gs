function doGet(e) {
  if (e.parameter.action === 'getSlots') {
    return getSlotsResponse();
  }
  return ContentService.createTextOutput('This endpoint only accepts POST requests from the registration form.');
}

function doPost(e) {
  if (e.parameter.action === 'bookSlot') {
    return bookSlot(e);
  }
  if (e.parameter.action === 'cancelSlot') {
    return cancelSlot(e);
  }
  if (e.parameter.action === 'cancelSlotByContact') {
    return cancelSlotByContact(e);
  }
  if (e.parameter.action === 'getBookingsByContact') {
    return getBookingsByContact(e);
  }
  if (e.parameter.action === 'markPaid') {
    return markPaid(e);
  }
  if (e.parameter.action === 'checkPhone') {
    return checkPhone(e);
  }
  if (e.parameter.action === 'joinWaitlist') {
    return joinWaitlist(e);
  }
  return handleRegistration(e);
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Phone numbers are compared by digits only, and a missing leading 0 or 60 is ignored.
// Sheets stores "0123456789" as the number 123456789, so a plain text compare misses it.
function phoneKey(raw) {
  var d = String(raw || '').replace(/\D/g, '');
  if (d.indexOf('60') === 0) d = d.slice(2);
  return d.replace(/^0+/, '');
}
function samePhone(a, b) {
  var ka = phoneKey(a);
  return ka !== '' && ka === phoneKey(b);
}
// Written with a leading apostrophe so Sheets keeps it as text (and keeps the 0).
function phoneCell(raw) {
  var s = String(raw || '').trim();
  return s ? "'" + s : '';
}

function handleRegistration(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Registrations');
  if (!sheet) {
    sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet('Registrations');
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Timestamp', 'Full Name', 'Gender', 'Contact Number', 'Referrer ID', 'Products', 'Attendance', 'Reg ID', 'Paid', 'Paid At', 'Email']);
  }

  var p = e.parameter;
  var productsArray = (e.parameters && e.parameters.products) ? e.parameters.products : [];
  // Free Wellness Explorer Pass: no Stripe checkout, so the form sends the guest's email itself.
  var isExplorer = p.attendance === 'Explorer';
  var email = isExplorer ? String(p.email || '').trim() : '';

  // "Go back to change my details": the guest edited their form before paying. Overwrite their
  // earlier, still-unpaid row (it may have a different pass or phone) instead of adding a second one.
  var replaces = (p.replacesRegId || '').toString().trim();
  if (replaces && sheet.getLastRow() > 1) {
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 10).getValues();
    for (var x = 0; x < rows.length; x++) {
      if ((rows[x][7] || '').toString().trim() === replaces && String(rows[x][8] || '').toLowerCase() !== 'yes') {
        sheet.getRange(x + 2, 1, 1, 10).setValues([[new Date(), p.fullName || '', p.gender || '', phoneCell(p.contactNumber),
          p.referrerId || '', productsArray.join(', '), p.attendance || '', (p.regId || '').toString().trim(), 'No', '']]);
        if (email) sheet.getRange(x + 2, 11).setValue(email);
        explorerEmail_(isExplorer, email, p);
        return jsonOut({ result: 'success', replaced: true });
      }
    }
  }

  // The Stripe webhook may have created this row already (if this form post was delayed or
  // failed the first time during a rush). Fill in the details instead of adding a duplicate.
  var regId = (p.regId || '').toString().trim();
  if (regId && sheet.getLastRow() > 1) {
    var ids = sheet.getRange(2, 8, sheet.getLastRow() - 1, 1).getValues();
    for (var r = 0; r < ids.length; r++) {
      if ((ids[r][0] || '').toString().trim() === regId) {
        sheet.getRange(r + 2, 2, 1, 6).setValues([[p.fullName || '', p.gender || '', phoneCell(p.contactNumber),
          p.referrerId || '', productsArray.join(', '), p.attendance || '']]);
        return jsonOut({ result: 'success' });
      }
    }
  }

  sheet.appendRow([
    new Date(),
    p.fullName || '',
    p.gender || '',
    phoneCell(p.contactNumber),
    p.referrerId || '',
    productsArray.join(', '),
    p.attendance || '',
    p.regId || '',
    'No',
    '',
    email
  ]);
  explorerEmail_(isExplorer, email, p);

  return jsonOut({ result: 'success' });
}

/** Free Explorer Pass: send the "your free pass is confirmed" email (WorkshopEmail.gs). Never throws. */
function explorerEmail_(isExplorer, email, p) {
  if (!isExplorer || !email) return;
  sendExplorerConfirmation({
    regId: (p.regId || '').toString().trim(),
    email: email,
    fullName: p.fullName,
    contactNumber: p.contactNumber
  });
}

function getWorkshopSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Workshops');
  if (!sheet) {
    sheet = ss.insertSheet('Workshops');
    sheet.appendRow(['ID', 'Name', 'Day', 'Time', 'Capacity', 'Booked']);
    var seed = [
      ['workshop1', 'IMMORITY x HYROX Fitness Activation', 'Day 1', '9:00 AM - 10:00 AM', 50, 0],
      ['workshop2', 'Tefal x Healthy Cooking Workshop', 'Day 1', '11:00 AM - 12:00 PM', 50, 0],
      ['workshop3', 'Joint Health & Healthy Ageing Talks', 'Day 1', '1:00 PM - 2:00 PM', 50, 0],
      ['workshop4', 'Korea x Jung Kwan Jang Wellness Showcase', 'Day 2', '3:00 PM - 4:00 PM', 50, 0],
      ['workshop5', 'Family Airway & Immunity Health Talk', 'Day 2', '5:00 PM - 6:00 PM', 50, 0],
      ['workshop6', 'DIY Creative Tent - Parents & Kids', 'Day 2', '7:00 PM - 8:00 PM', 50, 0]
    ];
    seed.forEach(function(row){ sheet.appendRow(row); });
  }
  return sheet;
}

function getBookingsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Bookings');
  if (!sheet) {
    sheet = ss.insertSheet('Bookings');
    sheet.appendRow(['Timestamp', 'Workshop ID', 'Workshop Name', 'Full Name', 'Contact Number', 'Token', 'Status']);
  }
  return sheet;
}

// Slot counts are cached for a few seconds so a crowd of visitors loading the page at once
// doesn't hit the spreadsheet for every single view (Google limits simultaneous sheet access).
// Any booking, cancellation or sync clears the cache, so counts are never more than ~5s old.
function clearSlotsCache_() {
  try { CacheService.getScriptCache().remove('slots'); } catch (err) {}
}

// Script property LOAD_TEST = true turns on load-test mode, for a COPY of the sheet only:
// bookings skip the Stripe payment check and no emails are sent. Never set it on the live copy.
function isLoadTest_() {
  return PropertiesService.getScriptProperties().getProperty('LOAD_TEST') === 'true';
}

function getSlotsResponse() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('slots');
  if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
  var sheet = getWorkshopSheet();
  var data = sheet.getDataRange().getValues();
  var slots = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    slots.push({
      id: row[0],
      name: row[1],
      day: row[2],
      time: row[3],
      capacity: row[4],
      booked: row[5],
      available: row[4] - row[5]
    });
  }
  var out = JSON.stringify({ slots: slots });
  try { cache.put('slots', out, 5); } catch (err) {}
  return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
}

function bookSlot(e) {
  var p = e.parameter;
  var workshopId = p.workshopId;

  // 1) Confirm the pass is really paid (and get the payer's email) BEFORE taking the
  //    lock, so a slow Stripe check never holds up other people's bookings.
  var pass = isLoadTest_() ? null : checkPass_(p.sessionId, p.contactNumber);
  if (pass && !pass.paid) {
    return jsonOut({ result: 'unpaid', message: 'We could not confirm a paid pass for this booking. Please refresh the page and try again.' });
  }
  if (pass && !passCoversWorkshop_(pass.pass, workshopId)) {
    // This device may still remember the 1-Day Pass after a top-up / second-day purchase
    // made elsewhere: look the phone number up before refusing.
    var byPhone = checkPass_(null, p.contactNumber);
    if (byPhone && byPhone.paid && passCoversWorkshop_(byPhone.pass, workshopId)) pass = byPhone;
    else return jsonOut({ result: 'error', message: 'This workshop is not included in your pass.' });
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (err) {
    return jsonOut({ result: 'error', message: 'Server busy, please try again.' });
  }

  var response, isNewBooking = false;
  try {
    var bookingsSheet = getBookingsSheet();
    var bookingsData = bookingsSheet.getDataRange().getValues();

    // 2) Same phone + same workshop already booked: hand back that booking instead of
    //    taking a second spot (e.g. they booked on another phone/browser before).
    for (var b = 1; b < bookingsData.length; b++) {
      if (bookingsData[b][1] === workshopId && bookingsData[b][6] === 'Active' && samePhone(bookingsData[b][4], p.contactNumber)) {
        response = { result: 'success', remaining: null, token: bookingsData[b][5], alreadyBooked: true };
        break;
      }
    }

    // 3) No two bookings whose times overlap on the same day.
    if (!response) {
      var other = clashingActiveBooking_(bookingsData, p.contactNumber, workshopId);
      if (other) response = { result: 'clash', message: clashMessage_(other) };
    }

    if (!response) {
      var sheet = getWorkshopSheet();
      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (data[i][0] === workshopId) {
          var capacity = data[i][4];
          var booked = data[i][5];

          if (booked >= capacity) {
            response = { result: 'full' };
            break;
          }

          sheet.getRange(i + 1, 6).setValue(booked + 1);

          var token = Utilities.getUuid();
          bookingsSheet.appendRow([
            new Date(),
            workshopId,
            data[i][1],
            p.fullName || '',
            phoneCell(p.contactNumber),
            token,
            'Active'
          ]);

          response = { result: 'success', remaining: capacity - booked - 1, token: token };
          isNewBooking = true;
          break;
        }
      }
    }
    if (!response) response = { result: 'error', message: 'Workshop not found.' };
  } finally {
    lock.releaseLock();
  }

  if (isNewBooking) clearSlotsCache_();
  // 3) Confirmation email + calendar invite, sent after the lock is released.
  if (isNewBooking && !isLoadTest_()) {
    sendWorkshopConfirmation({
      workshopId: workshopId,
      fullName: p.fullName,
      contactNumber: p.contactNumber,
      email: (pass && pass.email) || emailForPhone_(p.contactNumber),
      pass: pass && pass.pass
    });
  }
  return jsonOut(response);
}

function releaseWorkshopSlot(workshopId) {
  var workshopSheet = getWorkshopSheet();
  var workshopData = workshopSheet.getDataRange().getValues();
  for (var j = 1; j < workshopData.length; j++) {
    if (workshopData[j][0] === workshopId) {
      var newBooked = Math.max(0, workshopData[j][5] - 1);
      workshopSheet.getRange(j + 1, 6).setValue(newBooked);
      return workshopData[j][4] - newBooked;
    }
  }
  return null;
}

function cancelSlot(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (err) {
    return jsonOut({ result: 'error', message: 'Server busy, please try again.' });
  }

  var response, cancelled = null, promoted = null;
  try {
    var workshopId = e.parameter.workshopId;
    var token = e.parameter.token;

    var bookingsSheet = getBookingsSheet();
    var bookingsData = bookingsSheet.getDataRange().getValues();
    var foundRow = -1;

    for (var i = 1; i < bookingsData.length; i++) {
      if (bookingsData[i][1] === workshopId && bookingsData[i][5] === token && bookingsData[i][6] === 'Active') {
        foundRow = i;
        break;
      }
    }

    if (foundRow === -1) {
      response = { result: 'error', message: 'Booking not found or already cancelled.' };
    } else {
      bookingsSheet.getRange(foundRow + 1, 7).setValue('Cancelled');
      var remaining = releaseWorkshopSlot(workshopId);
      if (remaining === null) {
        response = { result: 'error', message: 'Workshop not found.' };
      } else {
        cancelled = { workshopId: workshopId, fullName: bookingsData[foundRow][3], contactNumber: bookingsData[foundRow][4] };
        promoted = promoteFromWaitlist_(workshopId);
        response = { result: 'success', remaining: promoted ? remaining - 1 : remaining };
      }
    }
  } finally {
    lock.releaseLock();
  }

  if (cancelled) clearSlotsCache_();
  if (cancelled && !isLoadTest_()) sendCancellationEmail(cancelled);
  if (promoted && !isLoadTest_()) sendWaitlistPromotion(promoted);
  return jsonOut(response);
}

function cancelSlotByContact(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (err) {
    return jsonOut({ result: 'error', message: 'Server busy, please try again.' });
  }

  var response, cancelled = null, promoted = null;
  try {
    var workshopId = e.parameter.workshopId;
    var contactNumber = (e.parameter.contactNumber || '').toString().trim();

    if (!workshopId || !contactNumber) {
      response = { result: 'error', message: 'Please provide both a workshop and phone number.' };
    } else {
      var bookingsSheet = getBookingsSheet();
      var bookingsData = bookingsSheet.getDataRange().getValues();
      var foundRow = -1;

      for (var i = 1; i < bookingsData.length; i++) {
        if (bookingsData[i][1] === workshopId && samePhone(bookingsData[i][4], contactNumber) && bookingsData[i][6] === 'Active') {
          foundRow = i;
          break;
        }
      }

      if (foundRow === -1) {
        response = { result: 'error', message: 'No active reservation found for that phone number and workshop.' };
      } else {
        bookingsSheet.getRange(foundRow + 1, 7).setValue('Cancelled');
        var remaining = releaseWorkshopSlot(workshopId);
        if (remaining === null) {
          response = { result: 'error', message: 'Workshop not found.' };
        } else {
          cancelled = { workshopId: workshopId, fullName: bookingsData[foundRow][3], contactNumber: contactNumber };
          promoted = promoteFromWaitlist_(workshopId);
          response = { result: 'success', remaining: promoted ? remaining - 1 : remaining };
        }
      }
    }
  } finally {
    lock.releaseLock();
  }

  if (cancelled) clearSlotsCache_();
  if (cancelled && !isLoadTest_()) sendCancellationEmail(cancelled);
  if (promoted && !isLoadTest_()) sendWaitlistPromotion(promoted);
  return jsonOut(response);
}

function getBookingsByContact(e) {
  var contactNumber = (e.parameter.contactNumber || '').toString().trim();
  if (!contactNumber) {
    return jsonOut({ result: 'error', message: 'Please provide a phone number.' });
  }

  var bookingsSheet = getBookingsSheet();
  var bookingsData = bookingsSheet.getDataRange().getValues();
  var workshopSheet = getWorkshopSheet();
  var workshopData = workshopSheet.getDataRange().getValues();

  var workshopMap = {};
  for (var w = 1; w < workshopData.length; w++) {
    workshopMap[workshopData[w][0]] = {
      name: workshopData[w][1],
      day: workshopData[w][2],
      time: workshopData[w][3]
    };
  }

  var bookings = [];
  for (var i = 1; i < bookingsData.length; i++) {
    if (samePhone(bookingsData[i][4], contactNumber) && bookingsData[i][6] === 'Active') {
      var workshopId = bookingsData[i][1];
      var info = workshopMap[workshopId] || {};
      bookings.push({
        workshopId: workshopId,
        workshopName: info.name || bookingsData[i][2],
        day: info.day || '',
        time: info.time || '',
        token: bookingsData[i][5]
      });
    }
  }

  return jsonOut({ result: 'success', bookings: bookings, waitlist: waitlistForPhone_(contactNumber) });
}

function markPaid(e) {
  var expected = PropertiesService.getScriptProperties().getProperty('MARK_PAID_SECRET');
  if (!expected || e.parameter.secret !== expected) {
    return jsonOut({ result: 'error', message: 'Unauthorized.' });
  }
  var p = e.parameter;
  var regId = (p.regId || '').toString().trim();
  if (!regId) {
    return jsonOut({ result: 'error', message: 'Missing regId.' });
  }

  var response = { result: 'error', message: 'No registration found for that regId.' };
  var fullName = '';
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Registrations');

  // RM15 top-up from a 1-Day Pass to both days: mark their paid registration as
  // upgraded and log the top-up as its own row (same phone, buyer email in column K).
  var up = /^WWF_UPG_(\d+)_/.exec(regId);
  if (up && sheet) {
    var rows = sheet.getDataRange().getValues();
    var already = false;
    for (var u = 1; u < rows.length; u++) if ((rows[u][7] || '').toString().trim() === regId) already = true;
    if (!already) {
      for (var k = rows.length - 1; k >= 1; k--) {
        if (samePhone(rows[k][3], up[1]) && String(rows[k][8] || '').toLowerCase() === 'yes' && !/^WWF_UPG_/.test(rows[k][7] || '')) {
          sheet.getRange(k + 1, 7).setValue('Both days (upgraded)');
          fullName = rows[k][1] || '';
          break;
        }
      }
      sheet.appendRow([new Date(), fullName || p.name || '', '', phoneCell(up[1]), '', '(RM15 top-up)', 'Upgrade to Both days', regId, 'Yes', new Date(), p.email || '']);
    }
    try { PropertiesService.getScriptProperties().setProperty('zz_last_payment', new Date().toISOString() + ' | markPaid ' + regId + ': top-up to both days, buyer email ' + (p.email ? 'received' : 'MISSING')); } catch (err) {}
    sendPassConfirmation({ regId: regId, email: p.email, fullName: fullName || p.name, amount: p.amount, currency: p.currency });
    return jsonOut({ result: 'success', upgraded: true });
  }

  if (sheet) {
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if ((data[i][7] || '').toString().trim() === regId) {
        sheet.getRange(i + 1, 9).setValue('Yes');
        sheet.getRange(i + 1, 10).setValue(new Date());
        if (p.email) sheet.getRange(i + 1, 11).setValue(p.email); // buyer email, for workshop emails later
        fullName = data[i][1] || '';
        response = { result: 'success' };
        break;
      }
    }
  }
  try {
    var regSh = sheet || SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Registrations');
    if (regSh && !regSh.getRange(1, 11).getValue()) regSh.getRange(1, 11).setValue('Email');
  } catch (err) {}
  if (response.result !== 'success') {
    // The registration form post never reached the sheet (e.g. Google was overloaded at that
    // moment). Stripe is the source of truth, so record the paid pass from the payment itself.
    var m = /^WWF_(D1|D2|BOTH)_(\d+)_/.exec(regId);
    var regSheet = sheet || SpreadsheetApp.getActiveSpreadsheet().insertSheet('Registrations');
    if (regSheet.getLastRow() === 0) {
      regSheet.appendRow(['Timestamp', 'Full Name', 'Gender', 'Contact Number', 'Referrer ID', 'Products', 'Attendance', 'Reg ID', 'Paid', 'Paid At']);
    }
    regSheet.appendRow([new Date(), p.name || '', '', m ? phoneCell(m[2]) : '', '', '(added from payment)',
      m ? ({ D1: 'Day 1', D2: 'Day 2', BOTH: 'Both days' })[m[1]] : '', regId, 'Yes', new Date(), p.email || '']);
    fullName = p.name || '';
    response = { result: 'success', added: true };
  }

  // "Your pass is confirmed" email. Sent even if the registration row hasn't
  // landed yet (Stripe can be faster than the form), and only once per payment
  // even when Stripe retries the webhook.
  var markNote = 'markPaid ' + regId + ': row ' + (response.added ? 'added from payment' : 'marked Paid') +
    ', buyer email ' + (p.email ? 'received' : 'MISSING');
  console.log(markNote);
  // Status note you can read in Project Settings > Script properties (web-app logs aren't always shown).
  try { PropertiesService.getScriptProperties().setProperty('zz_last_payment', new Date().toISOString() + ' | ' + markNote); } catch (err) {}
  sendPassConfirmation({
    regId: regId,
    email: p.email,
    fullName: fullName || p.name,
    amount: p.amount,
    currency: p.currency
  });

  return jsonOut(response);
}

// Registration form: is this phone number already registered? If so, say whether it
// has paid, and hand back the reference so an unpaid guest can finish checkout.
function checkPhone(e) {
  var phone = (e.parameter.contactNumber || '').toString().trim();
  if (!phoneKey(phone)) {
    return jsonOut({ result: 'error', message: 'Please provide a phone number.' });
  }
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Registrations');
  if (!sheet) return jsonOut({ result: 'success', registered: false });
  var data = sheet.getDataRange().getValues();
  var found = null, paidPasses = [], unpaidRegId = '';
  for (var i = 1; i < data.length; i++) {
    if (!samePhone(data[i][3], phone)) continue;
    var paid = String(data[i][8] || '').toLowerCase() === 'yes';
    var att = String(data[i][6] || '');
    if (paid) {
      // 'Both days (upgraded)' etc. still count as both days
      var label = /both/i.test(att) ? 'Both days' : att;
      if (label && paidPasses.indexOf(label) === -1) paidPasses.push(label);
    } else {
      unpaidRegId = String(data[i][7] || ''); // most recent unpaid attempt
    }
    // prefer a paid registration; otherwise keep the most recent one
    if (!found || paid || !found.paid) {
      if (!(found && found.paid && !paid)) found = { paid: paid, regId: String(data[i][7] || ''), attendance: att };
    }
  }
  if (!found) return jsonOut({ result: 'success', registered: false });
  return jsonOut({ result: 'success', registered: true, paid: paidPasses.length > 0, regId: found.regId,
    attendance: found.attendance, paidPasses: paidPasses, unpaidRegId: unpaidRegId });
}

// ====================================================================
//  Wait list: fully booked workshops. First come, first served; when a
//  booking is cancelled the next person waiting gets the slot automatically.
// ====================================================================

function getWaitlistSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Waitlist');
  if (!sheet) {
    sheet = ss.insertSheet('Waitlist');
    sheet.appendRow(['Timestamp', 'Workshop ID', 'Workshop Name', 'Full Name', 'Contact Number', 'Status', 'Updated At']);
  }
  return sheet;
}

function joinWaitlist(e) {
  var p = e.parameter;
  var workshopId = p.workshopId;
  if (!workshopId || !phoneKey(p.contactNumber)) {
    return jsonOut({ result: 'error', message: 'Missing workshop or phone number.' });
  }
  var pass = isLoadTest_() ? null : checkPass_(p.sessionId, p.contactNumber);
  if (pass && !pass.paid) {
    return jsonOut({ result: 'unpaid', message: 'You must make your payment first before joining the wait list.' });
  }
  if (pass && !passCoversWorkshop_(pass.pass, workshopId)) {
    return jsonOut({ result: 'error', message: 'This workshop is not included in your pass.' });
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (err) {
    return jsonOut({ result: 'error', message: 'Server busy, please try again.' });
  }
  try {
    var wData = getWorkshopSheet().getDataRange().getValues();
    var row = null;
    for (var i = 1; i < wData.length; i++) if (wData[i][0] === workshopId) { row = wData[i]; break; }
    if (!row) return jsonOut({ result: 'error', message: 'Workshop not found.' });
    if (Number(row[5]) < Number(row[4])) return jsonOut({ result: 'available' }); // a spot is free: book it instead

    var bData = getBookingsSheet().getDataRange().getValues();
    for (var b = 1; b < bData.length; b++) {
      if (bData[b][1] === workshopId && bData[b][6] === 'Active' && samePhone(bData[b][4], p.contactNumber)) {
        return jsonOut({ result: 'error', message: 'You already have a slot for this workshop.' });
      }
    }
    var clashWith = clashingActiveBooking_(bData, p.contactNumber, workshopId);
    if (clashWith) return jsonOut({ result: 'clash', message: clashMessage_(clashWith) });

    var sheet = getWaitlistSheet();
    var data = sheet.getDataRange().getValues();
    var position = 0;
    for (var k = 1; k < data.length; k++) {
      if (data[k][1] !== workshopId || data[k][5] !== 'Waiting') continue;
      position++;
      if (samePhone(data[k][4], p.contactNumber)) return jsonOut({ result: 'success', position: position, already: true });
    }
    sheet.appendRow([new Date(), workshopId, row[1], p.fullName || '', phoneCell(p.contactNumber), 'Waiting', '']);
    return jsonOut({ result: 'success', position: position + 1 });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Call INSIDE the script lock, right after a slot is released. Gives the slot to the
 * first person still waiting (skipping anyone who already holds a slot) and returns
 * them as { workshopId, fullName, contactNumber }, or null if nobody is waiting.
 */
function promoteFromWaitlist_(workshopId) {
  var sheet = getWaitlistSheet();
  var data = sheet.getDataRange().getValues();
  var bookingsSheet = getBookingsSheet();
  var bData = bookingsSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][1] !== workshopId || data[i][5] !== 'Waiting') continue;
    var phone = data[i][4];
    var alreadyIn = false;
    for (var b = 1; b < bData.length; b++) {
      if (bData[b][1] === workshopId && bData[b][6] === 'Active' && samePhone(bData[b][4], phone)) { alreadyIn = true; break; }
    }
    if (alreadyIn) {
      sheet.getRange(i + 1, 6, 1, 2).setValues([['Skipped (already booked)', new Date()]]);
      continue;
    }
    if (clashingActiveBooking_(bData, phone, workshopId)) {
      sheet.getRange(i + 1, 6, 1, 2).setValues([['Skipped (time clash)', new Date()]]);
      continue;
    }
    // take the freed slot
    var wSheet = getWorkshopSheet();
    var wData = wSheet.getDataRange().getValues();
    for (var w = 1; w < wData.length; w++) {
      if (wData[w][0] !== workshopId) continue;
      if (Number(wData[w][5]) >= Number(wData[w][4])) return null; // no room after all
      wSheet.getRange(w + 1, 6).setValue(Number(wData[w][5]) + 1);
      bookingsSheet.appendRow([new Date(), workshopId, wData[w][1], data[i][3] || '', phoneCell(displayPhone_(phone)), Utilities.getUuid(), 'Active']);
      sheet.getRange(i + 1, 6, 1, 2).setValues([['Promoted', new Date()]]);
      return { workshopId: workshopId, fullName: data[i][3], contactNumber: displayPhone_(phone) };
    }
    return null;
  }
  return null;
}

/** [{ workshopId, position }] for everything this phone is still waiting for. */
function waitlistForPhone_(phone) {
  var data = getWaitlistSheet().getDataRange().getValues();
  var counts = {}, mine = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][5] !== 'Waiting') continue;
    var id = data[i][1];
    counts[id] = (counts[id] || 0) + 1;
    if (samePhone(data[i][4], phone)) mine.push({ workshopId: id, position: counts[id] });
  }
  return mine;
}

/** Run from the editor: how many more emails this account can send today. */
function checkEmailQuota() {
  console.log('Emails left today: ' + MailApp.getRemainingDailyQuota() + ' (account: ' + Session.getEffectiveUser().getEmail() + ')');
}

// ---------- Time clashes ----------
// Two workshops clash when they're on the same day and their times overlap
// ('HH:MM' strings compare correctly as text). Uses the WORKSHOPS list in WorkshopEmail.gs.
function clashes_(a, b) {
  var wa = WORKSHOPS[a], wb = WORKSHOPS[b];
  if (!wa || !wb || a === b || wa.date !== wb.date) return false;
  return wa.start < wb.end && wb.start < wa.end;
}

/** The ID of an Active booking for this phone that overlaps workshopId, or null. */
function clashingActiveBooking_(bookingsData, phone, workshopId) {
  for (var b = 1; b < bookingsData.length; b++) {
    if (bookingsData[b][6] === 'Active' && samePhone(bookingsData[b][4], phone) && clashes_(bookingsData[b][1], workshopId)) {
      return bookingsData[b][1];
    }
  }
  return null;
}

function clashMessage_(otherId) {
  var w = WORKSHOPS[otherId];
  return 'Oops, time clash! This overlaps with ' + w.name + ' (' + formatTime_(w.start) + ' - ' + formatTime_(w.end) +
    '), which you have already booked. To join this one instead, cancel that booking first.';
}

/**
 * The buyer's email saved with their payment (Registrations column K, written by markPaid),
 * for the most recent PAID registration of this phone number. '' if none.
 */
function emailForPhone_(phone) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Registrations');
    if (!sheet || sheet.getLastRow() < 2) return '';
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 11).getValues();
    for (var i = rows.length - 1; i >= 0; i--) {
      if (samePhone(rows[i][3], phone) && String(rows[i][8] || '').toLowerCase() === 'yes' && rows[i][10]) return String(rows[i][10]).trim();
    }
  } catch (err) {
    console.error('emailForPhone_ failed: ' + err);
  }
  return '';
}
