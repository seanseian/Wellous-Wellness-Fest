// Phone numbers for every country. Loaded by the page (<script src="/phone.js">) and required by
// the API functions, so the browser and the server agree on one format.
//
// Stored format ("canonical"), digits only so it fits the Stripe reference WWF_<PASS>_<phone>_<id>:
//   Malaysia        0 + national number   0123456789      (unchanged from before, so existing
//                                                          registrations still match)
//   Other countries country code + number 85264831263    (Hong Kong 6483 1263)
// The two never collide: a stored Malaysian number starts with 0, a country code never does.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WWPhone = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // ISO code | name | dial code. Countries sharing a code (+1, +7, +44 ...) are listed separately.
  var LIST = (
    'AF|Afghanistan|93,AL|Albania|355,DZ|Algeria|213,AS|American Samoa|1,AD|Andorra|376,AO|Angola|244,' +
    'AI|Anguilla|1,AG|Antigua and Barbuda|1,AR|Argentina|54,AM|Armenia|374,AW|Aruba|297,AU|Australia|61,' +
    'AT|Austria|43,AZ|Azerbaijan|994,BS|Bahamas|1,BH|Bahrain|973,BD|Bangladesh|880,BB|Barbados|1,' +
    'BY|Belarus|375,BE|Belgium|32,BZ|Belize|501,BJ|Benin|229,BM|Bermuda|1,BT|Bhutan|975,BO|Bolivia|591,' +
    'BA|Bosnia and Herzegovina|387,BW|Botswana|267,BR|Brazil|55,VG|British Virgin Islands|1,BN|Brunei|673,' +
    'BG|Bulgaria|359,BF|Burkina Faso|226,BI|Burundi|257,KH|Cambodia|855,CM|Cameroon|237,CA|Canada|1,' +
    'CV|Cape Verde|238,KY|Cayman Islands|1,CF|Central African Republic|236,TD|Chad|235,CL|Chile|56,' +
    'CN|China|86,CO|Colombia|57,KM|Comoros|269,CG|Congo|242,CD|Congo (DR)|243,CK|Cook Islands|682,' +
    'CR|Costa Rica|506,CI|Côte d’Ivoire|225,HR|Croatia|385,CU|Cuba|53,CW|Curaçao|599,CY|Cyprus|357,' +
    'CZ|Czechia|420,DK|Denmark|45,DJ|Djibouti|253,DM|Dominica|1,DO|Dominican Republic|1,EC|Ecuador|593,' +
    'EG|Egypt|20,SV|El Salvador|503,GQ|Equatorial Guinea|240,ER|Eritrea|291,EE|Estonia|372,SZ|Eswatini|268,' +
    'ET|Ethiopia|251,FK|Falkland Islands|500,FO|Faroe Islands|298,FJ|Fiji|679,FI|Finland|358,FR|France|33,' +
    'GF|French Guiana|594,PF|French Polynesia|689,GA|Gabon|241,GM|Gambia|220,GE|Georgia|995,DE|Germany|49,' +
    'GH|Ghana|233,GI|Gibraltar|350,GR|Greece|30,GL|Greenland|299,GD|Grenada|1,GP|Guadeloupe|590,GU|Guam|1,' +
    'GT|Guatemala|502,GG|Guernsey|44,GN|Guinea|224,GW|Guinea-Bissau|245,GY|Guyana|592,HT|Haiti|509,' +
    'HN|Honduras|504,HK|Hong Kong|852,HU|Hungary|36,IS|Iceland|354,IN|India|91,ID|Indonesia|62,IR|Iran|98,' +
    'IQ|Iraq|964,IE|Ireland|353,IM|Isle of Man|44,IL|Israel|972,IT|Italy|39,JM|Jamaica|1,JP|Japan|81,' +
    'JE|Jersey|44,JO|Jordan|962,KZ|Kazakhstan|7,KE|Kenya|254,KI|Kiribati|686,XK|Kosovo|383,KW|Kuwait|965,' +
    'KG|Kyrgyzstan|996,LA|Laos|856,LV|Latvia|371,LB|Lebanon|961,LS|Lesotho|266,LR|Liberia|231,LY|Libya|218,' +
    'LI|Liechtenstein|423,LT|Lithuania|370,LU|Luxembourg|352,MO|Macau|853,MG|Madagascar|261,MW|Malawi|265,' +
    'MY|Malaysia|60,MV|Maldives|960,ML|Mali|223,MT|Malta|356,MH|Marshall Islands|692,MQ|Martinique|596,' +
    'MR|Mauritania|222,MU|Mauritius|230,YT|Mayotte|262,MX|Mexico|52,FM|Micronesia|691,MD|Moldova|373,' +
    'MC|Monaco|377,MN|Mongolia|976,ME|Montenegro|382,MS|Montserrat|1,MA|Morocco|212,MZ|Mozambique|258,' +
    'MM|Myanmar|95,NA|Namibia|264,NR|Nauru|674,NP|Nepal|977,NL|Netherlands|31,NC|New Caledonia|687,' +
    'NZ|New Zealand|64,NI|Nicaragua|505,NE|Niger|227,NG|Nigeria|234,NU|Niue|683,KP|North Korea|850,' +
    'MK|North Macedonia|389,MP|Northern Mariana Islands|1,NO|Norway|47,OM|Oman|968,PK|Pakistan|92,PW|Palau|680,' +
    'PS|Palestine|970,PA|Panama|507,PG|Papua New Guinea|675,PY|Paraguay|595,PE|Peru|51,PH|Philippines|63,' +
    'PL|Poland|48,PT|Portugal|351,PR|Puerto Rico|1,QA|Qatar|974,RE|Réunion|262,RO|Romania|40,RU|Russia|7,' +
    'RW|Rwanda|250,KN|Saint Kitts and Nevis|1,LC|Saint Lucia|1,PM|Saint Pierre and Miquelon|508,' +
    'VC|Saint Vincent and the Grenadines|1,WS|Samoa|685,SM|San Marino|378,ST|São Tomé and Príncipe|239,' +
    'SA|Saudi Arabia|966,SN|Senegal|221,RS|Serbia|381,SC|Seychelles|248,SL|Sierra Leone|232,SG|Singapore|65,' +
    'SX|Sint Maarten|1,SK|Slovakia|421,SI|Slovenia|386,SB|Solomon Islands|677,SO|Somalia|252,' +
    'ZA|South Africa|27,KR|South Korea|82,SS|South Sudan|211,ES|Spain|34,LK|Sri Lanka|94,SD|Sudan|249,' +
    'SR|Suriname|597,SE|Sweden|46,CH|Switzerland|41,SY|Syria|963,TW|Taiwan|886,TJ|Tajikistan|992,' +
    'TZ|Tanzania|255,TH|Thailand|66,TL|Timor-Leste|670,TG|Togo|228,TK|Tokelau|690,TO|Tonga|676,' +
    'TT|Trinidad and Tobago|1,TN|Tunisia|216,TR|Türkiye|90,TM|Turkmenistan|993,TC|Turks and Caicos Islands|1,' +
    'TV|Tuvalu|688,UG|Uganda|256,UA|Ukraine|380,AE|United Arab Emirates|971,GB|United Kingdom|44,' +
    'US|United States|1,UY|Uruguay|598,VI|US Virgin Islands|1,UZ|Uzbekistan|998,VU|Vanuatu|678,' +
    'VA|Vatican City|39,VE|Venezuela|58,VN|Vietnam|84,WF|Wallis and Futuna|681,YE|Yemen|967,ZM|Zambia|260,' +
    'ZW|Zimbabwe|263'
  ).split(',').map(function (s) {
    var p = s.split('|');
    return { iso: p[0], name: p[1], cc: p[2] };
  });
  var BY_ISO = {};
  LIST.forEach(function (c) { BY_ISO[c.iso] = c; });

  // Shown first in the dropdown: Wellous's markets.
  var TOP = ['MY', 'SG', 'BN', 'ID', 'TH', 'PH', 'VN', 'HK', 'MO', 'TW', 'CN', 'AU'];
  // Which country a shared dial code means when we only have the number.
  var CC_DEFAULT = { 1: 'US', 7: 'RU', 39: 'IT', 44: 'GB', 262: 'RE' };
  var ISO_FOR_CC = {};
  LIST.forEach(function (c) { if (!ISO_FOR_CC[c.cc]) ISO_FOR_CC[c.cc] = c.iso; });
  Object.keys(CC_DEFAULT).forEach(function (cc) { ISO_FOR_CC[cc] = CC_DEFAULT[cc]; });
  var CODES = Object.keys(ISO_FOR_CC).sort(function (a, b) { return b.length - a.length; });

  // Mobile numbers, without the leading 0 / country code, for the countries we know well.
  // Everywhere else: 4 to 14 digits. ex = the placeholder shown in the box.
  var RULES = {
    MY: { re: /^1\d{8,9}$/, ex: '012-345 6789', len: '10 or 11 digits starting with 01' },
    SG: { re: /^[89]\d{7}$/, ex: '8123 4567', len: '8 digits starting with 8 or 9' },
    BN: { re: /^[78]\d{6}$/, ex: '712 3456', len: '7 digits starting with 7 or 8' },
    ID: { re: /^8\d{7,11}$/, ex: '0812-3456-7890', len: '10 to 13 digits starting with 08' },
    TH: { re: /^[689]\d{8}$/, ex: '081 234 5678', len: '10 digits starting with 06, 08 or 09' },
    PH: { re: /^9\d{9}$/, ex: '0917 123 4567', len: '11 digits starting with 09' },
    VN: { re: /^[35789]\d{8}$/, ex: '091 234 56 78', len: '10 digits starting with 03, 05, 07, 08 or 09' },
    HK: { re: /^[4-9]\d{7}$/, ex: '6123 4567', len: '8 digits' },
    MO: { re: /^6\d{7}$/, ex: '6612 3456', len: '8 digits starting with 6' },
    TW: { re: /^9\d{8}$/, ex: '0912 345 678', len: '10 digits starting with 09' },
    CN: { re: /^1\d{10}$/, ex: '131 2345 6789', len: '11 digits starting with 1' },
    AU: { re: /^4\d{8}$/, ex: '0412 345 678', len: '10 digits starting with 04' },
    NZ: { re: /^2\d{7,9}$/, ex: '021 123 4567', len: '9 to 11 digits starting with 02' },
    JP: { re: /^[789]0\d{8}$/, ex: '090-1234-5678', len: '11 digits starting with 070, 080 or 090' },
    KR: { re: /^1\d{8,9}$/, ex: '010-1234-5678', len: '10 or 11 digits starting with 01' },
    IN: { re: /^[6-9]\d{9}$/, ex: '98765 43210', len: '10 digits' },
    GB: { re: /^7\d{9}$/, ex: '07400 123456', len: '11 digits starting with 07' },
    US: { re: /^[2-9]\d{2}[2-9]\d{6}$/, ex: '201-555-0123', len: '10 digits' },
    CA: { re: /^[2-9]\d{2}[2-9]\d{6}$/, ex: '506-234-5678', len: '10 digits' },
    AE: { re: /^5\d{8}$/, ex: '050 123 4567', len: '10 digits starting with 05' },
  };
  var GENERIC = /^[1-9]\d{3,13}$/;

  function digits(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }
  function country(iso) { return BY_ISO[iso] || BY_ISO.MY; }
  // "85264831263" -> "852"; null if no code fits
  function codeOf(d) {
    for (var i = 0; i < CODES.length; i++) if (d.indexOf(CODES[i]) === 0) return CODES[i];
    return null;
  }
  function validNational(iso, n) {
    var r = RULES[iso];
    return r ? r.re.test(n) : GENERIC.test(n) && (country(iso).cc + n).length <= 15;
  }
  function canonicalOf(iso, n) { return iso === 'MY' ? '0' + n : country(iso).cc + n; }

  // What the guest typed, read against the country they picked. Never throws.
  // -> { ok, phone (canonical), iso, national, fixed, error }
  //    fixed: 'code' if we took out a repeated country code, 'switched' if they typed +xx for
  //    another country and we picked that country for them.
  function parse(iso, raw) {
    var c = country(iso);
    var s = String(raw == null ? '' : raw).trim();
    var d = digits(s);
    if (!d) return { ok: false, iso: c.iso, error: 'Please enter your mobile number.' };

    // Typed in international form (+852 ..., 00852 ...): trust the code they typed.
    var intl = /^\+/.test(s) || /^00/.test(d);
    if (intl) {
      var rest = /^\+/.test(s) ? d : d.slice(2);
      var code = codeOf(rest);
      if (code) {
        var target = code === c.cc ? c : country(ISO_FOR_CC[code]);
        var n = rest.slice(code.length).replace(/^0/, '');
        if (validNational(target.iso, n)) {
          return { ok: true, iso: target.iso, national: n, phone: canonicalOf(target.iso, n), fixed: target.iso === c.iso ? '' : 'switched' };
        }
        // Only a typed + is a sure sign of a country code; 00... may just be a slip, so read on.
        if (/^\+/.test(s)) return { ok: false, iso: target.iso, error: badNumber(target) };
      }
    }

    // Local form, with the usual slips: a leading 0, the country code typed again (with or
    // without a 0 in front of it), e.g. Hong Kong 085264831263 -> 64831263.
    var tries = [[d, ''], [d.replace(/^0/, ''), '']];
    var withCode = d.indexOf(c.cc) === 0 ? d.slice(c.cc.length) : d.indexOf('0' + c.cc) === 0 ? d.slice(c.cc.length + 1) : null;
    if (withCode) tries.push([withCode, 'code'], [withCode.replace(/^0/, ''), 'code']);
    for (var i = 0; i < tries.length; i++) {
      if (validNational(c.iso, tries[i][0])) {
        return { ok: true, iso: c.iso, national: tries[i][0], phone: canonicalOf(c.iso, tries[i][0]), fixed: tries[i][1] };
      }
    }
    if (withCode !== null) {
      return { ok: false, iso: c.iso, error: 'Please leave out the +' + c.cc + ' at the front. It’s already selected on the left.' };
    }
    return { ok: false, iso: c.iso, error: badNumber(c) };
  }
  function badNumber(c) {
    var r = RULES[c.iso];
    var msg = r
      ? 'That doesn’t look like a ' + c.name + ' mobile number (' + r.len + ', e.g. ' + r.ex + ').'
      : 'That doesn’t look like a ' + c.name + ' mobile number. Please check the digits.';
    return msg + ' Not from ' + c.name + '? Pick your country on the left first.';
  }

  // Any stored or typed value, no country given -> canonical. Same rules as before for Malaysia
  // (+60 12-345 6789, 60123456789, 123456789 and 0123456789 are all 0123456789), so numbers saved
  // before the country picker still match. Idempotent.
  function normalise(raw) {
    var s = String(raw == null ? '' : raw).trim();
    var d = digits(s);
    if (!d) return '';
    if (/^\+/.test(s) || /^00/.test(d)) {
      var rest = /^\+/.test(s) ? d : d.slice(2);
      var code = codeOf(rest);
      if (code) {
        var n = rest.slice(code.length).replace(/^0/, '');
        return code === '60' ? '0' + n : code + n;
      }
      d = rest;
    }
    if (d.charAt(0) === '0') return d;
    if (d.indexOf('60') === 0) return '0' + d.slice(2);
    if (d.charAt(0) === '1' && d.length <= 10) return '0' + d; // Malaysian, 0 left out
    return d;
  }
  // For comparing two numbers: ignores a stray leading 0 (old "085264831263" = "85264831263").
  function key(raw) { return normalise(raw).replace(/^0+/, ''); }
  function same(a, b) { var k = key(a); return k !== '' && k === key(b); }
  // Canonical -> { cc, iso, national }
  function split(raw) {
    var p = normalise(raw);
    if (!p) return null;
    if (p.charAt(0) === '0') return { cc: '60', iso: 'MY', national: p.slice(1) };
    var code = codeOf(p);
    if (!code) return { cc: '', iso: '', national: p };
    return { cc: code, iso: ISO_FOR_CC[code], national: p.slice(code.length) };
  }
  // Canonical -> what we show a guest: 0123456789 for Malaysia (as before), +852 64831263 otherwise
  function display(raw) {
    var x = split(raw);
    if (!x) return '';
    return x.cc === '60' ? '0' + x.national : x.cc ? '+' + x.cc + ' ' + x.national : x.national;
  }
  // Loose check for the server: a canonical number of a sensible length
  function plausible(raw) { var p = normalise(raw); return /^\d{7,15}$/.test(p); }

  return {
    COUNTRIES: LIST, TOP: TOP, RULES: RULES, country: country,
    parse: parse, normalise: normalise, key: key, same: same, split: split, display: display, plausible: plausible,
  };
});
