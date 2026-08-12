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
    try { return !!localStorage.getItem(_mmLangKey()); } catch (e) { return false; }
}

function mmSetLang(code) {
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
   The switch. Rendered into whatever element id is passed.
───────────────────────────────────────────────────────────── */
function mmRenderLangPicker(elId, opts) {
    const host = document.getElementById(elId);
    if (!host) return;
    opts = opts || {};
    const cur = mmLang();
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    /* A REAL warning, rendered in the chosen language. Without this the
       switch looks broken: only dialogs are translated, so the page around
       it stays English and nothing appears to happen when you click. */
    const sample = mmT('bin.empty');

    host.innerHTML =
        '<div style="display:flex; align-items:center; gap:0.55rem; flex-wrap:wrap; justify-content:center;">'
      + '<span style="font-size:0.82rem; color:#64748b; font-weight:600;">🌐 ' + esc(mmT('lang.title')) + '</span>'
      + MM_LANGS.map(l =>
            '<button type="button" data-lang="' + l.code + '" '
          + 'style="padding:0.3rem 0.75rem; border-radius:999px; cursor:pointer; font-size:0.82rem; font-weight:700;'
          + 'border:1.5px solid ' + (l.code === cur ? '#2563eb' : '#cbd5e1') + ';'
          + 'background:' + (l.code === cur ? '#2563eb' : '#fff') + ';'
          + 'color:' + (l.code === cur ? '#fff' : '#475569') + ';">'
          + esc(l.native) + '</button>').join('')
      + '</div>'
      + '<div style="font-size:0.72rem; color:#94a3b8; margin-top:0.4rem; text-align:center;">'
      + esc(mmT('lang.note')) + '</div>'
      + '<div style="max-width:520px; margin:0.6rem auto 0; padding:0.6rem 0.8rem; border-radius:10px;'
      + 'background:#f8fafc; border:1px solid #e2e8f0; text-align:center;">'
      + '<div style="font-size:0.68rem; color:#94a3b8; font-weight:600; margin-bottom:0.25rem;">'
      + esc(mmT('lang.preview.label')) + '</div>'
      + '<div id="' + elId + '_sample" style="font-size:0.82rem; color:#334155; line-height:1.5;">'
      + esc(sample) + '</div></div>'
      + (opts.showMoved
            ? '<div style="font-size:0.72rem; color:#64748b; margin-top:0.5rem; text-align:center;">'
              + esc(mmT('lang.moved')) + '</div>'
            : '');

    host.querySelectorAll('button[data-lang]').forEach(b => {
        b.onclick = () => {
            const code = b.getAttribute('data-lang');
            if (!mmSetLang(code)) return;
            /* Re-render in the new language. The sample sentence changing
               under their finger IS the confirmation — no toast needed, and
               no dependency on a page happening to define one. */
            mmRenderLangPicker(elId, opts);
            if (typeof opts.onChoose === 'function') { try { opts.onChoose(code); } catch (e) {} }
        };
    });
}

/* Reflect the stored language on the <html> tag so the browser
   picks sensible fonts and hyphenation for Tamil / Devanagari. */
try { document.documentElement.setAttribute('lang', mmLang()); } catch (e) {}
