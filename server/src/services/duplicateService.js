'use strict';

/**
 * Duplicate Detection Service — Brahmapur / Ganjam Sector
 * ---------------------------------------------------------
 * Compares incoming incidents against existing active ones using multiple signals:
 *   1. Category match (+0.20)
 *   2. Location token overlap + Landmark synonym resolution (30% weight)
 *   3. Description text similarity with Odia Unicode support (35% weight)
 *   4. Geographic proximity via Haversine distance (< 1.5 km threshold)
 *   5. Time window recency boost (< 3 hours)
 */

const Incident = require('../models/Incident');

const SIMILARITY_THRESHOLD = 0.25;   // Minimum score to qualify as candidate match
const STRONG_MATCH_THRESHOLD = 0.60; // Score above which to flag as possible_duplicate
const TIME_WINDOW_HOURS = 24;        // Compare against incidents reported within 24 hours

// Normalized landmark aliases for Brahmapur, Ganjam
const LANDMARK_ALIASES = [
  { match: /\b(mkcg|medical college|hospital|mkcg medical)\b/gi, canonical: 'mkcg_hospital' },
  { match: /\b(gopalpur|gopalpur beach|sea beach|gopalpur port)\b/gi, canonical: 'gopalpur_coast' },
  { match: /\b(kamapalli|kamapalli square|kamapalli chhak)\b/gi, canonical: 'kamapalli_square' },
  { match: /\b(tata benz|tata benz square|tatabenz)\b/gi, canonical: 'tata_benz_square' },
  { match: /\b(old bus stand|bus stand|puruna bus stand)\b/gi, canonical: 'old_bus_stand' },
  { match: /\b(gate bazaar|gate bazar|bada bazaar|bada bazar)\b/gi, canonical: 'gate_bazaar_market' },
  { match: /\b(khallikote|khallikote college|khallikote university)\b/gi, canonical: 'khallikote_university' },
  { match: /\b(gosaninuagaon|gosani nuagaon)\b/gi, canonical: 'gosaninuagaon_sector' },
  { match: /\b(rushikulya|rushikulya river|gohirapalli)\b/gi, canonical: 'rushikulya_basin' },
];

function normalizeLandmarks(text) {
  if (!text) return '';
  let normalized = text;
  for (const { match, canonical } of LANDMARK_ALIASES) {
    normalized = normalized.replace(match, ` ${canonical} `);
  }
  return normalized;
}

// Tokenize text into a set of meaningful tokens supporting English, Odia & Telugu
function tokenize(text) {
  if (!text) return new Set();
  const normalized = normalizeLandmarks(text);
  return new Set(
    normalized
      .toLowerCase()
      .replace(/[^\w\s\u0B00-\u0B7F\u0C00-\u0C7F]/g, ' ') // Odia + Telugu + standard word chars
      .split(/\s+/)
      .filter(t => t.length > 2)
  );
}

// Jaccard similarity between two token sets
function jaccard(setA, setB) {
  if (!setA.size && !setB.size) return 1;
  if (!setA.size || !setB.size) return 0;
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

// Haversine distance in km between two lat/lng coordinates
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Find candidate duplicate/related incidents for an incoming emergency report.
 */
async function findCandidates({ locationDescription, reportText, category, coordinates, excludeId, isDemo }) {
  const cutoff = new Date(Date.now() - TIME_WINDOW_HOURS * 60 * 60 * 1000);

  const query = {
    createdAt: { $gte: cutoff },
    status: { $nin: ['cancelled', 'closed'] },
    isDemo: Boolean(isDemo),
  };
  if (excludeId) query._id = { $ne: excludeId };

  const recent = await Incident.find(query)
    .select('_id ref locationDescription originalReport category coordinates createdAt effectiveUrgency status')
    .limit(200)
    .lean();

  if (!recent.length) {
    return [];
  }

  const newLocTokens = tokenize(locationDescription);
  const newMsgTokens = tokenize(reportText);

  const scored = [];

  for (const inc of recent) {
    const reasons = [];
    let score = 0;

    // 1. Category match
    if (inc.category && inc.category === category) {
      score += 0.2;
      reasons.push(`Same emergency category: ${category}`);
    }

    // 2. Location token overlap with landmark alias mapping
    const locSim = jaccard(newLocTokens, tokenize(inc.locationDescription));
    if (locSim > 0.25) {
      score += locSim * 0.35;
      reasons.push(`Location similarity ${(locSim * 100).toFixed(0)}%`);
    }

    // 3. Description text similarity
    const msgSim = jaccard(newMsgTokens, tokenize(inc.originalReport));
    if (msgSim > 0.15) {
      score += msgSim * 0.35;
      reasons.push(`Report content similarity ${(msgSim * 100).toFixed(0)}%`);
    }

    // 4. Geographic proximity (Brahmapur urban & coastal radius)
    if (coordinates && inc.coordinates && inc.coordinates.lat && inc.coordinates.lng) {
      const distKm = haversineKm(coordinates.lat, coordinates.lng, inc.coordinates.lat, inc.coordinates.lng);
      if (distKm < 1.5) {
        const proxScore = Math.max(0, 0.30 - distKm * 0.20);
        score += proxScore;
        reasons.push(`Within ${distKm.toFixed(2)} km radius`);
      }
    }

    // 5. Recency boost for reports within 3 hours
    const ageH = (Date.now() - new Date(inc.createdAt).getTime()) / 3600000;
    if (ageH < 3) {
      score += 0.05;
      reasons.push('Reported within past 3 hours');
    }

    if (score >= SIMILARITY_THRESHOLD) {
      scored.push({
        incidentId: inc._id,
        incidentRef: inc.ref,
        location: inc.locationDescription,
        summary: inc.originalReport.slice(0, 140),
        category: inc.category,
        urgency: inc.effectiveUrgency,
        status: inc.status,
        reportedAt: inc.createdAt,
        similarityScore: Math.min(1, score),
        matchReasons: reasons,
        duplicateTag: score >= STRONG_MATCH_THRESHOLD ? 'possible_duplicate' : 'related',
      });
    }
  }

  scored.sort((a, b) => b.similarityScore - a.similarityScore);
  return scored.slice(0, 5);
}

module.exports = { findCandidates };
