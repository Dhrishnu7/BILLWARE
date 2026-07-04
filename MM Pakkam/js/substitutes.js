// Magic Substitute Finder Data
// Maps brand names to their generic salts, and provides generic alternatives

const MED_KNOWLEDGE = {
    "dolo 650": { salt: "Paracetamol 650mg", genericMatches: ["paracetamol 650", "pacimol 650", "crocin 650"] },
    "crocin advance": { salt: "Paracetamol 500mg", genericMatches: ["paracetamol 500", "calpol 500"] },
    "augmentin 625": { salt: "Amoxicillin + Clavulanic Acid", genericMatches: ["amoxicillin 625", "moxikind-cv", "clavum 625"] },
    "pan 40": { salt: "Pantoprazole 40mg", genericMatches: ["pantoprazole 40", "pantosec 40"] },
    "telma 40": { salt: "Telmisartan 40mg", genericMatches: ["telmisartan 40", "telsartan 40"] },
    "allegra 120": { salt: "Fexofenadine 120mg", genericMatches: ["fexofenadine 120", "fexokind 120"] },
    "calpol 500": { salt: "Paracetamol 500mg", genericMatches: ["paracetamol 500", "crocin advance"] },
    "montek lc": { salt: "Montelukast + Levocetirizine", genericMatches: ["montelukast lc", "telekast l"] }
};

// Check if we have knowledge about this med
function getMedKnowledge(medName) {
    if(!medName) return null;
    const name = medName.toLowerCase().trim();
    
    // Direct match
    if(MED_KNOWLEDGE[name]) return MED_KNOWLEDGE[name];
    
    // Partial match
    for(const key in MED_KNOWLEDGE) {
        if(name.includes(key) || key.includes(name)) {
            return MED_KNOWLEDGE[key];
        }
    }
    return null;
}
