/**
 * Fuzzy name matching utilities for ski runs and lifts
 *
 * Used to match names between different data sources (OpenSkiMap vs resort status providers)
 * which may have slight variations in naming conventions.
 */

/**
 * Normalize a name for comparison:
 * - Lowercase
 * - Remove special characters except spaces
 * - Collapse multiple spaces
 * - Trim
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract tokens (words) from a name
 */
function getTokens(name: string): Set<string> {
  return new Set(normalizeName(name).split(' ').filter(t => t.length > 0));
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity ratio (0-1) based on Levenshtein distance
 */
function similarityRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

/**
 * Check if two names match using fuzzy matching
 *
 * Matching strategies (in order of priority):
 * 1. Exact match (after normalization)
 * 2. One name contains the other
 * 3. Significant token overlap (>= 50% of tokens match)
 * 4. High Levenshtein similarity (>= 0.8)
 */
export function fuzzyMatchName(name1: string, name2: string): boolean {
  const norm1 = normalizeName(name1);
  const norm2 = normalizeName(name2);

  // Empty names don't match
  if (!norm1 || !norm2) return false;

  // 1. Exact match
  if (norm1 === norm2) return true;

  // 2. One contains the other (for cases like "Piste 1" vs "Piste 1 - Blue Run")
  if (norm1.includes(norm2) || norm2.includes(norm1)) return true;

  // 3. Token overlap
  const tokens1 = getTokens(name1);
  const tokens2 = getTokens(name2);

  if (tokens1.size > 0 && tokens2.size > 0) {
    let matchingTokens = 0;
    for (const token of tokens1) {
      if (tokens2.has(token)) {
        matchingTokens++;
      }
    }

    const minTokens = Math.min(tokens1.size, tokens2.size);
    const overlapRatio = matchingTokens / minTokens;

    // If at least 50% of the smaller set's tokens match, consider it a match
    if (overlapRatio >= 0.5 && matchingTokens >= 1) return true;
  }

  // 4. Levenshtein similarity for short names
  // Only use this for reasonably short names to avoid false positives
  if (norm1.length <= 20 && norm2.length <= 20) {
    if (similarityRatio(norm1, norm2) >= 0.8) return true;
  }

  return false;
}

/**
 * Create a fuzzy matcher function for a set of names
 * Pre-processes the set for efficient matching
 */
export function createFuzzyMatcher(namesSet: Set<string>): (name: string) => boolean {
  // Pre-normalize all names in the set
  const normalizedNames = new Set<string>();
  const originalNames: string[] = [];

  for (const name of namesSet) {
    normalizedNames.add(normalizeName(name));
    originalNames.push(name);
  }

  return (name: string): boolean => {
    const normalizedName = normalizeName(name);

    // Quick exact match check first
    if (normalizedNames.has(normalizedName)) return true;

    // Fall back to full fuzzy matching
    for (const setName of originalNames) {
      if (fuzzyMatchName(name, setName)) return true;
    }

    return false;
  };
}
