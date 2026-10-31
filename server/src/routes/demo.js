'use strict';

const express = require('express');
const Incident = require('../models/Incident');
const User = require('../models/User');
const Resource = require('../models/Resource');
const Assignment = require('../models/Assignment');
const AuditEvent = require('../models/AuditEvent');
const { authenticate, authorize } = require('../middleware/auth');
const { asyncHandler, createError } = require('../middleware/errorHandler');

const router = express.Router();

// ============================================================================
// POST /api/demo/reset — reset all demo data (admin/coordinator only)
// Requires explicit confirmation token to prevent accidental resets
// ============================================================================
router.post('/reset', authenticate, authorize('admin', 'coordinator'), asyncHandler(async (req, res) => {
  const { confirm } = req.body;
  if (confirm !== 'RESET_DEMO_DATA') {
    throw createError('Provide { "confirm": "RESET_DEMO_DATA" } to confirm reset.', 422);
  }

  // Delete only demo-flagged records
  await Promise.all([
    Incident.deleteMany({ isDemo: true }),
    Assignment.deleteMany({ isDemo: true }),
    Resource.deleteMany({ isDemo: true }),
    AuditEvent.deleteMany({ isDemo: true }),
    User.deleteMany({ isDemo: true, role: { $ne: 'admin' } }), // never delete demo admin
  ]);

  // Re-seed demo data
  await seedDemoData(req.user);

  res.json({ success: true, message: 'Demo data has been reset to the default Brahmapur, Odisha scenario.' });
}));

// ============================================================================
// GET /api/demo/status — check if demo mode is active
// ============================================================================
router.get('/status', (_req, res) => {
  res.json({
    success: true,
    demoMode: process.env.DEMO_MODE === 'true',
    operationalSector: 'Brahmapur, Ganjam District, Odisha',
    message: 'Demonstration environment active. All records labeled DEMO represent disaster simulation data.',
  });
});

// ============================================================================
// Seed function (Brahmapur, Ganjam, Odisha Sector)
// ============================================================================
async function seedDemoData(seedUser) {
  const seeder = seedUser || { _id: null, displayName: 'System Seed', role: 'admin' };

  // Demo volunteers in Brahmapur
  const volunteers = await User.create([
    {
      displayName: 'Rakesh (Odisha Red Cross)',
      username: 'rakesh_redcross',
      passwordHash: 'Demo@2024!',
      role: 'volunteer',
      isDemo: true,
      profile: {
        skills: ['First Aid', 'Patient Triage', 'Emergency Care'],
        serviceArea: 'Kamapalli, Tata Benz Square',
        availability: 'available',
        teamAffiliation: 'Odisha Red Cross - Berhampur Cell',
      },
    },
    {
      displayName: 'Soumya (Khallikote NSS Wing)',
      username: 'soumya_nss',
      passwordHash: 'Demo@2024!',
      role: 'volunteer',
      isDemo: true,
      profile: {
        skills: ['Ration Distribution', 'Relief Camp Logistics', 'Youth Rescue'],
        serviceArea: 'Khallikote, Giri Road, Courtpeta',
        availability: 'available',
        teamAffiliation: 'Khallikote Unitary University NSS',
      },
    },
    {
      displayName: 'Team Kalinga (ODRAF Cell)',
      username: 'team_kalinga',
      passwordHash: 'Demo@2024!',
      role: 'volunteer',
      isDemo: true,
      profile: {
        skills: ['Zodiac Boat Operation', 'Deep Water Rescue', 'Flood Evacuation'],
        serviceArea: 'Gosaninuagaon, Rushikulya Flood Belt',
        availability: 'available',
        teamAffiliation: 'ODRAF Berhampur Auxiliary',
      },
    },
    {
      displayName: 'Team Sagar (Gopalpur Fishermen Guild)',
      username: 'team_sagar',
      passwordHash: 'Demo@2024!',
      role: 'volunteer',
      isDemo: true,
      profile: {
        skills: ['Off-road 4x4 Transport', 'Coastal Surf Rescue', 'Heavy Equipment'],
        serviceArea: 'Gopalpur Coastal Belt, Old Bus Stand',
        availability: 'available',
        teamAffiliation: 'Gopalpur Sea Rescue Guild',
      },
    },
  ]);

  // Demo resources in Brahmapur
  await Resource.create([
    {
      name: 'Packaged Safe Drinking Water (20L Cans)',
      resourceType: 'Drinking Water',
      unit: 'cans',
      quantityTotal: 450,
      quantityReserved: 0,
      quantityDispatched: 0,
      storageLocation: 'BeMC Relief Warehouse, Tata Benz Square',
      responsibleOrg: 'Berhampur Municipal Corporation (BeMC)',
      lowStockThreshold: 40,
      isDemo: true,
    },
    {
      name: 'Dry Ration Kits (Chuda, Gur & Biscuits)',
      resourceType: 'Food Packets',
      unit: 'kits',
      quantityTotal: 600,
      quantityReserved: 0,
      quantityDispatched: 0,
      storageLocation: 'Ganjam Collectorate Storehouse, Chhatrapur Rd',
      responsibleOrg: 'District Disaster Management Cell, Ganjam',
      lowStockThreshold: 50,
      isDemo: true,
    },
    {
      name: 'First-Aid Kits & Snake Venom Antiserum',
      resourceType: 'First-Aid Kits',
      unit: 'kits',
      quantityTotal: 90,
      quantityReserved: 0,
      quantityDispatched: 0,
      storageLocation: 'MKCG Medical College Emergency Annex',
      responsibleOrg: 'MKCG Hospital Casualty Department',
      lowStockThreshold: 15,
      isDemo: true,
    },
    {
      name: 'Inflatable Zodiac Rescue Boats with OBM',
      resourceType: 'Boats',
      unit: 'boats',
      quantityTotal: 6,
      quantityReserved: 0,
      quantityDispatched: 0,
      storageLocation: 'Gopalpur Marine Police & ODRAF Depot',
      responsibleOrg: 'ODRAF 3rd Battalion & Marine Wing',
      lowStockThreshold: 2,
      isDemo: true,
    },
    {
      name: 'Heavy-Duty Tarpaulin Sheets & Blankets',
      resourceType: 'Blankets',
      unit: 'units',
      quantityTotal: 300,
      quantityReserved: 0,
      quantityDispatched: 0,
      storageLocation: 'Town Hall Community Relief Shed',
      responsibleOrg: 'Ganjam Red Cross Society',
      lowStockThreshold: 30,
      isDemo: true,
    },
    {
      name: 'Essential Emergency Antibiotics & Cold-Chain Coolers',
      resourceType: 'Medicines',
      unit: 'kits',
      quantityTotal: 85,
      quantityReserved: 0,
      quantityDispatched: 0,
      storageLocation: 'PHC Gosaninuagaon Cold Storage',
      responsibleOrg: 'Department of Health & Family Welfare, Odisha',
      lowStockThreshold: 10,
      isDemo: true,
    },
  ]);

  // Demo incidents with realistic historical timestamps in Brahmapur
  const now = new Date();
  const mins = (m) => new Date(now - m * 60000);

  const incidentData = [
    {
      originalReport: 'Rushikulya backwater and flood entered our house in Gosaninuagaon near canal. 5 people stranded, grandmother needs urgent BP medicine.',
      locationDescription: 'Gosaninuagaon Canal Road, Near Shiva Temple, Brahmapur',
      reportedCategory: 'Medical Emergency',
      category: 'Medical Emergency',
      affectedCountRange: '4-8',
      aiRecommendedUrgency: 'Critical',
      effectiveUrgency: 'Critical',
      triageStatus: 'completed',
      status: 'awaiting_assignment',
      verificationStatus: 'under_review',
      coordinates: { lat: 19.3080, lng: 84.7800, source: 'gps' },
      aiTriage: {
        source: 'fallback',
        model: 'rule-based-odisha-v2',
        recommendedUrgency: 'Critical',
        incidentTitle: 'Canal Flood & Geriatric Medication — Gosaninuagaon',
        summary: 'Residential flooding with rising water entering home. Elderly patient requires blood pressure medication; evacuation boat needed.',
        immediateNeeds: ['ODRAF / Rescue Boat', 'BP medicines', 'Elderly Evacuation Support'],
        hazards: ['Rising canal backwater', 'Submerged drainage open manholes'],
        confidence: 'high',
        reasoning: 'Critical flood inundation coupled with essential geriatric medical dependency qualifies for Critical triage priority.',
        detectedLanguage: 'en',
        processedAt: mins(12),
        processingMs: 380,
      },
      isDemo: true,
    },
    {
      originalReport: 'Severe 18-hour cyclone power blackout in Kamapalli near Tata Benz Square. Diabetic patient needs cold-chain insulin pen urgently before 2 PM.',
      locationDescription: 'Kamapalli Chhak, Near Tata Benz Square, Brahmapur',
      reportedCategory: 'Medical Emergency',
      category: 'Medical Emergency',
      affectedCountRange: '1-3',
      aiRecommendedUrgency: 'Critical',
      effectiveUrgency: 'Critical',
      triageStatus: 'completed',
      status: 'assigned',
      verificationStatus: 'verified',
      coordinates: { lat: 19.3200, lng: 84.7850, source: 'gps' },
      aiTriage: {
        source: 'fallback',
        model: 'rule-based-odisha-v2',
        recommendedUrgency: 'Critical',
        incidentTitle: 'Time-Critical Insulin Cold-Chain Transport',
        summary: 'Diabetic patient requiring refrigerated insulin delivery amidst prolonged 18-hour grid blackout.',
        immediateNeeds: ['Insulin pens (cold-chain)', 'Ice packs & portable cool-box'],
        hazards: ['Time-critical medical window', 'Grid blackout'],
        confidence: 'high',
        reasoning: 'Cold-chain medication deadline with zero electricity backup requires immediate urgent volunteer courier.',
        detectedLanguage: 'en',
        processedAt: mins(25),
        processingMs: 410,
      },
      isDemo: true,
    },
    {
      originalReport: 'ସମୁଦ୍ରରୁ ଉଚ୍ଚ ଢେଉ ଆସି ଘର ଭାସିଗଲା। ଆମେ ୮ ଜଣ ଗାଁ ମନ୍ଦିର ଛାତ ଉପରେ ଫସି ରହିଛୁ। ପାଣି ଚାରିପାଖେ ବଢୁଛି, ଶୀଘ୍ର ଡଙ୍ଗା ପଠାନ୍ତୁ!',
      locationDescription: 'Gopalpur Sea Beach Fishing Village, Near Light House',
      reportedCategory: 'Flooding',
      category: 'Flooding',
      affectedCountRange: '4-8',
      aiRecommendedUrgency: 'Critical',
      effectiveUrgency: 'Critical',
      detectedLanguage: 'or',
      triageStatus: 'completed',
      status: 'in_progress',
      verificationStatus: 'verified',
      coordinates: { lat: 19.2608, lng: 84.9080, source: 'gps' },
      aiTriage: {
        source: 'fallback',
        model: 'rule-based-odisha-v2',
        recommendedUrgency: 'Critical',
        incidentTitle: 'Gopalpur Coastal Temple Roof Evacuation',
        summary: 'Odia SOS: Severe coastal storm surge inundated coastal hamlet. 8 citizens stranded on temple terrace surrounded by rising seawater.',
        immediateNeeds: ['ODRAF Inflatable Boat', 'Emergency Life Jackets', 'Coastal Evacuation Squad'],
        hazards: ['High coastal storm surge', 'Rapidly eroding foundation'],
        confidence: 'high',
        reasoning: 'Odia keywords confirmed: ଢେଉ (waves), ଛାତ ଉପରେ (on terrace), ଡଙ୍ଗା (boat) — immediate life threat.',
        detectedLanguage: 'or',
        processedAt: mins(48),
        processingMs: 490,
      },
      isDemo: true,
    },
    {
      originalReport: 'Makeshift cyclone relief camp at Khallikote Unitary University hall has 75 displaced villagers including 14 infants. Drinking water tank contaminated with storm runoff.',
      locationDescription: 'Khallikote Unitary University Campus Hall, Brahmapur',
      reportedCategory: 'Food & Drinking Water',
      category: 'Food & Drinking Water',
      affectedCountRange: '25+',
      aiRecommendedUrgency: 'High',
      effectiveUrgency: 'High',
      triageStatus: 'completed',
      status: 'awaiting_assignment',
      verificationStatus: 'unverified',
      coordinates: { lat: 19.3160, lng: 84.7920, source: 'gps' },
      aiTriage: {
        source: 'fallback',
        model: 'rule-based-odisha-v2',
        recommendedUrgency: 'High',
        incidentTitle: 'Relief Shelter Water Contamination Crisis',
        summary: 'Evacuation camp with 75 residents and 14 infants suffering from contaminated water supply. High risk of waterborne outbreak.',
        immediateNeeds: ['Safe drinking water (20L cans)', 'Infant milk supplies', 'Water purification halogen tablets'],
        hazards: ['Waterborne disease outbreak', 'Infant dehydration'],
        confidence: 'high',
        reasoning: 'High population density with vulnerable infants and contaminated potable water demands High priority.',
        detectedLanguage: 'en',
        processedAt: mins(70),
        processingMs: 330,
      },
      isDemo: true,
    },
    {
      originalReport: 'Storm knocked down two 11kV live electrical cables into flooded street near Gate Bazaar. Road is blocked for ambulances heading to MKCG Hospital.',
      locationDescription: 'Gate Bazaar Main Road, Near Old Post Office, Brahmapur',
      reportedCategory: 'Roadblock & Fallen Trees',
      category: 'Roadblock & Fallen Trees',
      affectedCountRange: '25+',
      aiRecommendedUrgency: 'High',
      effectiveUrgency: 'High',
      triageStatus: 'completed',
      status: 'submitted',
      verificationStatus: 'unverified',
      coordinates: { lat: 19.3000, lng: 84.7900, source: 'gps' },
      aiTriage: {
        source: 'fallback',
        model: 'rule-based-odisha-v2',
        recommendedUrgency: 'High',
        incidentTitle: 'Live 11kV Cables on MKCG Hospital Arterial Route',
        summary: 'Snaped live high-voltage power lines submerged in water on Gate Bazaar corridor, severing emergency transport access to MKCG Hospital.',
        immediateNeeds: ['TPCODL Power Isolation Crew', 'Road Debris Clearance Team'],
        hazards: ['Live 11kV electrical wire in standing water', 'Blocks MKCG arterial ambulance route'],
        confidence: 'high',
        reasoning: 'Severe electrocution hazard blocking the primary arterial corridor to MKCG tertiary care hospital.',
        detectedLanguage: 'en',
        processedAt: mins(95),
        processingMs: 310,
      },
      isDemo: true,
    },
    {
      originalReport: 'Active maternity labor contractions started. Ambulance stuck in submerged lane near Engineering School Road. Urgent high-clearance 4x4 or boat transport needed to MKCG Obstetrics.',
      locationDescription: 'Engineering School Road, Lane 4, Brahmapur',
      reportedCategory: 'Medical Emergency',
      category: 'Medical Emergency',
      affectedCountRange: '1-3',
      aiRecommendedUrgency: 'Critical',
      effectiveUrgency: 'Critical',
      triageStatus: 'completed',
      status: 'resolved',
      verificationStatus: 'verified',
      coordinates: { lat: 19.3140, lng: 84.8020, source: 'gps' },
      aiTriage: {
        source: 'fallback',
        model: 'rule-based-odisha-v2',
        recommendedUrgency: 'Critical',
        incidentTitle: 'Maternity Emergency — Flooded Street Access',
        summary: 'Woman in active labor trapped in flooded residential lane. Emergency medical transit to MKCG Hospital required immediately.',
        immediateNeeds: ['High-clearance 4x4 or ODRAF Zodiac boat', 'Paramedic escort to MKCG Hospital'],
        hazards: ['Flooded access road', 'Time-critical obstetric delivery'],
        confidence: 'high',
        reasoning: 'Active labor with vehicle blockage represents an immediate life-critical obstetric emergency.',
        detectedLanguage: 'en',
        processedAt: mins(140),
        processingMs: 290,
      },
      isDemo: true,
    },
  ];

  const now2 = new Date();
  const incidents = [];
  for (let i = 0; i < incidentData.length; i++) {
    const d = incidentData[i];
    const createdAt = new Date(now2 - (i + 1) * 18 * 60000);
    const inc = new Incident({ ...d, createdAt, updatedAt: createdAt });
    inc.statusHistory = [{ status: d.status || 'submitted', changedByName: 'System Seed (Ganjam Control)', timestamp: createdAt }];
    await inc.save();
    incidents.push(inc);
  }

  return { incidents, volunteers };
}

module.exports = router;
module.exports.seedDemoData = seedDemoData;
