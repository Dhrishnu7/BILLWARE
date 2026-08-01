/* ══════════════════════════════════════════════════════════════════════
   med-names.js  —  a starting vocabulary of Indian pharmacy brands
   ══════════════════════════════════════════════════════════════════════
   ocr-names.js corrects a scanned product name against the names the shop
   already buys, which is the right corpus: it is free, it is exactly this
   pharmacy's range, and it grows on its own.

   It is also EMPTY ON DAY ONE. A shop that has just signed up has bought
   nothing yet, so the matcher has nothing to match against and every
   misread name stays misread — which is precisely when a new user is
   deciding whether the scanning is worth using at all. Measured on a real
   first invoice: AZITHRAL read as "AZTHRAL", TAXIM O 200 as "TaXiM 0 200",
   MEFTAL SPAS as "MEFTALS". All three are in this list.

   This is a FALLBACK, never a replacement. The shop's own history is tried
   first and wins outright; this list is only consulted when that finds
   nothing, and at a higher bar, because a national brand list is a much
   larger haystack than one pharmacy's shelf and a loose match against it is
   how you would end up buying a drug the shop has never stocked.

   Strengths are deliberately left off most entries. ocr-names.js treats
   digits as identity and never rewrites them, so "DOLO" here will correct
   the letters of "D0L0 650" and leave the 650 exactly as printed.

   ES5, so the headless harness can drive it.
────────────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    var COMMON = [
        /* analgesics / antipyretics */
        'DOLO', 'CROCIN', 'CALPOL', 'METACIN', 'PARACIP', 'PACIMOL', 'SUMO',
        'COMBIFLAM', 'BRUFEN', 'IBUGESIC', 'FLEXON', 'DISPRIN', 'SARIDON',
        'MEFTAL', 'MEFTAL SPAS', 'MEFTAL FORTE', 'SPASMONIL', 'CYCLOPAM',
        'ZERODOL', 'ZERODOL SP', 'ZERODOL P', 'ZERODOL MR', 'ZERODOL TH',
        'VOVERAN', 'DICLOMOL', 'NISE', 'NIMULID', 'ULTRACET', 'TRAMADOL',
        'ETOSHINE', 'HIFENAC', 'ACECLOFENAC', 'ENZOFLAM', 'CHYMORAL',
        'VOLINI', 'MOOV', 'OMNIGEL',

        /* antibiotics */
        'AUGMENTIN', 'MOXIKIND CV', 'CLAVAM', 'ADVENT', 'MOX', 'NOVAMOX',
        'AMOXYCLAV', 'MEGAPEN', 'AMPILOX',
        'AZITHRAL', 'AZEE', 'AZIWOK', 'ZATHRIN', 'AZIMAX',
        'CIFRAN', 'CIPLOX', 'CIPROBID', 'CIFLOX',
        'TAXIM', 'TAXIM O', 'ZIFI', 'CEFIX', 'OMNATAX', 'MAHACEF', 'TAXIM AZ',
        'CEFTUM', 'ZINETAC', 'ALTACEF', 'ZOCEF', 'PULMOCEF',
        'MONOCEF', 'ROSEPT', 'OFLOX', 'ZANOCIN', 'O2', 'NORFLOX',
        'DOXT', 'DOXY', 'MINICYCLINE', 'FLAGYL', 'METROGYL', 'ORNIDAZOLE',
        'ZENFLOX', 'LEVOFLOX', 'LEVOFLOXACIN', 'LOXOF', 'GLEVO',
        'CLINDAC A', 'DALACIN', 'LINEZOLID', 'LIZOLID', 'VANCOMYCIN',
        'RIFAGUT', 'AKT', 'RCINEX',

        /* acidity / gastro */
        'PAN', 'PAN D', 'PANTOCID', 'PANTOP', 'PANTODAC', 'PENTAB',
        'OMEZ', 'OMEZ D', 'OCID', 'OMEPRAZOLE',
        'RAZO', 'RABIUM', 'RABEPRAZOLE', 'HAPPI', 'CYRA',
        'NEXPRO', 'ESOMEPRAZOLE', 'SOMPRAZ', 'ESOZ',
        'ZINETAC', 'RANTAC', 'ACILOC', 'FAMOCID',
        'GELUSIL', 'DIGENE', 'ENO', 'CREMAFFIN', 'DUPHALAC', 'LOOZ',
        'ONDEM', 'EMESET', 'PERINORM', 'DOMSTAL', 'VOMIKIND',
        'NORMAXIN', 'LIBRAX', 'COLOSPA', 'DROTIN', 'MEFTAL SPAS',
        'ELDOPER', 'LOMOTIL', 'SPOROLAC', 'VIZYLAC', 'ECONORM',
        'UDILIV', 'LIV 52', 'HEPAMERZ',

        /* diabetes */
        'GLYCOMET', 'METFORMIN', 'GLUCOPHAGE', 'OBIMET',
        'AMARYL', 'GLIMISAVE', 'GLIMY', 'ZORYL', 'GLYCIPHAGE',
        'JANUVIA', 'ISTAMET', 'GALVUS', 'GALVUS MET', 'ZOMELIS',
        'JARDIANCE', 'DAPA', 'FORXIGA', 'GLUCONORM', 'DIAMICRON',
        'HUMAN MIXTARD', 'LANTUS', 'HUMALOG', 'NOVORAPID',

        /* cardiac / BP / lipids */
        'TELMA', 'TELMA H', 'TELMISARTAN', 'TELVAS', 'TELSAR',
        'AMLONG', 'AMLODAC', 'AMLOPRES', 'STAMLO',
        'LOSAR', 'LOSACAR', 'REPACE', 'OLMESAR', 'OLMAT',
        'ENVAS', 'ECOSPRIN', 'CLOPILET', 'DEPLATT', 'CLOPITAB',
        'ATORVA', 'STORVAS', 'LIPICURE', 'ROSUVAS', 'ROSULIP', 'CRESTOR',
        'CONCOR', 'METOLAR', 'BETALOC', 'CARDIVAS', 'DILZEM',
        'DYTOR', 'LASIX', 'ALDACTONE', 'NITROCONTIN',

        /* respiratory / allergy */
        'MONTAIR', 'MONTAIR LC', 'MONTEK', 'MONTEK LC', 'ODIMONT',
        'ALLEGRA', 'FEXOVA', 'CETRIZINE', 'CETZINE', 'ALERID',
        'AVIL', 'ATARAX', 'TEZINE', 'LEVOCET', 'LCZ',
        'ASTHALIN', 'ASTHALIN HFA', 'DUOLIN', 'FORACORT', 'SEROFLO',
        'BUDECORT', 'DERIPHYLLIN', 'AEROCORT', 'LEVOLIN',
        'ASCORIL', 'GRILINCTUS', 'BENADRYL', 'CHERICOF', 'ALEX',
        'SINAREST', 'CHESTON COLD', 'COLDARIN', 'OTRIVIN', 'NASIVION',
        'WIKORYL', 'SOLVIN', 'MUCINAC', 'MUCOLITE',

        /* steroids / anti-inflammatory */
        'OMNACORTIL', 'WYSOLONE', 'MEDROL', 'DEFCORT', 'DEFZA',
        'BETNESOL', 'DEXONA', 'PREDNISOLONE',

        /* vitamins / supplements */
        'BECOSULES', 'NEUROBION', 'NEUROBION FORTE', 'ZINCOVIT', 'A TO Z',
        'SHELCAL', 'CALCIMAX', 'OSTOCALCIUM', 'CCM', 'GEMCAL',
        'LIMCEE', 'CELIN', 'REDOXON', 'VITCOFOL',
        'DEXORANGE', 'AUTRIN', 'FEFOL', 'ORROFER', 'LIVOGEN', 'FERIUM',
        'FOLVITE', 'MECOBALAMIN', 'NUROKIND', 'METHYCOBAL',
        'UPRISE D3', 'CALCIROL', 'D RISE', 'ARACHITOL',
        'SUPRADYN', 'REVITAL', 'POLYBION',

        /* thyroid / hormones */
        'THYRONORM', 'ELTROXIN', 'THYROX', 'LETHYROX',
        'DUPHASTON', 'SUSTEN', 'REGESTRONE', 'MEPRATE', 'KRIMSON',

        /* urology / others */
        'URIMAX', 'VELTAM', 'FLOMAX', 'DYNAPRES',
        'CYSTONE', 'NEERI', 'ALKASOL', 'CITRALKA',
        'ZYLORIC', 'FEBUGET', 'ZYLOPRIM',

        /* neuro / psych */
        'GABAPIN', 'PREGABA', 'PREGABALIN', 'NEUGABA',
        'LEVIPIL', 'EPTOIN', 'ENCORATE', 'VALPARIN', 'FRISIUM',
        'ALPRAX', 'RESTYL', 'ETIZOLA', 'LONAZEP', 'CLONOTRIL',
        'NEXITO', 'CIPLAR', 'PROTHIADEN', 'AMITONE',
        'STEMETIL', 'VERTIN', 'STUGERON', 'BETAVERT',
        'SIZODON', 'OLEANZ', 'QUTIPIN',

        /* derma */
        'CANDID', 'CANESTEN', 'CLOP G', 'QUADRIDERM', 'BETNOVATE',
        'SORIATANE', 'PANDERM', 'LULIFIN', 'ZOLE F',
        'ITRACONAZOLE', 'ITASPOR', 'FLUCONAZOLE', 'FORCAN', 'ZOCON',
        'TERBINAFORCE', 'SEBIFIN', 'GRISOVIN',
        'CETAPHIL', 'VENUSIA', 'MOISTUREX', 'ELOVERA', 'DERMADEW',
        'CLINDAC A', 'DERIVA', 'ADAPALENE', 'BENZAC',
        'SOFRAMYCIN', 'NEOSPORIN', 'T BACT', 'MUPIROCIN', 'SILVEREX',
        'BETADINE', 'DETTOL', 'CANDID B',

        /* eye / ent */
        'MOXIGRAM', 'VIGAMOX', 'CIPLOX EYE', 'REFRESH TEARS',
        'SYSTANE', 'GENTEAL', 'OTEK', 'CANDIBIOTIC', 'WAXOLVE',

        /* misc common */
        'ZINCOVIT', 'ELECTRAL', 'ORS', 'PEDIALYTE',
        'DULCOFLEX', 'SMUTH', 'ISABGOL', 'NATUROLAX',
        'VOLINI SPRAY', 'AMRUTANJAN', 'VICKS', 'ZANDU BALM',
        'CROCIN ADVANCE', 'DOLO 650', 'SINAREST AF'
    ];

    /* De-duplicated once at load; the list above is grouped by what a
       pharmacist would call the section, so a few names appear twice. */
    var seen = {}, LIST = [];
    for (var i = 0; i < COMMON.length; i++) {
        var k = COMMON[i].toUpperCase();
        if (!seen[k]) { seen[k] = 1; LIST.push(COMMON[i]); }
    }

    window.mmMedNames = { COMMON: LIST };
})();
