// Wellfam member lookup — a small, separate Apps Script web app that answers one question for the
// website: "is this phone number a Wellfam member?" The list stays in a private Google Sheet; the
// website only ever gets back true or false, and only when it sends the shared secret.
//
// Setup (once):
//   1. Create a new Google Sheet, e.g. "Wellfam Members" (keep it private; don't share it publicly).
//      Put the phone numbers in column A of the first tab. Any format works (012-345 6789,
//      +60123456789, 60123456789, 123456789) and a header row is fine. Other columns are ignored.
//   2. In that sheet: Extensions → Apps Script, replace the code with this file and save.
//   3. Project Settings → Script Properties → add WELLFAM_SECRET with a long random value.
//   4. Deploy → New deployment → Web app. Execute as: Me. Who has access: Anyone. Deploy and copy
//      the /exec URL.
//   5. In Vercel → Project → Settings → Environment Variables add WELLFAM_LOOKUP_URL (the /exec URL)
//      and WELLFAM_SECRET (the same value as step 3), then redeploy the site.
//
// Updating the list later: just edit column A. No redeploy needed; changes count within 5 minutes.

var WELLFAM_CACHE_SECONDS = 300;

function doGet(e) {
  var p = (e && e.parameter) || {};
  var secret = PropertiesService.getScriptProperties().getProperty('WELLFAM_SECRET');
  if (!secret || p.secret !== secret) return json_({ error: 'unauthorised' });
  var phone = phoneKey_(p.phone);
  if (phone.length < 9 || phone.length > 12) return json_({ member: false });

  var cache = CacheService.getScriptCache();
  var hit = cache.get('wf_' + phone);
  if (hit !== null) return json_({ member: hit === '1' });

  var member = memberSet_()[phone] === true;
  cache.put('wf_' + phone, member ? '1' : '0', WELLFAM_CACHE_SECONDS);
  return json_({ member: member });
}

function memberSet_() {
  var sheet = SpreadsheetApp.getActive().getSheets()[0];
  var last = sheet.getLastRow();
  var set = {};
  if (last < 1) return set;
  sheet.getRange(1, 1, last, 1).getValues().forEach(function (row) {
    var k = phoneKey_(row[0]);
    if (k.length >= 9) set[k] = true;
  });
  return set;
}

// Same shape the website uses everywhere: 0123456789
function phoneKey_(raw) {
  var d = String(raw || '').replace(/\D/g, '');
  if (d.indexOf('60') === 0) d = d.slice(1);
  if (d && d.charAt(0) !== '0') d = '0' + d;
  return d;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Run from the editor to check the list reads correctly (logs how many numbers it found).
function testWellfamList() {
  Logger.log(Object.keys(memberSet_()).length + ' Wellfam numbers found');
}
