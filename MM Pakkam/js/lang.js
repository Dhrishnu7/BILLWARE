/* ─────────────────────────────────────────────────────────────
   BILLWARE LANGUAGE PACK

   One dictionary, one lookup. Pages call mmT('key') instead of
   holding the English sentence themselves, so adding a language
   later means adding a column here — never reopening 15 pages.

   ── Why the translations are CODE-MIXED, not pure ──
   GST, HSN, batch, expiry, MRP, stock, bill, Schedule H are left
   in English on purpose. That is how pharmacy staff already speak,
   and it is the wording printed on the government portal, on the
   distributor's invoice and on the strip itself. A "pure" Tamil or
   Hindi rendering of GST vocabulary would be harder to read than
   the English, not easier — it would be a translation of the words
   with the meaning left behind.

   ── What is NEVER translated ──
   Medicine names, customer names, batch numbers, figures, and the
   PRINTED INVOICE. An auditor, a CA or a GST officer has to read
   that document; it stays English whatever the screen is set to.

   ── Fallback ──
   A missing translation falls back to English, and a missing key
   returns the key itself rather than an empty string. A blank
   confirmation dialog is far more dangerous than an English one.
───────────────────────────────────────────────────────────── */

/* ─────────────────────────────────────────────────────────────
   ⛔ TURNED OFF — 2026-08-13

   Everything below still works. It is switched off deliberately.

   Reason: translation is only PARTIAL. The dialogs that were
   translated are not the whole set — roughly nineteen confirmations
   that move money, delete a Schedule H register entry, or overwrite
   a backup are still English. A shop reading a mostly-Tamil app
   stops treating an English dialog as "a language I cannot read"
   and starts treating it as "something technical, press OK" — and
   those are precisely the dialogs where pressing OK costs something.
   Partial cover is worse than none for that specific set.

   ── Why this flag and not just deleting the pickers ──
   Anyone who ALREADY chose Tamil has mm_lang_<username> sitting in
   their localStorage. Removing the pickers alone would strand them
   in Tamil with no control left on screen to get back. The flag
   makes mmLang() answer 'en' for everybody, chosen or not, so no
   stored preference can outlive the switch.

   ── To turn it back on ──
   Set this to true and restore the picker call sites (git show the
   commit that added this comment). Before doing that, finish the
   nineteen confirmations, and get a real Tamil or Hindi speaker to
   read the strings — nobody has, they are all machine-written.
───────────────────────────────────────────────────────────── */
const MM_LANG_ENABLED = false;

const MM_LANGS = [
    { code: 'en', label: 'English',  native: 'English' },
    { code: 'ta', label: 'Tamil',    native: 'தமிழ்' },
    { code: 'hi', label: 'Hindi',    native: 'हिंदी' }
];

/* ── Phase 1 ──────────────────────────────────────────────────
   The sentences where misreading one line costs money or data:
   every "cannot be undone" confirmation, plus the money and
   compliance guards on a bill. Ordinary labels and hints are
   deliberately NOT here yet — a misread hint costs nothing.
───────────────────────────────────────────────────────────── */
const MM_STRINGS = {

    /* ══ Deleting records ══ */
    'del.record': {
        en: 'Delete this {kind} record? It will go to the Bin for 30 days.{note}',
        ta: 'இந்த {kind} record-ஐ delete பண்ணவா? 30 நாளுக்கு Bin-ல இருக்கும்.{note}',
        hi: 'इस {kind} record को delete करें? यह 30 दिन तक Bin में रहेगा।{note}'
    },
    'del.record.perm': {
        en: 'Permanently delete this record? It cannot be recovered.',
        ta: 'இந்த record-ஐ permanent-ஆ delete பண்ணவா? இதை திரும்ப கொண்டு வர முடியாது.',
        hi: 'इस record को permanently delete करें? यह वापस नहीं आएगा।'
    },
    'bin.empty': {
        en: 'Empty the entire Bin? All items will be permanently deleted.',
        ta: 'Bin-ஐ முழுசா காலி பண்ணவா? எல்லா item-ம் permanent-ஆ delete ஆயிடும்.',
        hi: 'पूरा Bin खाली करें? सभी items permanently delete हो जाएंगे।'
    },

    /* ══ Schedule H register ══ */
    'sh.clear.items': {
        en: 'Clear all items and start fresh?',
        ta: 'எல்லா item-ஐயும் clear பண்ணி புதுசா ஆரம்பிக்கவா?',
        hi: 'सभी items clear करके नए सिरे से शुरू करें?'
    },
    'sh.del.entry': {
        en: 'Delete this register entry?\nYou can restore it from the Bin within 30 days.',
        ta: 'இந்த register entry-ஐ delete பண்ணவா?\n30 நாளுக்குள்ள Bin-ல இருந்து திரும்ப எடுக்கலாம்.',
        hi: 'इस register entry को delete करें?\n30 दिन के अंदर Bin से वापस ला सकते हैं।'
    },
    'sh.del.perm': {
        en: 'Permanently delete this entry? This cannot be undone.',
        ta: 'இந்த entry-ஐ permanent-ஆ delete பண்ணவா? இதை திரும்ப கொண்டு வர முடியாது.',
        hi: 'इस entry को permanently delete करें? यह वापस नहीं आएगी।'
    },
    'sh.bin.empty': {
        en: 'Permanently delete ALL entries in the Bin? This cannot be undone.',
        ta: 'Bin-ல இருக்கிற எல்லா entry-யையும் permanent-ஆ delete பண்ணவா? திரும்ப கொண்டு வர முடியாது.',
        hi: 'Bin की सभी entries permanently delete करें? ये वापस नहीं आएंगी।'
    },
    'sh.drugs.clear': {
        en: 'Remove ALL Schedule H drugs from the list?',
        ta: 'List-ல இருக்கிற எல்லா Schedule H drugs-ஐயும் remove பண்ணவா?',
        hi: 'List से सभी Schedule H drugs हटा दें?'
    },
    'sh.rx.del': {
        en: 'Delete this prescription softcopy? This cannot be undone.',
        ta: 'இந்த prescription softcopy-ஐ delete பண்ணவா? திரும்ப கொண்டு வர முடியாது.',
        hi: 'इस prescription softcopy को delete करें? यह वापस नहीं आएगी।'
    },
    'sh.rx.title': {
        en: 'Delete Prescription',
        ta: 'Prescription-ஐ delete பண்ணு',
        hi: 'Prescription delete करें'
    },

    /* ══ Billing ══ */
    'sales.barcode.del': {
        en: 'Delete the barcode link for:\n{code}\n\nThe medicine and its stock are NOT deleted — only this scan shortcut.',
        ta: 'இந்த barcode link-ஐ delete பண்ணவா:\n{code}\n\nMedicine-ஓ அதோட stock-ஓ delete ஆகாது — இந்த scan shortcut மட்டும்தான்.',
        hi: 'इस barcode link को delete करें:\n{code}\n\nMedicine और उसका stock delete नहीं होगा — सिर्फ़ यह scan shortcut।'
    },
    'sales.newbill': {
        en: 'Start a fresh bill? The current unsaved entries will be cleared.',
        ta: 'புது bill ஆரம்பிக்கவா? இப்ப save பண்ணாத entries clear ஆயிடும்.',
        hi: 'नया bill शुरू करें? अभी के unsaved entries clear हो जाएंगे।'
    },
    'sales.newbill.title': {
        en: 'New Bill',
        ta: 'புது Bill',
        hi: 'नया Bill'
    },
    'sales.clear.rows': {
        en: 'Clear all rows and start a fresh bill?',
        ta: 'எல்லா row-வையும் clear பண்ணி புது bill ஆரம்பிக்கவா?',
        hi: 'सभी rows clear करके नया bill शुरू करें?'
    },

    /* ══ Money guard: khata credit limit ══ */
    'sales.khata.limit': {
        en: '⛔ Khata limit exceeded for {name}.\n\nCurrent pending: {cur}\nThis bill: {bill}\nWould become: {tot}\nCredit limit: {lim}\n\nCollect a payment first, or raise the limit in Accounts → Credit Limit.',
        ta: '⛔ {name}-க்கு khata limit தாண்டிடுச்சு.\n\nஇப்ப பாக்கி: {cur}\nஇந்த bill: {bill}\nமொத்தம் ஆகும்: {tot}\nCredit limit: {lim}\n\nமுதல்ல payment வாங்குங்க, இல்லைனா Accounts → Credit Limit-ல limit-ஐ ஏத்துங்க.',
        hi: '⛔ {name} की khata limit पार हो गई।\n\nअभी बाकी: {cur}\nयह bill: {bill}\nकुल हो जाएगा: {tot}\nCredit limit: {lim}\n\nपहले payment लें, या Accounts → Credit Limit में limit बढ़ाएं।'
    },

    /* ══ Compliance guard: Schedule H / H1 needs a doctor ══ */
    'sales.h1.head': {
        en: 'This bill has a Schedule H1/X drug, which legally needs BOTH patient name and doctor.\n\n',
        ta: 'இந்த bill-ல Schedule H1/X drug இருக்கு. சட்டப்படி patient name-ம் doctor-ம் ரெண்டும் வேணும்.\n\n',
        hi: 'इस bill में Schedule H1/X drug है, जिसके लिए कानूनन patient name और doctor दोनों ज़रूरी हैं।\n\n'
    },
    'sales.h1.no.patient': {
        en: '• Patient name missing\n',
        ta: '• Patient name இல்லை\n',
        hi: '• Patient name नहीं है\n'
    },
    'sales.h1.no.doctor': {
        en: '• Doctor missing\n',
        ta: '• Doctor இல்லை\n',
        hi: '• Doctor नहीं है\n'
    },
    'sales.h1.tail': {
        en: '\nWithout them it will show as "Missing Rx" in the register.',
        ta: '\nஇவை இல்லாம போனா register-ல "Missing Rx"-ஆ காட்டும்.',
        hi: '\nइनके बिना register में "Missing Rx" दिखेगा।'
    },
    'sales.h.msg': {
        en: 'This bill has a Schedule H drug but no doctor is entered.\n\nWithout a doctor it will show as "Missing Rx" in the Schedule H register.',
        ta: 'இந்த bill-ல Schedule H drug இருக்கு, ஆனா doctor பேர் போடலை.\n\nDoctor இல்லாம Schedule H register-ல "Missing Rx"-ஆ காட்டும்.',
        hi: 'इस bill में Schedule H drug है लेकिन doctor नहीं भरा गया।\n\nDoctor के बिना Schedule H register में "Missing Rx" दिखेगा।'
    },
    'sales.h1.title': {
        en: '⛔ Schedule H1/X needs patient + doctor',
        ta: '⛔ Schedule H1/X-க்கு patient + doctor வேணும்',
        hi: '⛔ Schedule H1/X के लिए patient + doctor चाहिए'
    },
    'sales.h.title': {
        en: '⚠️ Missing doctor for Schedule H',
        ta: '⚠️ Schedule H-க்கு doctor இல்லை',
        hi: '⚠️ Schedule H के लिए doctor नहीं है'
    },

    /* ══ Money guard: the total on screen disagrees with the items ══ */
    'sales.total.mismatch': {
        en: 'The total on screen ({shown}) does not match this bill\'s own items ({calc}).\n\nThe items are what will be saved, so {calc} is the figure that will be used.\n\nCheck the bill before saving if that is not what you expect.',
        ta: 'Screen-ல தெரியிற total ({shown}), இந்த bill-ல இருக்கிற items-ஓட total ({calc})-க்கு சரியா வரலை.\n\nItems-தான் save ஆகும், அதனால {calc}-தான் எடுத்துக்கப்படும்.\n\nநீங்க எதிர்பார்த்தது இது இல்லைனா, save பண்றதுக்கு முன்னாடி bill-ஐ சரிபாருங்க.',
        hi: 'Screen पर दिख रहा total ({shown}) इस bill के items ({calc}) से मेल नहीं खाता।\n\nItems ही save होंगे, इसलिए {calc} ही लिया जाएगा।\n\nअगर यह आपकी उम्मीद के मुताबिक नहीं है तो save करने से पहले bill जाँच लें।'
    },
    'sales.total.mismatch.title': {
        en: '⚠️ Total does not match the items',
        ta: '⚠️ Total-ம் item-ம் சரியா வரலை',
        hi: '⚠️ Total items से मेल नहीं खाता'
    },
    'sales.total.saveWith': {
        en: 'Save with {calc}',
        ta: '{calc}-ல save பண்ணு',
        hi: '{calc} के साथ save करें'
    },

    /* ══ Compliance guard: a bill dated in the future ══ */
    'sales.future.date': {
        en: 'This bill is dated {date} — {n} day(s) from now.\n\nA future date puts the sale in a GST period you cannot file yet, and hides it from every report that stops at today, including the day\'s own takings.\n\nChange the Date box to today unless you truly mean to date it ahead.',
        ta: 'இந்த bill-ஓட date {date} — இன்னைக்கு இருந்து {n} நாள் முன்னாடி.\n\nமுன்னாடி date போட்டா அந்த sale இன்னும் file பண்ண முடியாத GST period-க்கு போயிடும், அத்தோட இன்னைக்கோட முடியிற எல்லா report-லேர்ந்தும் — அன்னைக்கு வந்த காசு உட்பட — மறைஞ்சிடும்.\n\nவேணும்னே முன்னாடி date போடலைனா, Date box-ஐ இன்னைக்கு மாத்துங்க.',
        hi: 'इस bill की date {date} है — आज से {n} दिन आगे।\n\nआगे की date से यह sale उस GST period में चला जाता है जिसे आप अभी file नहीं कर सकते, और आज तक की हर report से — दिन की कमाई समेत — छिप जाता है।\n\nजब तक आप जान-बूझकर आगे की date नहीं चाहते, Date box को आज कर दें।'
    },
    'sales.future.date.title': {
        en: '⚠️ This bill is dated in the future',
        ta: '⚠️ இந்த bill-ஓட date முன்னாடி இருக்கு',
        hi: '⚠️ इस bill की date आगे की है'
    },

    /* ══ Khata ══ */
    'khata.exp.del': {
        en: 'Delete this {cat} expense of {amt}?',
        ta: '{amt} மதிப்புள்ள இந்த {cat} expense-ஐ delete பண்ணவா?',
        hi: '{amt} का यह {cat} expense delete करें?'
    },

    /* ══ Purchase entry ══ */
    'pur.no.names': {
        en: 'Some items have empty product names. Save anyway?',
        ta: 'சில item-க்கு product name காலியா இருக்கு. இருந்தாலும் save பண்ணவா?',
        hi: 'कुछ items में product name खाली है। फिर भी save करें?'
    },
    'pur.incomplete': {
        en: 'You have entered a Product Name but left some details (Batch, Expiry, Qty, MRP, or Rate) empty or zero. Are you sure you want to save this incomplete record?',
        ta: 'Product Name போட்டிருக்கீங்க, ஆனா சில details (Batch, Expiry, Qty, MRP, Rate) காலியா அல்லது zero-வா இருக்கு. இந்த incomplete record-ஐ save பண்ணலாமா?',
        hi: 'आपने Product Name भरा है लेकिन कुछ details (Batch, Expiry, Qty, MRP, या Rate) खाली या zero हैं। क्या यह incomplete record save करना है?'
    },
    'pur.clear.import': {
        en: 'Clear all imported items and start fresh?',
        ta: 'Import பண்ண எல்லா item-ஐயும் clear பண்ணி புதுசா ஆரம்பிக்கவா?',
        hi: 'सभी imported items clear करके नए सिरे से शुरू करें?'
    },

    /* ══ Directory ══ */
    'dir.del': {
        en: '⚠️ Delete "{name}" from {label}?\n\nThis cannot be undone.',
        ta: '⚠️ "{name}"-ஐ {label}-ல இருந்து delete பண்ணவா?\n\nதிரும்ப கொண்டு வர முடியாது.',
        hi: '⚠️ "{name}" को {label} से delete करें?\n\nयह वापस नहीं आएगा।'
    },

    /* ══ Inbox ══ */
    'inbox.clear.read': {
        en: 'Clear {n} read message(s)?\n\nUnread messages will stay in your inbox.',
        ta: 'படிச்ச {n} message-ஐ clear பண்ணவா?\n\nபடிக்காத message எல்லாம் inbox-ல அப்படியே இருக்கும்.',
        hi: '{n} पढ़े हुए message clear करें?\n\nबिना पढ़े message inbox में रहेंगे।'
    },

    /* ══ Buttons on the dialogs above ══ */
    'btn.delete':        { en: 'Delete',          ta: 'Delete பண்ணு',        hi: 'Delete करें' },
    'btn.delete.forever':{ en: 'Delete Forever',  ta: 'Permanent-ஆ delete',  hi: 'हमेशा के लिए delete' },
    'btn.empty.bin':     { en: 'Empty Bin',       ta: 'Bin-ஐ காலி பண்ணு',    hi: 'Bin खाली करें' },
    'btn.clear.all':     { en: 'Clear All',       ta: 'எல்லாம் clear',       hi: 'सभी clear करें' },
    'btn.clear':         { en: 'Clear',           ta: 'Clear பண்ணு',         hi: 'Clear करें' },
    'btn.remove.all':    { en: 'Remove All',      ta: 'எல்லாம் remove',      hi: 'सभी हटाएं' },
    'btn.save.anyway':   { en: 'Save Anyway',     ta: 'இருந்தாலும் save',    hi: 'फिर भी save करें' },
    'btn.save.anyway2':  { en: 'Save anyway',     ta: 'இருந்தாலும் save',    hi: 'फिर भी save करें' },
    'btn.clear.start':   { en: 'Clear & Start',   ta: 'Clear பண்ணி ஆரம்பி',  hi: 'Clear करके शुरू करें' },
    'btn.goback.add':    { en: 'Go back & add',   ta: 'திரும்ப போய் சேர்',   hi: 'वापस जाकर भरें' },
    'btn.goback':        { en: 'Go back',         ta: 'திரும்ப போ',          hi: 'वापस जाएं' },
    'btn.goback.date':   { en: 'Go back and fix the date', ta: 'திரும்ப போய் date-ஐ சரி பண்ணு', hi: 'वापस जाकर date ठीक करें' },
    'btn.save.itanyway': { en: 'Save it anyway',  ta: 'இருந்தாலும் save பண்ணு', hi: 'फिर भी save करें' },

    /* ══ The language switch itself ══ */
    'lang.title':  { en: 'Language',  ta: 'மொழி',  hi: 'भाषा' },
    'lang.note': {
        en: 'Applies to warnings and confirmations. Printed bills stay in English.',
        ta: 'Warning-ம் confirmation-ம் இந்த மொழியில வரும். Print ஆகிற bill English-லயே இருக்கும்.',
        hi: 'Warnings और confirmations इसी भाषा में आएंगे। Printed bills English में ही रहेंगे।'
    },
    'lang.saved': {
        en: 'Language set to {name}',
        ta: 'மொழி {name}-ஆ மாறிடுச்சு',
        hi: 'भाषा {name} पर सेट हो गई'
    },
    /* The live sample. Choosing a language has to LOOK like it did
       something — Phase 1 only translates dialogs, so without this the
       page stays English and the switch reads as broken. */
    'lang.preview.label': {
        en: 'A warning will now look like this:',
        ta: 'இனிமே warning இப்படி வரும்:',
        hi: 'अब warning ऐसी दिखेगी:'
    },
    'lang.moved': {
        en: 'You can change this any time from 👥 Users.',
        ta: 'இதை எப்பவேணா 👥 Users-ல மாத்திக்கலாம்.',
        hi: 'इसे कभी भी 👥 Users से बदल सकते हैं।'
    },

/* ── Phase 2 ──────────────────────────────────────────────────
   The path a shop walks ONCE and never again: sign in → create the
   account → fill the shop wizard → enter the first purchase. Get it
   wrong and they never reach the part that works.

   What belongs here is the text that EXPLAINS — page headings and
   subtitles, field hints, tooltips, validation messages, the waiting
   screen. What does NOT belong here is a one-word field label:
   Username, Password, GSTIN, PIN Code, Batch, MRP, HSN are the words
   the shop already uses, on the portal and on the distributor's
   invoice, and translating them makes the form harder to read. Same
   code-mixing rule as Phase 1, applied to a bigger surface.

   These are reached through data-mmt in the markup rather than an
   mmT() call, so the English stays in the page as the fallback. See
   mmApplyT below.
───────────────────────────────────────────────────────────── */

    /* ══ Sign in ══ */
    'login.head': {
        en: 'Welcome back',
        ta: 'வரவேற்கிறோம்',
        hi: 'फिर से स्वागत है'
    },
    'login.sub': {
        en: 'Sign in to continue to your dashboard',
        ta: 'உங்க dashboard-க்கு போக sign in பண்ணுங்க',
        hi: 'अपने dashboard पर जाने के लिए sign in करें'
    },
    'login.user.ph':   { en: 'Enter your username', ta: 'Username-ஐ போடுங்க', hi: 'अपना username डालें' },
    'login.pw.ph':     { en: 'Enter your password', ta: 'Password-ஐ போடுங்க', hi: 'अपना password डालें' },
    'login.remember':  { en: 'Keep me signed in',   ta: 'Sign in பண்ணியே வெச்சுக்கோங்க', hi: 'मुझे sign in रखें' },
    'login.forgot':    { en: 'Forgot password?',    ta: 'Password மறந்துட்டீங்களா?', hi: 'Password भूल गए?' },
    'login.btn':       { en: 'Sign In',             ta: 'Sign In பண்ணு', hi: 'Sign In करें' },
    'login.new':       { en: 'New store owner?',    ta: 'புது கடை உரிமையாளரா?', hi: 'नए store owner हैं?' },
    'login.create':    { en: 'Create an account →', ta: 'Account ஒண்ணு உருவாக்குங்க →', hi: 'Account बनाएं →' },
    'login.err.bad':    { en: 'Invalid username or password.', ta: 'Username இல்லைனா password தப்பா இருக்கு.', hi: 'Username या password ग़लत है।' },
    'login.err.nouser': { en: 'Please enter your username.',   ta: 'Username-ஐ போடுங்க.', hi: 'कृपया अपना username डालें।' },
    'login.err.nopw':   { en: 'Please enter your password.',   ta: 'Password-ஐ போடுங்க.', hi: 'कृपया अपना password डालें।' },

    /* ══ Forgot password ══ */
    'fp.title':     { en: 'Reset Password',         ta: 'Password-ஐ மாத்து', hi: 'Password reset करें' },
    'fp.req.title': { en: 'Request Password Reset', ta: 'Password reset-க்கு request பண்ணு', hi: 'Password reset की request करें' },
    'fp.pin.title': { en: 'Enter Reset PIN',        ta: 'Reset PIN-ஐ போடுங்க', hi: 'Reset PIN डालें' },
    'fp.req.msg': {
        en: 'Enter your username and the reason for your reset. Your super admin will review it.',
        ta: 'உங்க username-ம், எதுக்கு reset வேணும்ங்கிற காரணமும் போடுங்க. Super admin அதை பாத்து முடிவு பண்ணுவாங்க.',
        hi: 'अपना username और reset का कारण डालें। आपका super admin इसे देखकर फ़ैसला करेगा।'
    },
    'fp.reason.ph': { en: 'e.g. Forgot my password', ta: 'உ.ம். Password மறந்துட்டேன்', hi: 'जैसे: password भूल गया' },
    'fp.req.btn':   { en: 'Submit Request',          ta: 'Request அனுப்பு', hi: 'Request भेजें' },
    'fp.havepin':   { en: 'I already have a Reset PIN', ta: 'என்கிட்ட ஏற்கனவே Reset PIN இருக்கு', hi: 'मेरे पास पहले से Reset PIN है' },
    'fp.pin.msg': {
        en: 'Enter your username, the 6-digit PIN provided by your admin, and your new password.',
        ta: 'உங்க username, admin கொடுத்த 6-இலக்க PIN, அப்புறம் புது password — மூணையும் போடுங்க.',
        hi: 'अपना username, admin से मिला 6-अंकों का PIN, और नया password डालें।'
    },
    'fp.newpw.ph':  { en: 'Enter new password',   ta: 'புது password-ஐ போடுங்க', hi: 'नया password डालें' },
    'fp.setpw':     { en: 'Set New Password',     ta: 'புது password-ஐ set பண்ணு', hi: 'नया password set करें' },
    'fp.back':      { en: '← Back to Request Reset', ta: '← திரும்ப reset request-க்கு போ', hi: '← वापस reset request पर' },

    /* ══ Create account ══ */
    'setup.badge': { en: 'New Store Account', ta: 'புது கடை Account', hi: 'नया Store Account' },
    'setup.head':  { en: 'Create Account',    ta: 'Account உருவாக்குங்க', hi: 'Account बनाएं' },
    'setup.sub': {
        en: 'Each account is a completely independent store. Your data is private and isolated from all other accounts.',
        ta: 'ஒவ்வொரு account-ம் தனித்தனி கடை. உங்க data உங்களுக்கு மட்டும்தான் — வேற எந்த account-க்கும் தெரியாது.',
        hi: 'हर account एक बिल्कुल अलग store है। आपका data सिर्फ़ आपका है — किसी दूसरे account को नहीं दिखेगा।'
    },
    'setup.user.ph':    { en: 'e.g. your_name',           ta: 'உ.ம். your_name', hi: 'जैसे: your_name' },
    'setup.pw.ph':      { en: 'Create a strong password', ta: 'கடினமான password ஒண்ணு வெச்சுக்கோங்க', hi: 'एक मज़बूत password बनाएं' },
    'setup.confirm.ph': { en: 'Re-enter your password',   ta: 'அதே password-ஐ மறுபடி போடுங்க', hi: 'वही password दोबारा डालें' },
    'setup.have':       { en: 'Already have an account?', ta: 'ஏற்கனவே account இருக்கா?', hi: 'पहले से account है?' },
    'setup.signin':     { en: 'Sign in',                  ta: 'Sign in பண்ணுங்க', hi: 'Sign in करें' },
    'setup.creating':   { en: 'Creating account...',      ta: 'Account உருவாக்குறோம்...', hi: 'Account बन रहा है...' },
    'setup.created':    { en: 'Account Created!',         ta: 'Account உருவாகிடுச்சு!', hi: 'Account बन गया!' },
    'setup.err.user':   { en: 'Username must be at least 3 characters.', ta: 'Username-ல குறைஞ்சது 3 எழுத்து இருக்கணும்.', hi: 'Username में कम से कम 3 अक्षर होने चाहिए।' },
    'setup.err.pw':     { en: 'Password must be at least 6 characters.', ta: 'Password-ல குறைஞ்சது 6 எழுத்து இருக்கணும்.', hi: 'Password में कम से कम 6 अक्षर होने चाहिए।' },
    'setup.err.match':  { en: 'Passwords do not match.',  ta: 'ரெண்டு password-ம் ஒண்ணா இல்லை.', hi: 'दोनों password एक जैसे नहीं हैं।' },
    /* The strength meter. Its whole job is to be read at a glance. */
    'pw.enter':    { en: 'Enter a password', ta: 'Password போடுங்க',  hi: 'Password डालें' },
    'pw.tooshort': { en: 'Too short',        ta: 'ரொம்ப சின்னது',      hi: 'बहुत छोटा है' },
    'pw.weak':     { en: 'Weak',             ta: 'பலவீனமா இருக்கு',    hi: 'कमज़ोर है' },
    'pw.moderate': { en: 'Moderate',         ta: 'பரவாயில்ல',          hi: 'ठीक-ठाक है' },
    'pw.strong':   { en: 'Strong ✨',        ta: 'நல்லா இருக்கு ✨',   hi: 'मज़बूत है ✨' },

    /* ══ Shop setup wizard ══ */
    'ss.head': { en: 'Set Up Your Shop', ta: 'உங்க கடையை set பண்ணுங்க', hi: 'अपनी दुकान सेट करें' },
    'ss.sub': {
        en: 'This information will appear on your invoices and bills',
        ta: 'இங்க போடுறது எல்லாம் உங்க bill-லயும் invoice-லயும் அச்சாகும்',
        hi: 'यह जानकारी आपके bill और invoice पर छपेगी'
    },
    'ss.sec.identity': { en: 'Store Identity',    ta: 'கடை விவரம்',        hi: 'दुकान की पहचान' },
    'ss.sec.address':  { en: 'Address',           ta: 'முகவரி',            hi: 'पता' },
    'ss.sec.legal':    { en: 'Legal Information', ta: 'சட்டப்பூர்வ விவரம்', hi: 'क़ानूनी जानकारी' },
    'ss.sec.terms':    { en: 'Terms & Conditions (shown on invoice)', ta: 'விதிமுறைகள் (invoice-ல அச்சாகும்)', hi: 'नियम व शर्तें (invoice पर छपेंगी)' },
    'ss.sec.footer':   { en: 'Invoice Footer Message', ta: 'Invoice அடியில வர்ற செய்தி', hi: 'Invoice के नीचे का संदेश' },
    'ss.f.shopname':   { en: 'Shop / Store Name', ta: 'கடை பேரு',          hi: 'दुकान का नाम' },
    'ss.f.prefix':     { en: 'Invoice Prefix',    ta: 'Bill எண் Prefix',   hi: 'Bill नंबर का Prefix' },
    'ss.f.prefix.hint':{ en: 'Bills will be numbered: SL-001, SL-002…', ta: 'Bill-க்கு இப்படி எண் வரும்: SL-001, SL-002…', hi: 'Bill के नंबर ऐसे बनेंगे: SL-001, SL-002…' },
    'ss.f.phone':      { en: 'Phone Number',      ta: 'Phone நம்பர்',      hi: 'Phone नंबर' },
    'ss.f.addr1':      { en: 'Address Line 1',    ta: 'முகவரி வரி 1',      hi: 'पता लाइन 1' },
    'ss.f.addr2':      { en: 'Address Line 2 (Area, District)', ta: 'முகவரி வரி 2 (ஏரியா, மாவட்டம்)', hi: 'पता लाइन 2 (एरिया, ज़िला)' },
    'ss.f.city':       { en: 'Town / City',       ta: 'ஊர் / நகரம்',       hi: 'शहर / कस्बा' },
    'ss.f.city.ph':    { en: 'e.g. Coimbatore',   ta: 'உ.ம். கோயம்புத்தூர்', hi: 'जैसे: कोयंबटूर' },
    'ss.addr.note': {
        en: 'Required for e-Invoice and e-Way bills. GSTR-1 and Tally do not need them.',
        ta: 'e-Invoice-க்கும் e-Way bill-க்கும் இது கட்டாயம். GSTR-1-க்கும் Tally-க்கும் இது தேவையில்லை.',
        hi: 'e-Invoice और e-Way bill के लिए ज़रूरी है। GSTR-1 और Tally को इनकी ज़रूरत नहीं।'
    },
    'ss.f.dl':     { en: 'Drug Licence No (DL No)', ta: 'Drug Licence நம்பர் (DL No)', hi: 'Drug Licence नंबर (DL No)' },
    'ss.f.footer': { en: 'Closing message printed at the bottom of each bill', ta: 'ஒவ்வொரு bill-ஓட அடியிலயும் அச்சாகும் முடிவு செய்தி', hi: 'हर bill के नीचे छपने वाला आख़िरी संदेश' },
    'ss.term1.ph': { en: 'e.g. Goods once sold cannot be taken back or exchanged.', ta: 'உ.ம். விற்ற பொருள் திரும்ப எடுக்கப்படாது, மாத்தித் தரப்படாது.', hi: 'जैसे: बिका हुआ सामान वापस या exchange नहीं होगा।' },
    'ss.term2.ph': { en: 'e.g. Medicines should be stored as per manufacturer guidelines.', ta: 'உ.ம். மருந்துகளை தயாரிப்பாளர் சொன்னபடி பாதுகாக்கவும்.', hi: 'जैसे: दवाइयों को निर्माता के निर्देशों के अनुसार रखें।' },
    'ss.term3.ph': { en: 'e.g. Subject to local jurisdiction only.', ta: 'உ.ம். உள்ளூர் நீதிமன்ற எல்லைக்கு மட்டுமே உட்பட்டது.', hi: 'जैसे: सिर्फ़ स्थानीय न्यायालय के अधिकार क्षेत्र में।' },
    'ss.footer.ph': { en: 'e.g. "Wishing you a speedy recovery!"', ta: 'உ.ம். "சீக்கிரம் குணமாகட்டும்!"', hi: 'जैसे: "जल्दी स्वस्थ हों!"' },
    'ss.submit':   { en: 'Save Shop Details & Submit for Approval', ta: 'கடை விவரத்தை save பண்ணி ஒப்புதலுக்கு அனுப்பு', hi: 'दुकान की जानकारी save करके मंज़ूरी के लिए भेजें' },
    'ss.skip':     { en: "Skip for now (I'll fill this later)", ta: 'இப்போ வேண்டாம் (அப்புறமா நிரப்பிக்கிறேன்)', hi: 'अभी छोड़ें (बाद में भर दूंगा)' },
    'ss.saving':   { en: 'Saving...', ta: 'Save ஆகுது...', hi: 'Save हो रहा है...' },

    /* Waiting for approval — the screen a new shop stares at longest. */
    'ss.pending.title': { en: 'Request Submitted!',        ta: 'Request அனுப்பியாச்சு!', hi: 'Request भेज दी गई!' },
    'ss.pending.badge': { en: '⏳ Awaiting Admin Approval', ta: '⏳ Admin ஒப்புதலுக்காக காத்திருக்கு', hi: '⏳ Admin की मंज़ूरी का इंतज़ार' },
    'ss.pending.l1':    { en: 'Your account and shop details have been submitted.', ta: 'உங்க account-ம் கடை விவரமும் அனுப்பியாச்சு.', hi: 'आपका account और दुकान की जानकारी भेज दी गई है।' },
    'ss.pending.l2':    { en: 'The administrator will review and approve your account.', ta: 'Administrator அதை பாத்து ஒப்புதல் கொடுப்பாங்க.', hi: 'Administrator इसे देखकर मंज़ूरी देंगे।' },
    'ss.pending.l3':    { en: "Once approved, you'll be able to log in and start billing.", ta: 'ஒப்புதல் கிடைச்சதும் login பண்ணி billing ஆரம்பிக்கலாம்.', hi: 'मंज़ूरी मिलते ही आप login करके billing शुरू कर सकते हैं।' },
    'ss.pending.sub':   { en: 'Your account is awaiting admin approval', ta: 'உங்க account admin ஒப்புதலுக்கு காத்திருக்கு', hi: 'आपका account admin की मंज़ूरी के इंतज़ार में है' },
    'ss.golo':          { en: 'Go to Login →', ta: 'Login-க்கு போ →', hi: 'Login पर जाएं →' },
    'ss.almost':        { en: 'Almost Done!', ta: 'கிட்டத்தட்ட முடிஞ்சிடுச்சு!', hi: 'बस थोड़ा और!' },
    'ss.almost.sub':    { en: 'Your shop is set up and waiting for approval', ta: 'உங்க கடை set ஆயிடுச்சு, ஒப்புதலுக்கு காத்திருக்கு', hi: 'आपकी दुकान सेट हो गई है, मंज़ूरी का इंतज़ार है' },

    /* Coming back later to EDIT the profile */
    'ss.head.settings': { en: 'Shop Settings', ta: 'கடை Settings', hi: 'दुकान की Settings' },
    'ss.sub.settings':  { en: 'Update your store details and invoice information', ta: 'கடை விவரத்தையும் invoice விவரத்தையும் update பண்ணுங்க', hi: 'अपनी दुकान और invoice की जानकारी update करें' },
    'ss.checking':      { en: 'Checking permissions…', ta: 'Permission-ஐ சரிபாக்குறோம்…', hi: 'Permission जाँची जा रही है…' },
    'ss.savechanges':   { en: 'Save Changes', ta: 'மாற்றங்களை save பண்ணு', hi: 'बदलाव save करें' },
    'ss.back.dash':     { en: '← Back to Dashboard', ta: '← Dashboard-க்கு திரும்பு', hi: '← Dashboard पर वापस' },
    'ss.approved':      { en: '✅ Your edit request was approved. Make your changes and save.', ta: '✅ உங்க edit request-க்கு ஒப்புதல் கிடைச்சிடுச்சு. மாற்றம் பண்ணி save பண்ணுங்க.', hi: '✅ आपकी edit request मंज़ूर हो गई। बदलाव करके save करें।' },
    'ss.locked.title':  { en: 'Editing is locked', ta: 'Edit பண்ண முடியாது — பூட்டி இருக்கு', hi: 'Editing बंद है' },
    'ss.locked.sub':    { en: 'Send a request to Super Admin to unlock editing', ta: 'Edit பண்ண Super Admin-க்கு request அனுப்புங்க', hi: 'Editing खोलने के लिए Super Admin को request भेजें' },
    'ss.req.btn':       { en: 'Request Edit Permission', ta: 'Edit permission கேட்டு request பண்ணு', hi: 'Edit permission की request करें' },
    'ss.req.reason':    { en: 'Reason for editing', ta: 'எதுக்கு edit பண்றீங்க', hi: 'Edit करने का कारण' },
    'ss.req.reason.ph': { en: 'e.g. Our shop name changed, phone number updated, need to correct GSTIN...', ta: 'உ.ம். கடை பேரு மாறிடுச்சு, phone நம்பர் மாறிடுச்சு, GSTIN-ஐ சரி பண்ணணும்...', hi: 'जैसे: दुकान का नाम बदल गया, phone नंबर बदला, GSTIN ठीक करना है...' },
    'ss.req.send':      { en: 'Send Request', ta: 'Request அனுப்பு', hi: 'Request भेजें' },
    'ss.req.cancel':    { en: 'Cancel', ta: 'வேண்டாம்', hi: 'रहने दें' },
    'ss.req.pending':   { en: 'Edit Request Pending', ta: 'Edit request காத்திருக்கு', hi: 'Edit Request बाकी है' },
    'ss.req.noreason':  { en: '⚠️ Please enter a reason for your edit request.', ta: '⚠️ எதுக்கு edit பண்றீங்கன்னு காரணம் போடுங்க.', hi: '⚠️ कृपया edit request का कारण लिखें।' },
    'ss.req.sent':      { en: "✅ Request sent! You'll be able to edit once the Super Admin approves it.", ta: '✅ Request அனுப்பியாச்சு! Super Admin ஒப்புதல் கொடுத்ததும் edit பண்ணலாம்.', hi: '✅ Request भेज दी गई! Super Admin की मंज़ूरी के बाद आप edit कर सकेंगे।' },

    'ss.err.shopname': { en: 'Please enter your shop name.', ta: 'கடை பேரை போடுங்க.', hi: 'कृपया दुकान का नाम डालें।' },
    'ss.err.prefix':   { en: 'Please enter an invoice prefix (e.g. MM).', ta: 'Invoice prefix ஒண்ணு போடுங்க (உ.ம். MM).', hi: 'Invoice prefix डालें (जैसे MM)।' },
    'ss.err.phone':    { en: 'Please enter your phone number.', ta: 'Phone நம்பரை போடுங்க.', hi: 'कृपया phone नंबर डालें।' },
    'ss.err.addr':     { en: 'Please enter your address.', ta: 'முகவரியை போடுங்க.', hi: 'कृपया पता डालें।' },
    /* Appended to the checker's own reason, which stays English — that
       part names a GSTIN rule and is quoted from the portal. */
    'ss.err.gstin.blank': { en: ' Leave it blank if you are not GST registered.', ta: ' GST registration இல்லைனா இதை காலியா விட்டுடுங்க.', hi: ' अगर GST registration नहीं है तो इसे खाली छोड़ दें।' },
    'ss.err.session':  { en: 'Session missing. Please refresh the page (Ctrl+Shift+R) or log in again.', ta: 'Session கிடைக்கல. Page-ஐ refresh பண்ணுங்க (Ctrl+Shift+R), இல்லைனா மறுபடி login பண்ணுங்க.', hi: 'Session नहीं मिला। Page refresh करें (Ctrl+Shift+R) या दोबारा login करें।' },

    /* ══ The first purchase ══ */
    'pur.head': { en: 'Add Purchase', ta: 'Purchase சேர்', hi: 'Purchase जोड़ें' },
    'pur.sub': {
        en: 'Add multiple items in one go — same bill, multiple products',
        ta: 'ஒரே நேரத்துல பல item சேர்க்கலாம் — ஒரே bill, பல product',
        hi: 'एक साथ कई items जोड़ें — एक ही bill, कई products'
    },
    'pur.sec.bill':  { en: '📋 Bill Details',  ta: '📋 Bill விவரம்', hi: '📋 Bill की जानकारी' },
    'pur.sec.items': { en: '💊 Product Items', ta: '💊 மருந்து / பொருள் பட்டியல்', hi: '💊 दवाई / सामान की सूची' },
    'pur.f.billno.ph': { en: 'e.g. BL-001', ta: 'உ.ம். BL-001', hi: 'जैसे: BL-001' },
    'pur.f.firm':      { en: 'Supplier / Firm', ta: 'Supplier / நிறுவனம்', hi: 'Supplier / फ़र्म' },
    'pur.f.firm.ph':   { en: 'Pick a supplier or type a new one…', ta: 'Supplier-ஐ தேர்ந்தெடுங்க, இல்லைனா புதுசா type பண்ணுங்க…', hi: 'Supplier चुनें या नया type करें…' },
    'pur.paidnow': {
        en: "💵 Paid now — records a full payment so this bill won't show as owed in the Supplier Ledger",
        ta: '💵 இப்பவே பணம் கொடுத்தாச்சு — முழு payment-ஆ பதிவாகும், அதனால இந்த bill Supplier Ledger-ல பாக்கியா காட்டாது',
        hi: '💵 अभी भुगतान कर दिया — पूरा payment दर्ज होगा, तो यह bill Supplier Ledger में बकाया नहीं दिखेगा'
    },
    'pur.paidby':        { en: 'Paid by', ta: 'எப்படி கொடுத்தீங்க', hi: 'किससे दिया' },
    'pur.import.clear':  { en: '🗑️ Clear Imported', ta: '🗑️ Import பண்ணதை clear பண்ணு', hi: '🗑️ Imported हटाएं' },
    'pur.import.names':  { en: '📋 Import Medicine Names', ta: '📋 Medicine பேர்களை import பண்ணு', hi: '📋 Medicine के नाम import करें' },
    'pur.import.invoice':{ en: '📥 Import Full Invoice', ta: '📥 முழு invoice-ஐயும் import பண்ணு', hi: '📥 पूरा invoice import करें' },
    'pur.ocr.offline':   { en: '⬇️ Save Scanner Offline', ta: '⬇️ Scanner-ஐ offline-ல சேமி', hi: '⬇️ Scanner offline सेव करें' },
    'pur.ocr.offline.tip': {
        en: 'Save the invoice scanner on this device so it works without internet',
        ta: 'Invoice scanner-ஐ இந்த device-ல சேமிச்சு வெச்சா internet இல்லாமலும் வேலை செய்யும்',
        hi: 'Invoice scanner को इस device पर सेव करें ताकि बिना internet के भी चले'
    },
    'pur.ocr.next':   { en: 'Go to next →', ta: 'அடுத்ததுக்கு போ →', hi: 'अगले पर जाएं →' },
    'pur.additem':    { en: 'Add Another Item', ta: 'இன்னொரு item சேர்', hi: 'एक और item जोड़ें' },
    'pur.grandtotal': { en: 'Grand Total', ta: 'மொத்தம்', hi: 'कुल योग' },
    'pur.cancel':     { en: 'Cancel', ta: 'வேண்டாம்', hi: 'रहने दें' },
    'pur.save':       { en: 'Save All Purchases', ta: 'எல்லா purchase-ஐயும் save பண்ணு', hi: 'सारे purchases save करें' },
    'pur.li.remove':  { en: '✕ Remove', ta: '✕ நீக்கு', hi: '✕ हटाएं' },
    'pur.li.product.ph': { en: 'Type or select medicine…', ta: 'Medicine-ஐ type பண்ணுங்க, இல்லைனா தேர்ந்தெடுங்க…', hi: 'Medicine type करें या चुनें…' },
    'pur.li.barcode.hint': {
        en: '(optional — scan or type to link this medicine for billing)',
        ta: '(விருப்பம் — billing-ல scan பண்ண, இந்த medicine-க்கு barcode-ஐ இணைக்கலாம்)',
        hi: '(वैकल्पिक — billing में scan करने के लिए इस medicine से barcode जोड़ें)'
    },
    'pur.li.barcode.ph': { en: 'Scan or type the barcode…', ta: 'Barcode-ஐ scan பண்ணுங்க, இல்லைனா type பண்ணுங்க…', hi: 'Barcode scan करें या type करें…' },
    'pur.li.free.hint':  { en: '(scheme — not charged)', ta: '(scheme — இதுக்கு காசு இல்லை)', hi: '(scheme — इसका पैसा नहीं)' },
    'pur.li.total.ph':   { en: 'Auto-calculated', ta: 'தானா கணக்கிடும்', hi: 'अपने आप जुड़ेगा' },
    'pur.li.h.tip': {
        en: 'Schedule H drug? Auto-lights for known H drugs — tap to override. Confirmed H items are logged to the H register.',
        ta: 'Schedule H drug-ஆ? தெரிஞ்ச H drug-க்கு தானா எரியும் — வேணும்னா தட்டி மாத்திக்கலாம். H-ன்னு உறுதி பண்ணதெல்லாம் H register-ல பதிவாகும்.',
        hi: 'Schedule H drug है? जाने-पहचाने H drugs पर अपने आप जलता है — बदलने के लिए tap करें। पक्के किए गए H items H register में दर्ज होते हैं।'
    },
    'pur.li.gst.tip': {
        en: 'GST slab — medicines are 0, 5, 12 or 18%',
        ta: 'GST slab — மருந்துக்கு 0, 5, 12 இல்லைனா 18%',
        hi: 'GST slab — दवाइयों पर 0, 5, 12 या 18%'
    }
};

/* ─────────────────────────────────────────────────────────────
   Which language is this USER on?

   NOT stored through mmLsGet/mmLsSet. Those scope by tenant_id,
   which for a WORKER is the owner's username — so every member of
   a shop would share one setting and the owner switching to Tamil
   would switch the whole counter with them.

   Keyed on the logged-in username instead, so an owner working in
   English and a counter hand working in Tamil can share one till.
   Falls back to an unscoped key when nobody is signed in, which is
   only ever the login screen.
───────────────────────────────────────────────────────────── */
function _mmLangKey() {
    let u = '';
    try {
        const s = (typeof mmGetSession === 'function') ? mmGetSession() : null;
        if (s && s.username) u = String(s.username);
    } catch (e) {}
    return u ? ('mm_lang_' + u) : 'mm_lang';
}

function mmLang() {
    if (window.__mmLangOverride) return window.__mmLangOverride;   // tests only
    /* The switch. Deliberately AFTER the test override so the machinery
       stays testable, and BEFORE the stored value so a preference chosen
       while the feature was live cannot survive it being turned off. */
    if (!MM_LANG_ENABLED) return 'en';
    try {
        const v = localStorage.getItem(_mmLangKey());
        if (v && MM_LANGS.some(l => l.code === v)) return v;
    } catch (e) {}
    return 'en';
}

/* Has this person ever actually chosen? Distinct from "is on English",
   because the dashboard prompt should disappear once they have picked —
   including when they deliberately picked English. */
function mmLangChosen() {
    if (!MM_LANG_ENABLED) return true;      // never prompt while switched off
    try { return !!localStorage.getItem(_mmLangKey()); } catch (e) { return false; }
}

function mmSetLang(code) {
    if (!MM_LANG_ENABLED) return false;
    if (!MM_LANGS.some(l => l.code === code)) return false;
    try { localStorage.setItem(_mmLangKey(), code); } catch (e) {}
    try { document.documentElement.setAttribute('lang', code); } catch (e) {}
    return true;
}

/* ─────────────────────────────────────────────────────────────
   mmT('key', { name: 'Ravi' })

   Placeholders are {braced}. A value that is missing is left as
   the literal placeholder rather than printed as "undefined" —
   "₹undefined" in a delete confirmation is how a shop loses the
   wrong record.
───────────────────────────────────────────────────────────── */
function mmT(key, vars) {
    const entry = MM_STRINGS[key];
    if (!entry) {
        try { console.warn('[lang] no such key:', key); } catch (e) {}
        return key;                       // never blank — a blank dialog is worse
    }
    let s = entry[mmLang()] || entry.en || key;
    if (vars) {
        s = s.replace(/\{(\w+)\}/g, (m, k) =>
            (vars[k] !== undefined && vars[k] !== null) ? String(vars[k]) : m);
    }
    return s;
}

/* Does a key exist? Used by the checks, and by anything that wants
   to fall back to its own wording rather than print a raw key. */
function mmTHas(key) { return Object.prototype.hasOwnProperty.call(MM_STRINGS, key); }

/* ─────────────────────────────────────────────────────────────
   PHASE 2 — translating text that sits in the PAGE, not in a call

   Phase 1 was dialogs: a page builds the sentence at the moment it
   needs it, so mmT('key') slots straight in. The hint lines are the
   opposite — they are static markup, hundreds of them, and rewriting
   each one into a JS call would put user-facing sentences back into
   the pages, which is the exact thing lang.js replaced.

   So the page marks the element and keeps its English:

       <div class="hint" data-mmt="setup.prefix.hint">
           Bills will be numbered: SL-001, SL-002…
       </div>
       <input data-mmt-ph="login.user.ph" placeholder="Enter your username">
       <button data-mmt-title="pur.h.tip" title="Schedule H drug?…">

   The English in the file is the fallback of last resort: if this
   script never loads, or the key is missing, or the walker throws,
   the shop still reads an English sentence rather than a blank box
   or a raw key. mmApplyT() then overwrites it from the dictionary —
   including for English, so the dictionary stays the single source
   of truth and the two cannot quietly drift apart.

   ── Why it refuses elements that have children ──
   data-mmt sets textContent, which would delete any child element.
   A label like  <label>Shop Name <span>*</span></label>  would lose
   its required star and nobody would notice until a shop skipped a
   mandatory field. Rather than guess, the walker leaves such an
   element ALONE and warns: the wording stays English, which is a
   visible, harmless failure. Wrap the words in their own span to
   translate them.
───────────────────────────────────────────────────────────── */
function mmApplyT(root) {
    const scope = root || document;
    if (!scope || typeof scope.querySelectorAll !== 'function') return 0;
    let applied = 0;

    const each = (attr, fn) => {
        let nodes;
        try { nodes = scope.querySelectorAll('[' + attr + ']'); } catch (e) { return; }
        nodes.forEach(el => {
            const key = el.getAttribute(attr);
            if (!key) return;
            if (!mmTHas(key)) {
                try { console.warn('[lang] ' + attr + ' points at a missing key:', key); } catch (e) {}
                return;                       // leave the English that is already there
            }
            const txt = mmT(key);
            if (!txt || txt === key) return;  // never blank a line, never print a raw key
            /* fn returns false when it declined. The count is the only thing a
               caller can check, so it must mean "this many lines actually
               changed" — counting a refusal would report success for a line
               still sitting there in English. */
            try { if (fn(el, txt) !== false) applied++; } catch (e) {}
        });
    };

    each('data-mmt', (el, txt) => {
        if (el.children && el.children.length) {
            try { console.warn('[lang] data-mmt on an element with children, skipped:', el.getAttribute('data-mmt')); } catch (e) {}
            return false;
        }
        el.textContent = txt;
    });
    each('data-mmt-ph',    (el, txt) => { el.setAttribute('placeholder', txt); });
    each('data-mmt-title', (el, txt) => { el.setAttribute('title', txt); });

    return applied;
}

/* ─────────────────────────────────────────────────────────────
   Carrying a choice made BEFORE sign-in

   The language is keyed per real user (mm_lang_<username>), but the
   first screens a new owner sees — login, create account, the shop
   wizard — happen with nobody signed in, so the choice lands on the
   unscoped `mm_lang` key. Without this, picking Tamil on the login
   screen would be forgotten the instant they signed in, and the
   wizard they were about to fill in is the whole reason they picked.

   Adopted ONCE per user, and only when that user has never chosen —
   an owner who deliberately set English is not overruled by whatever
   the last person left on the shared counter machine.

   The unscoped key is deliberately NOT cleared: it is the login
   screen's own language on this device, and the next person to sign
   in on it is far more likely to want the same one than English.
───────────────────────────────────────────────────────────── */
function mmAdoptLang() {
    if (!MM_LANG_ENABLED) return false;
    try {
        const s = (typeof mmGetSession === 'function') ? mmGetSession() : null;
        if (!s || !s.username) return false;
        const userKey = 'mm_lang_' + s.username;
        if (localStorage.getItem(userKey)) return false;          // they have chosen
        const pre = localStorage.getItem('mm_lang');
        if (!pre || !MM_LANGS.some(l => l.code === pre)) return false;
        localStorage.setItem(userKey, pre);
        try { document.documentElement.setAttribute('lang', pre); } catch (e) {}
        return true;
    } catch (e) { return false; }
}

/* ─────────────────────────────────────────────────────────────
   The switch. Rendered into whatever element id is passed.
───────────────────────────────────────────────────────────── */
function mmRenderLangPicker(elId, opts) {
    const host = document.getElementById(elId);
    if (!host) return;
    /* Belt and braces: the call sites are gone, but a page that ever calls
       this again must not resurrect the switch by accident. */
    if (!MM_LANG_ENABLED) { host.innerHTML = ''; return; }
    opts = opts || {};
    const cur  = mmLang();
    const dark = opts.variant === 'dark';       // login.html is an ocean-glass page
    const esc  = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const c = dark
        ? { label:'rgba(148,163,184,0.95)', note:'rgba(148,163,184,0.65)', off:'rgba(255,255,255,0.06)',
            offText:'rgba(226,232,240,0.85)', offBorder:'rgba(255,255,255,0.16)', on:'#0891b2', onBorder:'#22d3ee',
            box:'rgba(255,255,255,0.04)', boxBorder:'rgba(255,255,255,0.10)', boxText:'rgba(226,232,240,0.9)' }
        : { label:'#64748b', note:'#94a3b8', off:'#fff',
            offText:'#475569', offBorder:'#cbd5e1', on:'#2563eb', onBorder:'#2563eb',
            box:'#f8fafc', boxBorder:'#e2e8f0', boxText:'#334155' };

    /* The sample exists because a preference with no visible effect reads as a
       dead button. On a page that translates ITSELF (data-mmt), the page IS the
       confirmation and the canned sentence is just noise — those pass sample:false. */
    const wantSample = opts.sample !== false;
    const sample = wantSample ? mmT('bin.empty') : '';

    host.innerHTML =
        '<div style="display:flex; align-items:center; gap:0.55rem; flex-wrap:wrap; justify-content:center;">'
      + '<span style="font-size:0.82rem; color:' + c.label + '; font-weight:600;">🌐 ' + esc(mmT('lang.title')) + '</span>'
      + MM_LANGS.map(l =>
            '<button type="button" data-lang="' + l.code + '" '
          + 'style="padding:0.3rem 0.75rem; border-radius:999px; cursor:pointer; font-size:0.82rem; font-weight:700;'
          + 'font-family:inherit;'
          + 'border:1.5px solid ' + (l.code === cur ? c.onBorder : c.offBorder) + ';'
          + 'background:' + (l.code === cur ? c.on : c.off) + ';'
          + 'color:' + (l.code === cur ? '#fff' : c.offText) + ';">'
          + esc(l.native) + '</button>').join('')
      + '</div>'
      + '<div style="font-size:0.72rem; color:' + c.note + '; margin-top:0.4rem; text-align:center;">'
      + esc(mmT('lang.note')) + '</div>'
      + (wantSample
            ? '<div style="max-width:520px; margin:0.6rem auto 0; padding:0.6rem 0.8rem; border-radius:10px;'
              + 'background:' + c.box + '; border:1px solid ' + c.boxBorder + '; text-align:center;">'
              + '<div style="font-size:0.68rem; color:' + c.note + '; font-weight:600; margin-bottom:0.25rem;">'
              + esc(mmT('lang.preview.label')) + '</div>'
              + '<div id="' + elId + '_sample" style="font-size:0.82rem; color:' + c.boxText + '; line-height:1.5;">'
              + esc(sample) + '</div></div>'
            : '')
      + (opts.showMoved
            ? '<div style="font-size:0.72rem; color:' + c.label + '; margin-top:0.5rem; text-align:center;">'
              + esc(mmT('lang.moved')) + '</div>'
            : '');

    host.querySelectorAll('button[data-lang]').forEach(b => {
        b.onclick = () => {
            const code = b.getAttribute('data-lang');
            if (!mmSetLang(code)) return;
            /* Repaint the page's own marked-up text first, then the picker.
               On a Phase 2 page the headings and hints changing under their
               finger IS the confirmation — no toast needed, and no dependency
               on a page happening to define one. */
            try { mmApplyT(document); } catch (e) {}
            mmRenderLangPicker(elId, opts);
            if (typeof opts.onChoose === 'function') { try { opts.onChoose(code); } catch (e) {} }
        };
    });
}

/* Reflect the stored language on the <html> tag so the browser
   picks sensible fonts and hyphenation for Tamil / Devanagari. */
try { document.documentElement.setAttribute('lang', mmLang()); } catch (e) {}

/* Every page that loads lang.js gets its marked-up text translated on
   load — a page opts in by putting data-mmt on something, not by
   remembering to call this. Pages that build markup later (purchase
   line items, the shop-setup footer) call mmApplyT(el) again themselves.

   mmAdoptLang runs first so a choice made on the login screen is already
   the user's own by the time the first signed-in page paints. */
try {
    document.addEventListener('DOMContentLoaded', function () {
        try { mmAdoptLang(); } catch (e) {}
        try { document.documentElement.setAttribute('lang', mmLang()); } catch (e) {}
        try { mmApplyT(document); } catch (e) {}
    });
} catch (e) {}
