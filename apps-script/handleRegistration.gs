// In Code.gs, replace the whole handleRegistration function (from "function handleRegistration(e) {"
// down to its closing "}", just above "function getWorkshopSheet()") with this version.
//
// What changed: a free Wellness Explorer Pass registration ("Explorer") now saves the guest's email
// in column K and gets the "your free pass is confirmed" email (sendExplorerConfirmation in
// WorkshopEmail.gs). Everything else works exactly as before.

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
  // Free pass: no Stripe checkout, so the form sends the guest's email itself.
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

/** Free Explorer Pass: send the "you're registered" email. Never throws. */
function explorerEmail_(isExplorer, email, p) {
  if (!isExplorer || !email) return;
  sendExplorerConfirmation({
    regId: (p.regId || '').toString().trim(),
    email: email,
    fullName: p.fullName,
    contactNumber: p.contactNumber
  });
}
