/**
 * drug-master.js -- Billware Global Drug Master
 * Two-layer search:
 *   1. Built-in seed list (200+ common Indian medicines, works offline)
 *   2. Supabase drug_master table (full list, optional)
 * Exposes: window.DrugMaster.init(inputEl, lineItemEl)
 */
(function () {

    /* ---- SEED LIST: [name, manufacturer, gst%, pack, hsn, schedule] ---- */
    const SEED = [
        // Analgesics / Antipyretics
        ['Dolo 650','Micro Labs',12,15,'30049099','OTC'],
        ['Dolo 250 Suspension','Micro Labs',12,60,'30049099','OTC'],
        ['Calpol 500','GSK',12,15,'30049099','OTC'],
        ['Calpol 650','GSK',12,15,'30049099','OTC'],
        ['Calpol Suspension','GSK',12,60,'30049099','OTC'],
        ['Paracetamol 500mg','Generic',12,10,'30049099','OTC'],
        ['Combiflam','Sanofi',12,20,'30049099','OTC'],
        ['Brufen 400','Abbott',12,15,'30049099','H'],
        ['Meftal Spas','Blue Cross',12,10,'30049099','H'],
        ['Meftal P','Blue Cross',12,10,'30049099','H'],
        ['Voveran 50','Novartis',12,10,'30049099','H'],
        ['Diclofenac 50mg','Generic',12,10,'30049099','H'],
        ['Dolonex DT','Pfizer',12,10,'30049099','H'],
        ['Zerodol P','Ipca',12,10,'30049099','H'],
        ['Zerodol SP','Ipca',12,10,'30049099','H'],
        ['Hifenac P','Intas',12,10,'30049099','H'],
        ['Ultracet','J&J',12,10,'30049099','H'],
        ['Tramadol 50mg','Generic',12,10,'30049099','H1'],
        // Antibiotics
        ['Augmentin 625','GSK',12,10,'30041020','H'],
        ['Augmentin 1g','GSK',12,6,'30041020','H'],
        ['Augmentin ES Syrup','GSK',12,70,'30041020','H'],
        ['Amoxicillin 500mg','Generic',12,10,'30041020','H'],
        ['Azithral 500','Alembic',12,3,'30041020','H'],
        ['Azithromycin 500mg','Generic',12,3,'30041020','H'],
        ['Cifran 500','Sun Pharma',12,10,'30041090','H'],
        ['Cifran OD 1000','Sun Pharma',12,5,'30041090','H'],
        ['Ciprofloxacin 500mg','Generic',12,10,'30041090','H'],
        ['Oflox 200','Cipla',12,10,'30041090','H'],
        ['Norflox 400','Cipla',12,10,'30041090','H'],
        // Taxim-O is cefixime — H1, and the brand name does not say so.
        ['Taxim O 200','Alkem',12,10,'30041090','H1'],
        ['Taxim O 100 Syrup','Alkem',12,50,'30041090','H1'],
        ['Clavam 625','Alembic',12,10,'30041020','H'],
        ['Doxycycline 100mg','Generic',12,10,'30041020','H'],
        ['Metronidazole 400mg','Generic',12,15,'30041090','H'],
        ['Flagyl 400','Abbott',12,15,'30041090','H'],
        ['Tinidazole 500mg','Generic',12,10,'30041090','H'],
        // Antacids / GI
        ['Pan 40','Alkem',12,15,'30049099','H'],
        ['Pan D','Alkem',12,15,'30049099','H'],
        ['Pantop 40','Aristo',12,15,'30049099','H'],
        ['Pantoprazole 40mg','Generic',12,15,'30049099','H'],
        ['Omez 20','Dr Reddys',12,15,'30049099','H'],
        ['Omeprazole 20mg','Generic',12,15,'30049099','H'],
        ['Nexpro 40','Torrent',12,15,'30049099','H'],
        ['Rablet 20','Lupin',12,15,'30049099','H'],
        ['Razo 20','Sun Pharma',12,15,'30049099','H'],
        ['Gelusil MPS','Pfizer',12,170,'30049099','OTC'],
        ['Digene Syrup','Abbott',12,200,'30049099','OTC'],
        ['Rantac 150','J&J',12,10,'30049099','H'],
        ['Ranitidine 150mg','Generic',12,10,'30049099','H'],
        ['Domperidone 10mg','Generic',12,10,'30049099','H'],
        ['Ondansetron 4mg','Generic',12,10,'30049099','H'],
        ['Emeset 4mg','Cipla',12,10,'30049099','H'],
        ['Aristozyme Syrup','Aristo',12,200,'30049099','OTC'],
        ['Cremaffin Syrup','Abbott',12,225,'30049099','OTC'],
        ['Dulcolax 5mg','Sanofi',12,20,'30049099','OTC'],
        ['Imodium 2mg','J&J',12,6,'30049099','OTC'],
        // Antiallergics
        ['Allegra 120','Sanofi',12,10,'30049099','H'],
        ['Allegra 180','Sanofi',12,10,'30049099','H'],
        ['Cetirizine 10mg','Generic',12,10,'30049099','OTC'],
        ['Cetzine 10mg','Dr Reddys',12,10,'30049099','OTC'],
        ['Levocetirizine 5mg','Generic',12,10,'30049099','H'],
        ['Montair LC','Cipla',12,10,'30049099','H'],
        ['Montek LC','Sun Pharma',12,10,'30049099','H'],
        ['Phenergan 10mg','Sanofi',12,15,'30049099','H'],
        ['Avil 25mg','Sanofi',12,20,'30049099','H'],
        // Cough / Cold
        ['Benadryl Cough Syrup','J&J',12,100,'30049099','OTC'],
        ['Alex Syrup','Glenmark',12,100,'30049099','OTC'],
        ['Grilinctus Syrup','Franco-Indian',12,100,'30049099','OTC'],
        ['Ascoril Syrup','Glenmark',12,100,'30049099','H'],
        ['Asthalin Syrup','Cipla',12,100,'30049099','H'],
        ['Mucinac 600','Cipla',12,10,'30049099','H'],
        ['Nasivion Nasal Drops','Merck',12,10,'30049099','OTC'],
        ['Otrivin Nasal Spray','Novartis',12,1,'30049099','OTC'],
        // Vitamins
        ['Becosules Z','Pfizer',5,20,'30049099','OTC'],
        ['Becosules Capsules','Pfizer',5,20,'30049099','OTC'],
        ['Limcee 500mg','Abbott',5,15,'30049099','OTC'],
        ['Vitamin C 500mg','Generic',5,10,'30049099','OTC'],
        ['Evion 400','Merck',5,10,'30049099','OTC'],
        ['Shelcal 500','Torrent',5,15,'30049099','OTC'],
        ['Calcium Sandoz','Novartis',5,15,'30049099','OTC'],
        ['Supradyn','Bayer',5,15,'30049099','OTC'],
        ['Revital H','Sun Pharma',18,30,'21069099','OTC'],
        ['Zincovit','Apex',5,15,'30049099','OTC'],
        ['Neurobion Forte','Merck',5,30,'30049099','OTC'],
        ['Methylcobalamin 500mcg','Generic',5,10,'30049099','H'],
        ['Mecobal 500','Sun Pharma',5,10,'30049099','H'],
        ['Folvite 5mg','Pfizer',5,20,'30049099','OTC'],
        ['Iron Folic Acid','Generic',5,30,'30049099','OTC'],
        ['Ferrous Sulfate 200mg','Generic',5,30,'30049099','OTC'],
        // Diabetes
        ['Metformin 500mg','Generic',12,10,'30049099','H'],
        ['Glucophage 500','Merck',12,10,'30049099','H'],
        ['Glycomet 500','USV',12,20,'30049099','H'],
        ['Glimepiride 1mg','Generic',12,10,'30049099','H'],
        ['Amaryl 1mg','Sanofi',12,30,'30049099','H'],
        ['Januvia 100','MSD',12,14,'30049099','H'],
        ['Galvus 50','Novartis',12,14,'30049099','H'],
        ['Vildagliptin 50mg','Generic',12,14,'30049099','H'],
        ['Human Mixtard 30/70','Novo Nordisk',5,3,'30043100','H'],
        ['Huminsulin N','Eli Lilly',5,3,'30043100','H'],
        ['Lantus','Sanofi',5,3,'30043100','H'],
        // Antihypertensives
        ['Amlodipine 5mg','Generic',12,10,'30049099','H'],
        ['Amlong 5','Micro Labs',12,10,'30049099','H'],
        ['Stamlo 5','Dr Reddys',12,10,'30049099','H'],
        ['Telma 40','Glenmark',12,14,'30049099','H'],
        ['Telmisartan 40mg','Generic',12,14,'30049099','H'],
        ['Losartan 50mg','Generic',12,10,'30049099','H'],
        ['Atenolol 50mg','Generic',12,14,'30049099','H'],
        ['Metoprolol 25mg','Generic',12,14,'30049099','H'],
        ['Enalapril 5mg','Generic',12,14,'30049099','H'],
        ['Ramipril 5mg','Generic',12,14,'30049099','H'],
        ['Cardace 5','Sanofi',12,14,'30049099','H'],
        ['Concor 2.5','Merck',12,14,'30049099','H'],
        ['Olsar 20','Sun Pharma',12,14,'30049099','H'],
        // Thyroid
        ['Thyronorm 25mcg','Abbott',5,120,'30049099','H'],
        ['Thyronorm 50mcg','Abbott',5,120,'30049099','H'],
        ['Thyronorm 100mcg','Abbott',5,120,'30049099','H'],
        ['Eltroxin 100mcg','GSK',5,30,'30049099','H'],
        ['Thyroxine 25mcg','Generic',5,30,'30049099','H'],
        // Steroids / Respiratory
        ['Betnesol 0.5mg','GSK',12,20,'30049099','H'],
        ['Prednisolone 5mg','Generic',12,10,'30049099','H'],
        ['Wysolone 5','Pfizer',12,30,'30049099','H'],
        ['Dexamethasone 0.5mg','Generic',12,10,'30049099','H'],
        ['Asthalin Inhaler','Cipla',12,1,'30043990','H'],
        ['Seroflo 250 Inhaler','Cipla',12,1,'30043990','H'],
        ['Budecort 200 Inhaler','Cipla',12,1,'30043990','H'],
        ['Foracort 200 Inhaler','Cipla',12,1,'30043990','H'],
        ['Duolin Inhaler','Cipla',12,1,'30043990','H'],
        ['Montair 10','Cipla',12,10,'30049099','H'],
        ['Montelukast 10mg','Generic',12,10,'30049099','H'],
        ['Levolin Syrup','Cipla',12,60,'30049099','H'],
        // Antifungals
        ['Fluconazole 150mg','Generic',12,1,'30049099','H'],
        ['Zocon 150','FDC',12,1,'30049099','H'],
        ['Terbinafine 250mg','Generic',12,7,'30049099','H'],
        ['Terbicip 250','Cipla',12,7,'30049099','H'],
        ['Itraconazole 100mg','Generic',12,10,'30049099','H'],
        ['Candiforce 100','Mankind',12,14,'30049099','H'],
        // Eye / Ear
        ['Ciprofloxacin Eye Drops','Generic',12,5,'30049099','H'],
        ['Ciplox Eye Drops','Cipla',12,5,'30049099','H'],
        ['Tobramycin Eye Drops','Generic',12,5,'30049099','H'],
        ['Lubrifresh Eye Drops','Allergan',12,10,'30049099','OTC'],
        ['Refresh Tears','Allergan',12,10,'30049099','OTC'],
        ['Otosporin Ear Drops','GSK',12,5,'30049099','H'],
        ['Sofradex Ear Drops','Sanofi',12,5,'30049099','H'],
        // Skin / Topical
        ['Betadine Ointment','Mundipharma',12,1,'30049099','OTC'],
        ['Betadine Solution','Mundipharma',12,1,'30049099','OTC'],
        ['Soframycin Cream','Sanofi',12,1,'30049099','OTC'],
        ['Fucidin Cream','LEO Pharma',12,1,'30049099','H'],
        ['Bactroban Ointment','GSK',12,1,'30049099','H'],
        ['Calamine Lotion','Generic',12,1,'30049099','OTC'],
        // Psychiatric / Neurological
        ['Sertraline 50mg','Generic',12,10,'30049099','H'],
        ['Serta 50','Sun Pharma',12,10,'30049099','H'],
        ['Escitalopram 10mg','Generic',12,10,'30049099','H'],
        ['Nexito 10','Sun Pharma',12,10,'30049099','H'],
        // Alprazolam and clonazepam are both Schedule H1, not plain H.
        ['Alprazolam 0.25mg','Generic',12,10,'30049099','H1'],
        ['Alprax 0.25','Torrent',12,10,'30049099','H1'],
        ['Clonazepam 0.5mg','Generic',12,10,'30049099','H1'],
        ['Gabapentin 300mg','Generic',12,10,'30049099','H'],
        ['Gabapin 300','Intas',12,10,'30049099','H'],
        ['Pregabalin 75mg','Generic',12,10,'30049099','H'],
        ['Lyrica 75','Pfizer',12,14,'30049099','H'],
        // Cardiac
        ['Ecosprin 75','USV',12,14,'30049099','H'],
        ['Aspirin 75mg','Generic',12,14,'30049099','H'],
        ['Clopidogrel 75mg','Generic',12,10,'30049099','H'],
        ['Atorvastatin 10mg','Generic',12,10,'30049099','H'],
        ['Atorvas 10','Cipla',12,10,'30049099','H'],
        ['Rosuvastatin 10mg','Generic',12,10,'30049099','H'],
        ['Rozucor 10','Cipla',12,10,'30049099','H'],
        ['Crestor 10','AstraZeneca',12,14,'30049099','H'],
        ['Lasix 40','Sanofi',12,30,'30049099','H'],
        ['Furosemide 40mg','Generic',12,30,'30049099','H'],
        // ORS / Supplements
        ['Electral Powder','FDC',5,21.8,'30049099','OTC'],
        ['ORS Sachet','Generic',5,1,'30049099','OTC'],
    ];

    const _seedMap = new Map();
    const _seedList = SEED.map(([name,manufacturer,gst,pack,hsn,schedule]) => {
        const obj = {name,manufacturer,gst,pack,hsn,schedule};
        _seedMap.set(name.toLowerCase(), obj);
        return obj;
    });

    /* ── Name normalisation, and why schedule lookup cannot be an exact match ──
       A shop types "AZITHRAL 500 TAB"; the seed row is "Azithral 500". An exact
       map lookup misses on the trailing " TAB" alone, returns '', and the till
       decides the drug is not Schedule H — so the sale is billed and no OUT
       entry reaches the register. Found 2026-08-10: the H chip stayed grey on
       azithromycin, which is unambiguously Schedule H and IS in this seed.

       Normalising strips what never changes a drug's schedule: the dosage form
       ("tab", "cap", "syrup"), the strength unit ("500mg" -> "500"), packaging
       words and punctuation. Schedule is a property of the molecule, not of the
       pack you happen to stock.

       Direction matters: we test whether the TYPED name starts with a seed
       name, never the reverse. "azithral 500 tab" starts with "azithral 500" is
       a real match; the reverse would let a two-letter entry match everything.

       Erring inclusive is deliberate. A false positive puts an extra row in the
       H register, which is noise the operator can untick on the chip. A false
       negative is a Schedule H sale with no register entry — the thing the
       register exists to prevent. */
    /* ── SCHEDULE H1 ──────────────────────────────────────────────────────────
       H1 is a stricter subset of Schedule H: a SEPARATE bound register, kept
       three years, with the prescriber's details mandatory. Before this the seed
       carried exactly ONE H1 drug (Tramadol) against a real list of ~46, and
       matched it by exact product name — so cefixime, ceftriaxone, levofloxacin
       and the whole anti-TB set were being dispensed as ordinary Schedule H.

       Matched by SUBSTRING on the molecule, like _SCHEDULE_X and for the same
       reason: H1 attaches to the molecule, not to a brand or a strength. A shop
       stocking "Cefixime 200 DT" or "Zifi 200 (cefixime)" is caught without
       anybody enumerating brands. These names are long and distinctive, so a
       substring test carries no realistic false-positive risk.

       Brands that do NOT name their molecule still need a seed row — Taxim-O is
       cefixime and is tagged H1 below.

       DELIBERATELY NOT INCLUDED, because they are Schedule H and not H1:
       ciprofloxacin, ofloxacin, norfloxacin, azithromycin, amoxicillin-
       clavulanate. Only the newer fluoroquinolones are H1.

       ⚠️ Schedule H1 is amended by gazette notification. This list should be
       checked against the current schedule by the pharmacist rather than
       trusted indefinitely. */
    const _SCHEDULE_H1 = [
        // Habit-forming / psychotropic
        'alprazolam','buprenorphine','chlordiazepoxide','clonazepam','codeine',
        'diazepam','diphenoxylate','midazolam','nitrazepam','pentazocine',
        'tramadol','zolpidem',
        // 3rd / 4th generation cephalosporins
        'cefdinir','cefditoren','cefepime','cefetamet','cefixime','cefoperazone',
        'cefotaxime','cefpirome','cefpodoxime','ceftazidime','ceftibuten',
        'ceftizoxime','ceftriaxone',
        // Carbapenems and related
        'doripenem','ertapenem','faropenem','feropenem','imipenem','meropenem',
        // Newer fluoroquinolones (NOT cipro/oflox/norflox — those stay H)
        'balofloxacin','gatifloxacin','gemifloxacin','levofloxacin','moxifloxacin',
        'prulifloxacin','sparfloxacin',
        // Anti-tubercular
        'capreomycin','clofazimine','cycloserine','ethambutol','ethionamide',
        'isoniazid','pyrazinamide','rifabutin','rifampicin','rifampin',
        'aminosalicylate','thiacetazone'
    ];

    const _FORMS = new Set(['tab','tabs','tablet','tablets','cap','caps','capsule',
        'capsules','syp','syrup','susp','suspension','inj','injection','drop','drops',
        'cream','ointment','oint','gel','lotion','sachet','powder','solution','soln',
        'spray','tube','strip','bottle','vial','amp','ampoule','kit','md','od']);

    function normName(s) {
        let t = String(s || '').toLowerCase();
        t = t.replace(/[^a-z0-9\s.]/g, ' ');          // punctuation -> space
        t = t.replace(/(\d)\s*(mg|mcg|ml|gm|g|iu|mu)\b/g, '$1');  // 500mg -> 500
        const parts = t.split(/\s+/).filter(w => w && !_FORMS.has(w));
        return parts.join(' ').trim();
    }

    // normalised name -> schedule, built once. First entry wins so an explicit
    // seed row is never overwritten by a later, vaguer one.
    const _normSchedule = new Map();
    _seedList.forEach(o => {
        const k = normName(o.name);
        if (k && !_normSchedule.has(k)) _normSchedule.set(k, o.schedule || '');
    });
    // Longest first, so "pan d" is tested before "pan" and wins.
    const _normKeys = Array.from(_normSchedule.keys()).sort((a, b) => b.length - a.length);

    function _debounce(fn, ms) {
        let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
    }

    async function search(query, limit=10) {
        const q = (query||'').trim().toLowerCase();
        if (q.length < 2) return [];
        
        // 1. Local Storage (Custom imports & past purchases)
        const customMeds = [];
        try {
            const ml = JSON.parse(localStorage.getItem('mm_medicine_list')||'[]');
            ml.forEach(n => { if (typeof n==='string' && n.toLowerCase().includes(q)) customMeds.push({name: n}); });
            const pu = JSON.parse(localStorage.getItem('mm_purchases')||'[]');
            pu.forEach(p => { if (p.productName && p.productName.toLowerCase().includes(q)) customMeds.push({name: p.productName, gst: p.gst||'', pack: p.pack||''}); });
        } catch(e){}

        // 2. Seed List
        const sw = _seedList.filter(m => m.name.toLowerCase().startsWith(q));
        const co = _seedList.filter(m => !m.name.toLowerCase().startsWith(q) && m.name.toLowerCase().includes(q));
        
        let results = [...customMeds, ...sw, ...co];
        
        // Deduplicate by lowercase name
        const seen = new Set();
        results = results.filter(r => {
            const ln = r.name.toLowerCase();
            if (seen.has(ln)) return false;
            seen.add(ln);
            return true;
        }).slice(0, limit);

        // 3. Supabase fallback
        try {
            if (typeof _supabase !== 'undefined' && navigator.onLine && results.length < limit) {
                const {data} = await _supabase
                    .from('drug_master')
                    .select('name,manufacturer,gst_percent,pack,hsn_code,schedule')
                    .ilike('name', `${query.trim()}%`)
                    .order('name').limit(limit);
                if (data && data.length) {
                    const sb = data.filter(d=>!seen.has((d.name||'').toLowerCase()))
                        .map(d=>({name:d.name, manufacturer:d.manufacturer||'', gst:d.gst_percent||12, pack:d.pack||'', hsn:d.hsn_code||'', schedule:d.schedule||''}));
                    results = [...results,...sb].slice(0,limit);
                }
            }
        } catch(e){}
        return results;
    }

    async function getByName(name) {
        const lower = (name||'').trim().toLowerCase();
        if (_seedMap.has(lower)) return _seedMap.get(lower);
        try {
            if (typeof _supabase !== 'undefined' && navigator.onLine) {
                const {data} = await _supabase.from('drug_master')
                    .select('name,manufacturer,gst_percent,pack,hsn_code,schedule')
                    .ilike('name', name.trim()).limit(1);
                if (data && data[0]) return {name:data[0].name,manufacturer:data[0].manufacturer||'',gst:data[0].gst_percent||12,pack:data[0].pack||'',hsn:data[0].hsn_code||'',schedule:data[0].schedule||''};
            }
        } catch(e){}
        return null;
    }

    function _injectStyles() {
        if (document.getElementById('dm-styles')) return;
        const s = document.createElement('style');
        s.id = 'dm-styles';
        s.textContent = `
            .dm-dropdown{position:fixed;z-index:99999;background:white;border:1.5px solid #e2e8f0;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,0.16);min-width:280px;max-width:440px;overflow:hidden;font-family:'Inter',sans-serif;}
            .dm-item{padding:10px 14px;cursor:pointer;border-bottom:1px solid #f8fafc;display:flex;flex-direction:column;gap:3px;transition:background 0.1s;}
            .dm-item:last-child{border-bottom:none;}
            .dm-item:hover,.dm-item.focused{background:#f0f9ff;}
            .dm-name{font-weight:700;font-size:0.88rem;color:#0f172a;}
            .dm-name mark{background:#fef9c3;color:#92400e;border-radius:3px;padding:0 2px;font-weight:800;}
            .dm-meta{font-size:0.73rem;color:#64748b;display:flex;gap:7px;align-items:center;flex-wrap:wrap;}
            .dm-badge{font-size:0.64rem;font-weight:800;padding:1px 6px;border-radius:8px;text-transform:uppercase;letter-spacing:.05em;}
            .dm-gst{background:#dcfce7;color:#166534;}
            .dm-sch-h{background:#fee2e2;color:#991b1b;}
            .dm-sch-otc{background:#dbeafe;color:#1e40af;}
            .dm-sch-h1{background:#fef3c7;color:#92400e;}
        `;
        document.head.appendChild(s);
    }

    function _highlight(text, query) {
        const idx = text.toLowerCase().indexOf(query.toLowerCase());
        if (idx < 0) return text;
        return text.slice(0,idx)+'<mark>'+text.slice(idx,idx+query.length)+'</mark>'+text.slice(idx+query.length);
    }

    function init(inputEl, lineEl) {
        _injectStyles();
        let dd=null, focusedIdx=-1;

        function removeDd(){ if(dd){dd.remove();dd=null;} focusedIdx=-1; }

        function moveFocus(dir){
            if(!dd) return;
            const items=dd.querySelectorAll('.dm-item');
            items.forEach(i=>i.classList.remove('focused'));
            focusedIdx=(focusedIdx+dir+items.length)%items.length;
            items[focusedIdx]?.classList.add('focused');
            items[focusedIdx]?.scrollIntoView({block:'nearest'});
        }

        function selectMedicine(med){
            inputEl.value=med.name;
            const gstEl=lineEl.querySelector('.li-gst');
            if(gstEl && med.gst){ gstEl.value=med.gst; gstEl.dispatchEvent(new Event('input',{bubbles:true})); }
            const hsnEl=lineEl.querySelector('.li-hsn');
            if(hsnEl && med.hsn){ hsnEl.value=med.hsn; }
            // Pack size is intentionally NOT auto-filled to prevent inventory errors.
            // It is only shown in the dropdown as a helpful hint.
            removeDd();
            const batchEl=lineEl.querySelector('.li-batchNo');
            if(batchEl) setTimeout(()=>batchEl.focus(),50);
        }

        async function showDd(query){
            removeDd();
            const results=await search(query);
            if(!results.length) return;
            const rect=inputEl.getBoundingClientRect();
            dd=document.createElement('div');
            dd.className='dm-dropdown';
            dd.style.cssText=`top:${rect.bottom+4}px;left:${rect.left}px;width:${Math.max(rect.width,290)}px;`;
            results.forEach(med=>{
                const item=document.createElement('div');
                item.className='dm-item';
                const schCls=med.schedule==='OTC'?'dm-sch-otc':med.schedule==='H1'?'dm-sch-h1':'dm-sch-h';
                item.innerHTML=`<span class="dm-name">${_highlight(med.name,query)}</span>
                    <span class="dm-meta">
                        ${med.manufacturer?`<span>${med.manufacturer}</span>`:''}
                        ${med.gst?`<span class="dm-badge dm-gst">GST ${med.gst}%</span>`:''}
                        ${med.schedule?`<span class="dm-badge ${schCls}">${med.schedule}</span>`:''}
                    </span>`;
                item.addEventListener('mousedown',e=>{e.preventDefault();selectMedicine(med);});
                dd.appendChild(item);
            });
            document.body.appendChild(dd);
        }

        const debouncedSearch=_debounce(async(val)=>{ if(val.length>=2) await showDd(val); else removeDd(); },220);

        inputEl.addEventListener('input',e=>debouncedSearch(e.target.value));
        inputEl.addEventListener('keydown',e=>{
            if(!dd) return;
            if(e.key==='ArrowDown'){e.preventDefault();moveFocus(1);}
            if(e.key==='ArrowUp'){e.preventDefault();moveFocus(-1);}
            if(e.key==='Enter'||e.key==='Tab'){const f=dd?.querySelector('.dm-item.focused')||dd?.querySelector('.dm-item');if(f){e.preventDefault();f.dispatchEvent(new MouseEvent('mousedown'));}}
            if(e.key==='Escape') removeDd();
        });
        inputEl.addEventListener('blur',()=>setTimeout(removeDd,180));
        inputEl.addEventListener('change',async e=>{
            const med=await getByName(e.target.value);
            if(med){const g=lineEl.querySelector('.li-gst');if(g&&med.gst&&!g.value){g.value=med.gst;g.dispatchEvent(new Event('input',{bubbles:true}));}
                const h=lineEl.querySelector('.li-hsn');if(h&&med.hsn&&!h.value){h.value=med.hsn;}}
        });
    }

    // Well-established Schedule X (narcotic/psychotropic) molecules. Matched as a
    // substring so "Methylphenidate 10mg" etc. are caught. Conservative on purpose —
    // extend with the shop's actual products rather than risk mis-classifying.
    // ('barbital' alone is deliberately excluded — phenobarbital is Schedule H, not X.)
    var _SCHEDULE_X = [
        'amobarbital','pentobarbital','secobarbital','cyclobarbital',
        'methaqualone','meprobamate','glutethimide',
        'methylphenidate','methamphetamine','dexamphetamine','amphetamine'
    ];

    // Sync, seed-only schedule lookup (no network) — returns 'X' | 'OTC' | 'H' | 'H1' | ''.
    // Used to flag Schedule H/H1/X drugs during billing/purchase without a query storm.
    function scheduleOf(name){
        var nm = (name||'').trim().toLowerCase();
        if(!nm) return '';
        // Schedule X first — strictest class, and these are distinctive molecule
        // names so a substring test is safe.
        for(var i=0;i<_SCHEDULE_X.length;i++){ if(nm.indexOf(_SCHEDULE_X[i]) >= 0) return 'X'; }
        /* H1 next, and BEFORE the seed lookup on purpose. A seed row tagged
           plain 'H' whose name carries an H1 molecule must come back H1 — the
           stricter class wins, exactly as X wins over both. Getting this order
           wrong would let a stale seed tag quietly downgrade a drug that needs
           the three-year register. */
        for(var h=0;h<_SCHEDULE_H1.length;h++){ if(nm.indexOf(_SCHEDULE_H1[h]) >= 0) return 'H1'; }
        // 1. Exact, as before — cheapest and unambiguous.
        var m = _seedMap.get(nm);
        if (m) return m.schedule || '';
        // 2. Normalised exact: "AZITHRAL 500 TAB" == "Azithral 500".
        var key = normName(nm);
        if (!key) return '';
        if (_normSchedule.has(key)) return _normSchedule.get(key);
        // 3. Normalised prefix: the typed name STARTS WITH a seed name, on a
        //    word boundary so "pan" cannot match "pantoprazole". Longest key
        //    first, so the most specific seed row wins.
        for (var j = 0; j < _normKeys.length; j++) {
            var k = _normKeys[j];
            if (key === k || key.indexOf(k + ' ') === 0) return _normSchedule.get(k);
        }
        return '';
    }

    window.DrugMaster={search,getByName,scheduleOf,normName,init};
})();
