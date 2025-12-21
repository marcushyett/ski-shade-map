/**
 * Resort synonyms and alternative names dictionary
 *
 * Maps common alternative names, translations, and sub-resort names
 * to ski area search terms. This allows users to find "Les 3 Vallées"
 * by searching for "Meribel", "Three Valleys", etc.
 *
 * Format: { searchTerm: [array of ski area names/patterns to boost] }
 */

export interface SynonymEntry {
  // The search terms that should trigger this match
  terms: string[];
  // The ski area names to boost when these terms are searched
  boostAreas: string[];
}

// Bi-directional synonym groups - all terms in a group should find each other
const synonymGroups: string[][] = [
  // France - Les 3 Vallées
  ['les 3 vallees', 'trois vallees', 'three valleys', '3 valleys', 'les trois vallees',
   'meribel', 'courchevel', 'val thorens', 'les menuires', 'la tania', 'brides les bains',
   'orelle', 'saint martin de belleville', 'mottaret'],

  // France - Paradiski
  ['paradiski', 'les arcs', 'la plagne', 'peisey vallandry', 'arc 1800', 'arc 2000',
   'arc 1600', 'arc 1950', 'belle plagne', 'plagne centre', 'champagny'],

  // France - Portes du Soleil
  ['portes du soleil', 'avoriaz', 'morzine', 'les gets', 'chatel', 'champery',
   'morgins', 'torgon', 'la chapelle', 'abondance', 'montriond'],

  // France - Espace Killy
  ['espace killy', 'tignes', 'val disere', "val d'isere", 'val d isere'],

  // France - Grand Massif
  ['grand massif', 'flaine', 'samoens', 'morillon', 'les carroz', 'sixt fer a cheval'],

  // France - Sybelles
  ['les sybelles', 'sybelles', 'la toussuire', 'le corbier', 'saint sorlin',
   'saint colomban', 'saint jean darves'],

  // France - Evasion Mont Blanc
  ['evasion mont blanc', 'megeve', 'saint gervais', 'les contamines', 'combloux',
   'la giettaz', 'saint nicolas de veroce'],

  // France - Alpe d'Huez Grand Domaine
  ['alpe dhuez', "alpe d'huez", 'alpe d huez', 'grand domaine', 'oz en oisans',
   'vaujany', 'villard reculas', 'auris en oisans'],

  // France - La Clusaz / Le Grand Bornand
  ['la clusaz', 'le grand bornand', 'manigod', 'massif des aravis'],

  // France - Serre Chevalier
  ['serre chevalier', 'briancon', 'chantemerle', 'villeneuve', 'monetier'],

  // Austria - Ski Arlberg
  ['ski arlberg', 'arlberg', 'st anton', 'sankt anton', 'lech', 'zurs', 'stuben',
   'st christoph', 'warth', 'schrocken', 'klosterle'],

  // Austria - SkiWelt
  ['skiwelt', 'ski welt', 'wilder kaiser', 'soll', 'ellmau', 'scheffau', 'going',
   'brixen im thale', 'westendorf', 'hopfgarten', 'itter', 'kelchsau'],

  // Austria - Zillertal
  ['zillertal', 'zillertal arena', 'mayrhofen', 'zell am ziller', 'gerlos',
   'konigsleiten', 'hochfugen', 'kaltenbach', 'fugen'],

  // Austria - Kitzbühel
  ['kitzbuehel', 'kitzbuhel', 'kitzbühel', 'kirchberg', 'pass thurn', 'jochberg'],

  // Austria - Ischgl/Silvretta
  ['ischgl', 'silvretta arena', 'silvretta', 'galtur', 'samnaun', 'kappl', 'see'],

  // Austria - Saalbach
  ['saalbach', 'hinterglemm', 'saalbach hinterglemm', 'leogang', 'fieberbrunn',
   'skicircus'],

  // Austria - Obergurgl
  ['obergurgl', 'hochgurgl', 'obergurgl hochgurgl', 'otztal', 'solden'],

  // Switzerland - Verbier / 4 Vallées
  ['verbier', '4 vallees', 'quatre vallees', 'four valleys', 'nendaz', 'veysonnaz',
   'thyon', 'la tzoumaz', 'bruson'],

  // Switzerland - Zermatt
  ['zermatt', 'cervinia', 'matterhorn', 'breuil cervinia', 'valtournenche'],

  // Switzerland - St. Moritz / Engadin
  ['st moritz', 'saint moritz', 'engadin', 'engadine', 'corviglia', 'corvatsch',
   'diavolezza', 'pontresina', 'celerina', 'sils', 'silvaplana'],

  // Switzerland - Davos/Klosters
  ['davos', 'klosters', 'parsenn', 'jakobshorn', 'pischa', 'rinerhorn', 'madrisa'],

  // Switzerland - Laax/Flims
  ['laax', 'flims', 'falera', 'flims laax falera'],

  // Switzerland - Saas Fee
  ['saas fee', 'saas grund', 'saas almagell', 'saas tal', 'saastal'],

  // Switzerland - Jungfrau Region
  ['jungfrau', 'grindelwald', 'wengen', 'murren', 'kleine scheidegg', 'lauterbrunnen'],

  // Switzerland - Crans Montana
  ['crans montana', 'crans', 'montana'],

  // Switzerland - Arosa Lenzerheide
  ['arosa', 'lenzerheide', 'arosa lenzerheide'],

  // Italy - Dolomiti Superski
  ['dolomiti superski', 'dolomites', 'dolomiti', 'sella ronda', 'alta badia',
   'val gardena', 'val di fassa', 'arabba', 'marmolada', 'cortina', 'kronplatz',
   'plan de corones', 'san cassiano', 'corvara', 'ortisei', 'selva', 'canazei',
   'campitello', 'moena'],

  // Italy - Via Lattea (Milky Way)
  ['via lattea', 'milky way', 'sestriere', 'sauze doulx', "sauze d'oulx",
   'sansicario', 'claviere', 'cesana', 'montgenevre'],

  // Italy - Madonna di Campiglio
  ['madonna di campiglio', 'campiglio', 'pinzolo', 'folgarida', 'marilleva'],

  // Italy - Livigno
  ['livigno', 'mottolino', 'carosello 3000'],

  // Italy - Bormio
  ['bormio', 'santa caterina', 'valdidentro', 'alta valtellina'],

  // USA - Colorado
  ['vail', 'beaver creek', 'vail resorts'],
  ['breckenridge', 'breck', 'keystone', 'arapahoe basin', 'a basin'],
  ['aspen', 'snowmass', 'aspen highlands', 'buttermilk', 'aspen mountain'],
  ['telluride'],
  ['steamboat', 'steamboat springs'],
  ['winter park', 'mary jane'],
  ['copper mountain', 'copper'],

  // USA - Utah
  ['park city', 'canyons', 'park city mountain'],
  ['deer valley'],
  ['snowbird', 'alta', 'snowbird alta'],
  ['brighton', 'solitude', 'big cottonwood'],

  // USA - California
  ['mammoth', 'mammoth mountain', 'mammoth lakes'],
  ['squaw valley', 'palisades tahoe', 'alpine meadows'],
  ['heavenly', 'kirkwood', 'northstar'],

  // USA - Wyoming/Montana
  ['jackson hole', 'jackson', 'teton village'],
  ['big sky', 'moonlight basin'],

  // USA - Vermont
  ['killington', 'pico'],
  ['stowe', 'smugglers notch', 'smuggs'],

  // Canada
  ['whistler', 'blackcomb', 'whistler blackcomb'],
  ['revelstoke'],
  ['big white'],
  ['sun peaks'],
  ['lake louise', 'sunshine village', 'mt norquay', 'banff'],
  ['mont tremblant', 'tremblant'],

  // Japan
  ['niseko', 'niseko united', 'hirafu', 'hanazono', 'niseko village', 'annupuri'],
  ['hakuba', 'hakuba valley', 'happo one', 'happo', 'goryu', 'hakuba 47'],
  ['nozawa onsen', 'nozawa'],
  ['myoko', 'myoko kogen', 'akakura'],
  ['rusutsu'],
  ['furano'],
  ['shiga kogen'],

  // New Zealand
  ['queenstown', 'remarkables', 'coronet peak', 'cardrona', 'treble cone'],
  ['wanaka', 'cardrona', 'treble cone'],
  ['mt hutt', 'mount hutt'],

  // Spain/Andorra
  ['grandvalira', 'soldeu', 'el tarter', 'pas de la casa', 'grau roig', 'andorra'],
  ['baqueira beret', 'baqueira', 'beret'],
  ['sierra nevada', 'pradollano'],

  // Scandinavia
  ['are', 'åre', 'duved', 'tegefjall'],
  ['hemsedal'],
  ['trysil'],
  ['geilo'],

  // Germany
  ['garmisch', 'garmisch partenkirchen', 'zugspitze'],
  ['oberstdorf', 'fellhorn', 'nebelhorn'],
];

// Build a lookup map from any term to all related terms
const synonymLookup = new Map<string, Set<string>>();

function normalizeForLookup(term: string): string {
  return term
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}

// Build the lookup map
for (const group of synonymGroups) {
  const normalizedGroup = group.map(normalizeForLookup);

  for (const term of normalizedGroup) {
    if (!synonymLookup.has(term)) {
      synonymLookup.set(term, new Set());
    }
    // Add all other terms in the group as related
    for (const related of normalizedGroup) {
      if (related !== term) {
        synonymLookup.get(term)!.add(related);
      }
    }
  }
}

/**
 * Get related search terms for a given query
 * Returns terms that should also be searched when the query is entered
 */
export function getRelatedSearchTerms(query: string): string[] {
  const normalized = normalizeForLookup(query);
  const related = new Set<string>();

  // Check each word and phrase in the query
  const words = normalized.split(/\s+/);

  // Check the full query
  if (synonymLookup.has(normalized)) {
    for (const term of synonymLookup.get(normalized)!) {
      related.add(term);
    }
  }

  // Check individual words (for cases like "meribel" matching the group)
  for (const word of words) {
    if (word.length >= 3 && synonymLookup.has(word)) {
      for (const term of synonymLookup.get(word)!) {
        related.add(term);
      }
    }
  }

  // Check if query is a substring of any synonym
  for (const [term, relatedTerms] of synonymLookup.entries()) {
    if (term.includes(normalized) && normalized.length >= 3) {
      related.add(term);
      for (const rel of relatedTerms) {
        related.add(rel);
      }
    }
  }

  return Array.from(related);
}

/**
 * Check if a ski area name matches any of the related terms
 */
export function matchesRelatedTerms(
  areaName: string,
  relatedTerms: string[]
): boolean {
  const normalizedName = normalizeForLookup(areaName);

  for (const term of relatedTerms) {
    if (normalizedName.includes(term) || term.includes(normalizedName)) {
      return true;
    }
  }

  return false;
}
