// Web worker for preloading and processing location search data
// This runs in a separate thread to avoid blocking the UI

// Note: Workers can't use TypeScript path aliases, so we define types inline

interface RawLocation {
  id: string;
  type: 'region' | 'locality';
  name: string;
  country: string | null;
  region?: string;
  skiAreaId: string;
  lat?: number;
  lng?: number;
  runs?: number;
  lifts?: number;
}

export interface ProcessedLocation {
  id: string;
  type: 'region' | 'locality';
  name: string;
  nameNorm: string;
  country: string | null;
  countryNorm: string;
  region?: string;
  regionNorm: string;
  skiAreaId: string;
  lat?: number;
  lng?: number;
  runs?: number;
  lifts?: number;
  searchText: string;
}

// Normalize text for matching - same logic as main thread
function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

self.onmessage = async (event: MessageEvent) => {
  if (event.data.type !== 'start') return;

  try {
    // Notify: fetching
    self.postMessage({ type: 'progress', stage: 'fetching' });

    const response = await fetch(event.data.apiUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const rawData: RawLocation[] = await response.json();

    // Notify: processing
    self.postMessage({ type: 'progress', stage: 'processing' });

    // Pre-normalize all text fields (CPU-intensive, done off main thread)
    const processedData: ProcessedLocation[] = rawData.map((loc) => {
      const nameNorm = normalizeText(loc.name);
      const countryNorm = loc.country ? normalizeText(loc.country) : '';
      const regionNorm = loc.region ? normalizeText(loc.region) : '';

      return {
        id: loc.id,
        type: loc.type,
        name: loc.name,
        nameNorm,
        country: loc.country,
        countryNorm,
        region: loc.region,
        regionNorm,
        skiAreaId: loc.skiAreaId,
        lat: loc.lat,
        lng: loc.lng,
        runs: loc.runs,
        lifts: loc.lifts,
        searchText: `${nameNorm} ${regionNorm} ${countryNorm}`.trim(),
      };
    });

    // Send processed data back to main thread
    self.postMessage({ type: 'complete', data: processedData });
  } catch (error) {
    self.postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
