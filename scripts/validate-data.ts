#!/usr/bin/env npx tsx
/**
 * Validates ski area data integrity after sync jobs
 * 
 * Usage:
 *   npx tsx scripts/validate-data.ts
 *   npx tsx scripts/validate-data.ts --verbose
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ValidationResult {
  name: string;
  passed: boolean;
  message: string;
  details?: string;
}

const results: ValidationResult[] = [];

function pass(name: string, message: string, details?: string) {
  results.push({ name, passed: true, message, details });
  console.log(`✅ ${name}: ${message}`);
  if (details) console.log(`   ${details}`);
}

function fail(name: string, message: string, details?: string) {
  results.push({ name, passed: false, message, details });
  console.log(`❌ ${name}: ${message}`);
  if (details) console.log(`   ${details}`);
}

async function validateBasicCounts() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 BASIC DATA COUNTS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const skiAreaCount = await prisma.skiArea.count();
  const runCount = await prisma.run.count();
  const liftCount = await prisma.lift.count();
  const subRegionCount = await prisma.subRegion.count();
  const connectionCount = await prisma.skiAreaConnection.count();

  console.log(`   Ski Areas:    ${skiAreaCount.toLocaleString()}`);
  console.log(`   Runs:         ${runCount.toLocaleString()}`);
  console.log(`   Lifts:        ${liftCount.toLocaleString()}`);
  console.log(`   Sub-Regions:  ${subRegionCount.toLocaleString()}`);
  console.log(`   Connections:  ${connectionCount.toLocaleString()}`);
  console.log('');

  // Minimum expected counts
  if (skiAreaCount >= 100) {
    pass('Ski Area Count', `${skiAreaCount} ski areas (minimum: 100)`);
  } else {
    fail('Ski Area Count', `Only ${skiAreaCount} ski areas (expected at least 100)`);
  }

  if (runCount >= 1000) {
    pass('Run Count', `${runCount} runs (minimum: 1,000)`);
  } else {
    fail('Run Count', `Only ${runCount} runs (expected at least 1,000)`);
  }

  if (liftCount >= 500) {
    pass('Lift Count', `${liftCount} lifts (minimum: 500)`);
  } else {
    fail('Lift Count', `Only ${liftCount} lifts (expected at least 500)`);
  }
}

async function validateCountryDistribution() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🌍 COUNTRY DISTRIBUTION');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const byCountry = await prisma.skiArea.groupBy({
    by: ['country'],
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
  });

  console.log('   Country  |  Ski Areas');
  console.log('   ---------|-----------');
  for (const row of byCountry.slice(0, 15)) {
    console.log(`   ${(row.country || 'Unknown').padEnd(8)} |  ${row._count.id}`);
  }
  if (byCountry.length > 15) {
    console.log(`   ... and ${byCountry.length - 15} more countries`);
  }
  console.log('');

  // Check key countries exist
  const expectedCountries = ['FR', 'CH', 'AT', 'IT', 'US'];
  const countries = byCountry.map(r => r.country);
  
  for (const country of expectedCountries) {
    const count = byCountry.find(r => r.country === country)?._count.id || 0;
    if (count > 0) {
      pass(`Country: ${country}`, `${count} ski areas`);
    } else {
      fail(`Country: ${country}`, 'No ski areas found');
    }
  }
}

async function validateKnownSkiAreas() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎿 KNOWN SKI AREAS VALIDATION');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Well-known ski areas that should exist
  const knownAreas = [
    { name: 'Les Trois Vallées', country: 'FR', minRuns: 50, minLifts: 20 },
    { name: 'Chamonix', country: 'FR', minRuns: 10, minLifts: 5 },
    { name: 'Zermatt', country: 'CH', minRuns: 20, minLifts: 10 },
    { name: 'Val Thorens', country: 'FR', minRuns: 10, minLifts: 5 },
    { name: 'Verbier', country: 'CH', minRuns: 10, minLifts: 5 },
    { name: 'St. Anton', country: 'AT', minRuns: 10, minLifts: 5 },
    { name: 'Vail', country: 'US', minRuns: 10, minLifts: 5 },
    { name: 'Whistler Blackcomb', country: 'CA', minRuns: 20, minLifts: 10 },
  ];

  for (const expected of knownAreas) {
    const area = await prisma.skiArea.findFirst({
      where: {
        name: { contains: expected.name, mode: 'insensitive' },
      },
      include: {
        _count: { select: { runs: true, lifts: true } },
      },
    });

    if (!area) {
      fail(`Ski Area: ${expected.name}`, 'Not found in database');
      continue;
    }

    const runCount = area._count.runs;
    const liftCount = area._count.lifts;

    if (runCount >= expected.minRuns && liftCount >= expected.minLifts) {
      pass(
        `Ski Area: ${expected.name}`,
        `Found with ${runCount} runs, ${liftCount} lifts`,
        `ID: ${area.id}`
      );
    } else {
      fail(
        `Ski Area: ${expected.name}`,
        `Insufficient data: ${runCount} runs (min: ${expected.minRuns}), ${liftCount} lifts (min: ${expected.minLifts})`
      );
    }
  }
}

async function validateSubRegions() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🏔️ SUB-REGION VALIDATION');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Check Trois Vallées has sub-regions including Méribel
  const troisVallees = await prisma.skiArea.findFirst({
    where: { name: { contains: 'Trois Vallées', mode: 'insensitive' } },
    include: { subRegions: true },
  });

  if (!troisVallees) {
    fail('Les Trois Vallées Sub-Regions', 'Ski area not found');
  } else {
    const subRegionNames = troisVallees.subRegions.map(s => s.name);
    console.log(`   Les Trois Vallées sub-regions (${subRegionNames.length}):`);
    for (const name of subRegionNames.slice(0, 10)) {
      console.log(`     - ${name}`);
    }
    if (subRegionNames.length > 10) {
      console.log(`     ... and ${subRegionNames.length - 10} more`);
    }
    console.log('');

    // Check for known villages (Méribel is in Les Allues commune)
    const hasMeribel = subRegionNames.some(
      n => n.toLowerCase().includes('méribel') || 
           n.toLowerCase().includes('meribel') ||
           n.toLowerCase().includes('allues')
    );
    
    if (hasMeribel) {
      pass('Méribel Sub-Region', 'Found in Les Trois Vallées');
    } else if (subRegionNames.length > 0) {
      fail('Méribel Sub-Region', 'Not found', `Available: ${subRegionNames.slice(0, 5).join(', ')}`);
    } else {
      fail('Méribel Sub-Region', 'No sub-regions found for Les Trois Vallées');
    }
  }

  // Check Zermatt area (should have Zermatt, maybe Cervinia connection)
  const zermatt = await prisma.skiArea.findFirst({
    where: { name: { contains: 'Zermatt', mode: 'insensitive' } },
    include: { subRegions: true },
  });

  if (zermatt) {
    if (zermatt.subRegions.length > 0) {
      pass('Zermatt Sub-Regions', `${zermatt.subRegions.length} sub-regions found`);
    } else {
      // Sub-regions are optional, just note it
      console.log('   ℹ️ Zermatt: No sub-regions (may be expected for smaller areas)');
    }
  }
}

async function validateConnections() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔗 CONNECTION VALIDATION');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const connectionCount = await prisma.skiAreaConnection.count();
  
  if (connectionCount > 0) {
    pass('Ski Area Connections', `${connectionCount} connections detected`);
    
    // Show some example connections
    const connections = await prisma.skiAreaConnection.findMany({
      take: 5,
      include: {
        fromArea: { select: { name: true } },
        toArea: { select: { name: true } },
      },
    });

    console.log('\n   Sample connections:');
    for (const conn of connections) {
      console.log(`     ${conn.fromArea.name} ↔ ${conn.toArea.name}`);
    }
  } else {
    fail('Ski Area Connections', 'No connections found');
  }
}

async function validateDataIntegrity() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔍 DATA INTEGRITY CHECKS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Check for orphaned runs (runs without ski areas)
  const orphanedRuns = await prisma.run.count({
    where: { skiAreaId: null },
  });
  
  if (orphanedRuns === 0) {
    pass('No Orphaned Runs', 'All runs linked to ski areas');
  } else {
    fail('Orphaned Runs', `${orphanedRuns} runs without ski area`);
  }

  // Check for orphaned lifts
  const orphanedLifts = await prisma.lift.count({
    where: { skiAreaId: null },
  });
  
  if (orphanedLifts === 0) {
    pass('No Orphaned Lifts', 'All lifts linked to ski areas');
  } else {
    fail('Orphaned Lifts', `${orphanedLifts} lifts without ski area`);
  }

  // Check for ski areas with no runs or lifts
  const emptyAreas = await prisma.skiArea.count({
    where: {
      AND: [
        { runs: { none: {} } },
        { lifts: { none: {} } },
      ],
    },
  });

  const totalAreas = await prisma.skiArea.count();
  const emptyPercent = ((emptyAreas / totalAreas) * 100).toFixed(1);

  if (emptyAreas < totalAreas * 0.5) {
    pass('Ski Areas with Data', `${totalAreas - emptyAreas}/${totalAreas} have runs/lifts (${emptyPercent}% empty)`);
  } else {
    fail('Ski Areas with Data', `Too many empty: ${emptyAreas}/${totalAreas} (${emptyPercent}%)`);
  }

  // Check runs have valid difficulty
  const invalidDifficulty = await prisma.run.count({
    where: {
      NOT: {
        difficulty: { in: ['novice', 'easy', 'intermediate', 'advanced', 'expert', 'extreme', 'freeride'] },
      },
    },
  });

  const totalRuns = await prisma.run.count();
  if (invalidDifficulty < totalRuns * 0.2) {
    pass('Run Difficulties', `${totalRuns - invalidDifficulty}/${totalRuns} have valid difficulty`);
  } else {
    fail('Run Difficulties', `${invalidDifficulty}/${totalRuns} have invalid/missing difficulty`);
  }
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║           SKI DATA VALIDATION REPORT                           ║');
  console.log('║           ' + new Date().toISOString() + '                  ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');

  try {
    await validateBasicCounts();
    await validateCountryDistribution();
    await validateKnownSkiAreas();
    await validateSubRegions();
    await validateConnections();
    await validateDataIntegrity();

    // Summary
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║                        SUMMARY                                 ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const total = results.length;

    console.log(`   ✅ Passed: ${passed}/${total}`);
    console.log(`   ❌ Failed: ${failed}/${total}`);
    console.log('');

    if (failed > 0) {
      console.log('   Failed checks:');
      for (const result of results.filter(r => !r.passed)) {
        console.log(`     - ${result.name}: ${result.message}`);
      }
      console.log('');
    }

    // Output for GitHub Actions
    if (process.env.GITHUB_STEP_SUMMARY) {
      const fs = require('fs');
      let summary = '## 🎿 Data Validation Results\n\n';
      summary += `| Check | Status | Details |\n`;
      summary += `|-------|--------|--------|\n`;
      for (const result of results) {
        summary += `| ${result.name} | ${result.passed ? '✅' : '❌'} | ${result.message} |\n`;
      }
      summary += `\n**${passed}/${total} checks passed**\n`;
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    }

    // Exit with error if critical failures
    if (failed > 3) {
      console.log('❌ Too many validation failures - data may be corrupted');
      process.exit(1);
    }

    console.log('✅ Validation complete');
    
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);

