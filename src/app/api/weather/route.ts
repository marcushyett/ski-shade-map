import { NextRequest, NextResponse } from 'next/server';
import { fetchWeatherData } from '@/lib/weather-client';
import type { WeatherData } from '@/lib/weather-types';

export const dynamic = 'force-dynamic';

// In-memory cache for weather data
// Key: "lat,lng" (rounded to 2 decimals), Value: { data, fetchedAt }
const weatherCache = new Map<string, { data: WeatherData; fetchedAt: Date }>();

// Cache duration: 1 hour
const CACHE_DURATION_MS = 60 * 60 * 1000;

// Clean up old cache entries periodically
function cleanupCache() {
  const now = new Date();
  for (const [key, value] of weatherCache.entries()) {
    if (now.getTime() - value.fetchedAt.getTime() > CACHE_DURATION_MS * 2) {
      weatherCache.delete(key);
    }
  }
}

function getCacheKey(lat: number, lng: number): string {
  // Round to 2 decimal places to group nearby locations
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  
  const latStr = searchParams.get('lat');
  const lngStr = searchParams.get('lng');
  const forceRefresh = searchParams.get('refresh') === 'true';

  if (!latStr || !lngStr) {
    return NextResponse.json(
      { error: 'Missing lat or lng parameters' },
      { status: 400 }
    );
  }

  const lat = parseFloat(latStr);
  const lng = parseFloat(lngStr);

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json(
      { error: 'Invalid lat or lng values' },
      { status: 400 }
    );
  }

  const cacheKey = getCacheKey(lat, lng);

  // Check cache first (unless force refresh)
  if (!forceRefresh) {
    const cached = weatherCache.get(cacheKey);
    if (cached) {
      const age = Date.now() - cached.fetchedAt.getTime();
      if (age < CACHE_DURATION_MS) {
        return NextResponse.json({
          ...cached.data,
          cached: true,
          cacheAge: Math.round(age / 1000), // seconds
        });
      }
    }
  }

  try {
    // Fetch fresh data
    const weatherData = await fetchWeatherData(lat, lng);
    
    // Store in cache
    weatherCache.set(cacheKey, {
      data: weatherData,
      fetchedAt: new Date(),
    });

    // Cleanup old entries occasionally
    if (weatherCache.size > 100) {
      cleanupCache();
    }

    return NextResponse.json({
      ...weatherData,
      cached: false,
    });
  } catch (error) {
    console.error('Weather API error:', error);
    
    // Return cached data if available, even if expired
    const cached = weatherCache.get(cacheKey);
    if (cached) {
      return NextResponse.json({
        ...cached.data,
        cached: true,
        stale: true,
        error: 'Using cached data due to API error',
      });
    }

    return NextResponse.json(
      { error: 'Failed to fetch weather data', details: String(error) },
      { status: 500 }
    );
  }
}

