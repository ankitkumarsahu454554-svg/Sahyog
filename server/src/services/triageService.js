'use strict';

/**
 * AI Triage Service — SahyogAI (Brahmapur, Ganjam, Odisha Deployment)
 * -------------------------------------------------------------------
 * Calls the Gemini API (server-side) with strict JSON schema.
 * Falls back transparently to a deterministic rule-based NLP engine.
 * Supports Odia (ଓଡ଼ିଆ), English, and phonetic regional disaster reports.
 * NEVER exposes the API key to the client.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { URGENCY_LEVELS, CATEGORIES } = require('../models/Incident');

const TIMEOUT_MS = 12000; // 12-second hard limit

// ── Strict output schema for AI ─────────────────────────────────────────────
const SCHEMA_EXAMPLE = {
  recommendedUrgency: 'Critical | High | Medium | Low',
  recommendedCategory: '<one of the valid categories>',
  incidentTitle: '<4-6 word title>',
  summary: '<1-2 sentence dispatch brief>',
  affectedCount: '<number or null>',
  immediateNeeds: ['<need 1>', '<need 2>'],
  hazards: ['<hazard 1>'],
  recommendedNextSteps: ['<step 1>', '<step 2>'],
  missingInfo: ['<info 1>'],
  confidence: 'high | medium | low | uncertain',
  reasoning: '<brief explanation of urgency recommendation>',
  detectedLanguage: 'en | or | te | mixed | unknown',
};

const SYSTEM_PROMPT = `You are SahyogAI, an emergency disaster response triage AI deployed in Brahmapur (Berhampur), Ganjam District, Odisha, India.
You assist trained emergency coordinators, ODRAF (Odisha Disaster Rapid Action Force), OSDMA, and BeMC (Berhampur Municipal Corporation) — you do NOT replace them.

Key operational landmarks in this sector include:
- MKCG Medical College & Hospital (apex tertiary healthcare)
- Gopalpur Sea Beach & Port (coastal storm surge corridor)
- Rushikulya River basin (Ganjam flood zone)
- Kamapalli, Tata Benz Square, Gate Bazaar, Gosaninuagaon, Old Bus Stand, Bada Bazaar, Khallikote Unitary University.

Your task is to analyze an incoming emergency SOS report and return a structured JSON triage assessment.

URGENCY LEVELS (choose one):
- Critical: Immediate threat to life, severe injury, people trapped, drowning, cardiac emergency, fire, active childbirth / blocked labor, snakebite, live snapped electric wires in water, imminent structural collapse.
- High: Significant risk, deteriorating situation, vulnerable populations (elderly, infants, pregnant women), essential medical needs (insulin, dialysis, oxygen), contaminated shelter water.
- Medium: Serious but stable situation, essential food/drinking water shortage, infrastructure damage without immediate life threat.
- Low: Minor property damage, road blockage with alternate bypass available, general informational inquiries.

SAFETY RULES:
- Do NOT downgrade urgency solely because a formal keyword is absent.
- Treat reports of trapped people, terrace stranded victims, drowning, flood entering homes, blood, unconsciousness, fire, or live snapped cables as at least High urgency.
- If uncertain, lean toward higher urgency and set confidence to "uncertain".
- Do NOT invent names, locations, injuries, or numbers not stated in the report.
- The report may be in Odia (ଓଡ଼ିଆ script or phonetic English), English, or mixed. Understand the emergency context deeply.

VALID CATEGORIES: ${CATEGORIES.join(' | ')}

Respond with ONLY a valid JSON object matching this exact schema (no markdown, no code fences):
${JSON.stringify(SCHEMA_EXAMPLE, null, 2)}`;

// ── Validation: check AI output before using it ─────────────────────────────
function validateAIOutput(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (!URGENCY_LEVELS.includes(obj.recommendedUrgency)) return false;
  if (typeof obj.summary !== 'string' || obj.summary.length < 5) return false;
  if (!['high', 'medium', 'low', 'uncertain'].includes(obj.confidence)) return false;
  return true;
}

function sanitizeAIOutput(obj) {
  return {
    recommendedUrgency: URGENCY_LEVELS.includes(obj.recommendedUrgency) ? obj.recommendedUrgency : 'Medium',
    recommendedCategory: CATEGORIES.includes(obj.recommendedCategory) ? obj.recommendedCategory : null,
    incidentTitle: typeof obj.incidentTitle === 'string' ? obj.incidentTitle.slice(0, 100) : null,
    summary: typeof obj.summary === 'string' ? obj.summary.slice(0, 1000) : '',
    affectedCount: typeof obj.affectedCount === 'number' && obj.affectedCount >= 0 ? Math.floor(obj.affectedCount) : null,
    immediateNeeds: Array.isArray(obj.immediateNeeds) ? obj.immediateNeeds.map(String).slice(0, 10) : [],
    hazards: Array.isArray(obj.hazards) ? obj.hazards.map(String).slice(0, 10) : [],
    recommendedNextSteps: Array.isArray(obj.recommendedNextSteps) ? obj.recommendedNextSteps.map(String).slice(0, 8) : [],
    missingInfo: Array.isArray(obj.missingInfo) ? obj.missingInfo.map(String).slice(0, 6) : [],
    confidence: ['high', 'medium', 'low', 'uncertain'].includes(obj.confidence) ? obj.confidence : 'uncertain',
    reasoning: typeof obj.reasoning === 'string' ? obj.reasoning.slice(0, 1000) : '',
    detectedLanguage: ['en', 'or', 'te', 'mixed', 'unknown'].includes(obj.detectedLanguage) ? obj.detectedLanguage : 'unknown',
  };
}

// ── Rule-based fallback (Brahmapur, Odisha emergency vocabulary) ──────────────
function ruleFallback(reportText, location, userCategory, affectedCountRange) {
  const lower = reportText.toLowerCase();

  // Critical triggers (English, Odia Unicode, and Phonetic Odia/Tanglish)
  const criticalPatterns = [
    // English
    'trapped', 'trap', 'unconscious', 'not breathing', 'heart attack', 'cardiac',
    'drowning', 'drown', 'bleeding heavily', 'blood', 'fire', 'burning', 'burn',
    'collapse', 'collapsed', 'labor', 'labour', 'childbirth', 'ambulance',
    'critical', 'dying', 'died', 'dead', 'terrace', 'rooftop stranded', 'snakebite',
    'electric wire', 'live cable', 'snapped wire',
    // Odia Unicode
    'ପାଣି ପଶିଗଲା', 'ପାଣି ବଢୁଛି', 'ଡଙ୍ଗା ପଠାନ୍ତୁ', 'ଡଙ୍ଗା ଦରକାର', 'ବୁଡ଼ି ଯାଉଛନ୍ତି',
    'ଛାତ ଉପରେ', 'ଅଚେତ', 'ରକ୍ତ ବୋହୁଛି', 'ଜରୁରୀ', 'ଚିକିତ୍ସା ଦରକାର', 'ବିଦ୍ୟୁତ ତାର',
    'ଭୁଶୁଡ଼ି ପଡ଼ିଲା', 'ମରିଯିବେ', 'ରକ୍ଷା କରନ୍ତୁ', 'ଶୀଘ୍ର ଆସନ୍ତୁ', 'ସାପ କାମୁଡ଼ିଲା',
    // Phonetic Odia
    'pani pasigala', 'pani badhuchi', 'danga pathantu', 'danga darkar', 'budi jauchanti',
    'chata upare', 'acchet', 'rakta', 'emergency', 'rescue karantu', 'raksha karantu',
    'sapa kamudila', 'bidyut tara', 'current wire', 'mkcg', 'immediately',
    // Telugu support (Southern Odisha / Ganjam border)
    'neellu', 'velu', 'water rising', 'munchaindi', 'chanipoindi', 'boat pampandi',
  ];

  const highPatterns = [
    // English
    'water', 'flood', 'flooded', 'inundation', 'elderly', 'senior', 'infant',
    'baby', 'pregnant', 'diabetic', 'insulin', 'medicine', 'bp medicine',
    'no food', 'no water', 'drinking water', 'shelter needed', 'roof damaged',
    'power cut', 'no electricity', 'cyclone', 'missing', 'storm surge',
    // Odia Unicode
    'ବନ୍ୟା', 'ପାନୀୟ ଜଳ', 'ଖାଦ୍ୟ ନାହିଁ', 'ଗର୍ଭବତୀ', 'ଶିଶୁ', 'ବୟସ୍କ', 'ଇନସୁଲିନ',
    'ଔଷଧ', 'ରାସ୍ତା ବନ୍ଦ', 'ଗଛ ପଡ଼ିଛି', 'କରେଣ୍ଟ ନାହିଁ', 'ବାତ୍ୟା', 'ଭଙ୍ଗା ଘର', 'ସାହାଯ୍ୟ',
    // Phonetic Odia
    'vanya', 'khadya nahi', 'pani nahi', 'garbhabati', 'shishu', 'bayaska',
    'aushadha', 'rasta banda', 'gacha padichi', 'current nahi', 'batya', 'help', 'save',
  ];

  const hasCritical = criticalPatterns.some(p => lower.includes(p));
  const hasHigh = highPatterns.some(p => lower.includes(p));

  let urgency = 'Medium';
  if (hasCritical) urgency = 'Critical';
  else if (hasHigh || userCategory === 'Medical Emergency') urgency = 'High';
  else if (userCategory === 'Food & Drinking Water' || userCategory === 'Shelter') urgency = 'Medium';
  else urgency = 'Low';

  // Category detection
  let category = userCategory;
  if (!CATEGORIES.includes(category)) {
    if (lower.includes('water') || lower.includes('flood') || lower.includes('ବନ୍ୟା') || lower.includes('ପାଣି')) category = 'Flooding';
    else if (lower.includes('fire') || lower.includes('burn') || lower.includes('ନିଆଁ')) category = 'Fire';
    else if (lower.includes('trapped') || lower.includes('missing') || lower.includes('ଫସି') || lower.includes('ଛାତ')) category = 'Trapped / Missing People';
    else if (lower.includes('food') || lower.includes('ration') || lower.includes('ଖାଦ୍ୟ') || lower.includes('ଜଳ')) category = 'Food & Drinking Water';
    else if (lower.includes('medicine') || lower.includes('hospital') || lower.includes('doctor') || lower.includes('ଡାକ୍ତର') || lower.includes('mkcg')) category = 'Medical Emergency';
    else category = 'Other Emergency';
  }

  // Immediate needs
  const needs = [];
  if (lower.includes('boat') || lower.includes('ଡଙ୍ଗା') || lower.includes('danga')) needs.push('ODRAF / Rescue Boat');
  if (lower.includes('insulin') || lower.includes('medicine') || lower.includes('bp') || lower.includes('ଔଷଧ') || lower.includes('snakebite')) needs.push('Emergency Medicines / Antiserum kit');
  if (lower.includes('food') || lower.includes('ration') || lower.includes('ଖାଦ୍ୟ') || lower.includes('chuda')) needs.push('Dry Food Packets (Chuda/Gur)');
  if (lower.includes('water') || lower.includes('ପାଣି') || lower.includes('ଜଳ')) needs.push('Drinking Water (20L Cans)');
  if (lower.includes('shelter') || lower.includes('roof') || lower.includes('ପାଲ')) needs.push('Tarpaulin / Temporary Shelter');
  if (lower.includes('ambulance') || lower.includes('hospital') || lower.includes('mkcg')) needs.push('Ambulance to MKCG Hospital');
  if (lower.includes('electric') || lower.includes('wire') || lower.includes('ତାର')) needs.push('TPCODL Power Isolation Crew');
  if (needs.length === 0) needs.push('Rapid Field Assessment Team');

  // Language detection
  const odiaChars = /[\u0B00-\u0B7F]/;
  const teluguChars = /[\u0C00-\u0C7F]/;
  const hasEnglish = /[a-zA-Z]/.test(reportText);
  const hasOdia = odiaChars.test(reportText);
  const hasTelugu = teluguChars.test(reportText);

  let lang = 'unknown';
  if (hasOdia && hasEnglish) lang = 'mixed';
  else if (hasOdia) lang = 'or';
  else if (hasTelugu) lang = 'te';
  else if (hasEnglish) lang = 'en';

  const summary = `Emergency in Brahmapur/Ganjam sector at ${location}. ${reportText.slice(0, 140)}${reportText.length > 140 ? '...' : ''}`;
  const title = `${category.split('/')[0].trim()} — ${location.split(',')[0].trim()}`.slice(0, 80);

  return {
    recommendedUrgency: urgency,
    recommendedCategory: category,
    incidentTitle: title,
    summary,
    affectedCount: null,
    immediateNeeds: needs,
    hazards: hasCritical ? ['Imminent life-safety hazard or rising floodwaters reported'] : [],
    recommendedNextSteps: [
      'Ganjam Control Room / BeMC Coordinator to verify incident via registered phone.',
      'Dispatch nearest ODRAF / Fire Services or volunteer unit from Brahmapur Hub.',
    ],
    missingInfo: [
      'Exact head count of vulnerable persons (infants/elderly) pending confirmation.',
      'Water ingress depth and route accessibility status to be verified by field scout.',
    ],
    confidence: 'medium',
    reasoning: `Rule-based fallback classification for Brahmapur sector. Category: ${category}. Urgency set to ${urgency} based on high-risk disaster keywords. Coordinator review recommended.`,
    detectedLanguage: lang,
  };
}

// ── Main export ──────────────────────────────────────────────────────────────
async function runTriage({ reportText, location, userCategory, affectedCountRange }) {
  const startMs = Date.now();

  // Attempt Gemini call only if key is configured
  if (process.env.GEMINI_API_KEY) {
    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
      });

      const userPrompt = `Operational Sector: Brahmapur (Berhampur), Ganjam District, Odisha
Location: "${location}"
Reported category: "${userCategory || 'Not specified'}"
Estimated people affected: "${affectedCountRange || 'Unknown'}"
Emergency report (may be in Odia ଓଡ଼ିଆ, English, or phonetic Tanglish/Odia):
"""
${reportText}
"""`;

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Gemini API timeout')), TIMEOUT_MS)
      );

      const resultPromise = model.generateContent([SYSTEM_PROMPT, userPrompt]);
      const result = await Promise.race([resultPromise, timeoutPromise]);

      const rawText = result.response.text();
      let parsed;
      try {
        parsed = JSON.parse(rawText);
      } catch (_e) {
        const match = rawText.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
        else throw new Error('Gemini returned non-JSON response');
      }

      if (!validateAIOutput(parsed)) {
        throw new Error('Gemini output failed schema validation');
      }

      const sanitized = sanitizeAIOutput(parsed);
      return {
        ...sanitized,
        source: 'gemini',
        model: 'gemini-1.5-flash',
        processedAt: new Date(),
        processingMs: Date.now() - startMs,
        rawResponse: parsed,
      };

    } catch (err) {
      console.warn('[TriageService] Gemini failed, using rule-based fallback:', err.message);
    }
  }

  // Deterministic fallback
  const fallback = ruleFallback(reportText, location, userCategory, affectedCountRange);
  return {
    ...fallback,
    source: 'fallback',
    model: 'rule-based-odisha-v2',
    processedAt: new Date(),
    processingMs: Date.now() - startMs,
    rawResponse: null,
  };
}

module.exports = { runTriage };
