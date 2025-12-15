# Cost Optimization Guide for Ski Shade Map

This document provides detailed cost analysis and optimization strategies for scaling the Ski Shade Map application.

## Table of Contents
1. [Weather Service Optimization](#weather-service-optimization)
2. [Map Tile Caching Strategies](#map-tile-caching-strategies)
3. [Database Optimization](#database-optimization)
4. [Additional Cost Optimizations](#additional-cost-optimizations)
5. [Cost Projections Summary](#cost-projections-summary)

---

## Weather Service Optimization

### Current Implementation ✅

The weather API (`/api/weather/route.ts`) already has excellent caching:

| Feature | Implementation | Benefit |
|---------|---------------|---------|
| In-memory cache | 1-hour TTL | Reduces API calls within same Vercel instance |
| Coordinate rounding | 2 decimal places (~1.1km) | Groups nearby requests together |
| CDN caching | `s-maxage=3600` | Caches at Vercel edge for 1 hour |
| Stale-while-revalidate | 2 hours | Serves stale data while refreshing |
| Graceful fallback | Returns expired cache on errors | Prevents cascading failures |

### Weather Service Cost Analysis

**Open-Meteo Pricing:**
- ✅ **Free** for non-commercial use
- Commercial: €100-500/month for high volume

**Current Efficiency:**
- Coordinate rounding means ~100 ski resorts = ~100 unique cache keys
- 1-hour cache + CDN means most requests are served from edge
- **Estimated cost at scale: $0-100/month** (depending on commercial status)

### Recommended Improvements

#### 1. Add Redis/Upstash for Cross-Instance Caching

The in-memory cache only works per Vercel serverless instance. For true global caching:

```typescript
// Example: Use Upstash Redis (has generous free tier: 10K commands/day)
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL,
  token: process.env.UPSTASH_REDIS_TOKEN,
});

// In weather route:
const cacheKey = `weather:${lat.toFixed(2)},${lng.toFixed(2)}`;
const cached = await redis.get(cacheKey);
if (cached) return cached;

// After fetching:
await redis.setex(cacheKey, 3600, weatherData);
```

**Cost:** Upstash free tier = 10K commands/day. At scale: ~$10-50/month.

#### 2. Pre-warm Weather Cache for Popular Resorts

Add a cron job to pre-fetch weather for top ski resorts:

```typescript
// /api/cron/weather-prefetch/route.ts
const popularResorts = await prisma.skiArea.findMany({
  take: 50,
  orderBy: { /* popularity metric */ }
});

for (const resort of popularResorts) {
  await fetch(`/api/weather?lat=${resort.latitude}&lng=${resort.longitude}`);
}
```

---

## Map Tile Caching Strategies

### Current Cost Problem 🚨

**MapTiler is the #1 cost concern at scale:**
- Free tier: 100K map loads/month
- Overage: ~$0.50 per 1,000 loads
- At 1M users × 3 views × 30 days = **90M loads = ~$45,000/month**

### Current Client-Side Caching ✅

The Service Worker (`sw.js`) already caches tiles locally:

```javascript
// Cache-first strategy for map tiles
if (url.hostname.includes('maptiler.com') || url.hostname.includes('tiles.')) {
  // Returns cached tile if available, fetches and caches if not
}
```

**Limitation:** Each user has their own cache. No sharing between users.

### Recommended Solutions

#### Option 1: Self-Hosted Tile Server (Best for Scale)

Deploy your own tile server using free OpenStreetMap tiles + open terrain data.

**Architecture:**
```
Users → CloudFlare CDN → Your Tile Proxy → OpenFreeMap/OpenMapTiles
                ↓
         Cached Tiles (R2/S3)
```

**Implementation:**

1. **Replace MapTiler style with OpenFreeMap:**
```typescript
// In SkiMap.tsx
const style = 'https://tiles.openfreemap.org/styles/liberty/style.json';
```

2. **Self-host terrain tiles:**
   - Use Mapzen Terrain Tiles (free, open data)
   - Host on CloudFlare R2 ($0.015/GB storage, free egress)

**Cost:** ~$20-100/month for CDN + storage (vs $45,000 with MapTiler)

#### Option 2: CloudFlare Tile Proxy (Medium Complexity)

Create a CloudFlare Worker that proxies and caches MapTiler requests:

```javascript
// CloudFlare Worker
export default {
  async fetch(request) {
    const cache = caches.default;
    const cached = await cache.match(request);
    if (cached) return cached;

    // Proxy to MapTiler
    const response = await fetch(request.url.replace(
      'your-domain.com/tiles',
      'api.maptiler.com'
    ));

    // Cache for 30 days (tiles don't change often)
    const responseToCache = new Response(response.body, response);
    responseToCache.headers.set('Cache-Control', 'public, max-age=2592000');
    await cache.put(request, responseToCache.clone());

    return responseToCache;
  }
};
```

**Benefits:**
- CloudFlare caches globally
- Ski resorts are geographically concentrated = high cache hit rate
- Free tier: 100K requests/day

**Cost:** $5/month (Workers paid plan) + reduced MapTiler usage

#### Option 3: Vercel Edge Config for Tile URLs (Simplest)

Pre-generate static tile images for popular zoom levels at known ski resorts:

```typescript
// Generate static images for resort bounds at zoom 13-16
// Store in Vercel Blob or CloudFlare R2
// Serve as fallback when MapTiler quota exceeded
```

### Terrain DEM Optimization

Terrain data (for hillshading/3D) is currently fetched from MapTiler:

```typescript
// Current: MapTiler terrain
url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${MAPTILER_KEY}`

// Alternative: Self-hosted Mapzen tiles
url: 'https://your-cdn.com/terrain/{z}/{x}/{y}.png'
```

**Free terrain sources:**
- Mapzen Terrain Tiles (AWS Open Data - free)
- Copernicus DEM (EU Copernicus - free)

---

## Database Optimization

### Current Setup

- PostgreSQL via Prisma
- Single connection per serverless function

### Scaling Concerns

At high load, you'll hit connection limits:
- Typical PostgreSQL: 100-200 max connections
- Each Vercel function = 1 connection
- 100 concurrent requests = 100 connections 💥

### Recommended Solutions

#### 1. Add Prisma Accelerate (Connection Pooling)

```bash
npm install @prisma/extension-accelerate
```

```typescript
// prisma.ts
import { PrismaClient } from '@prisma/client/edge';
import { withAccelerate } from '@prisma/extension-accelerate';

export const prisma = new PrismaClient().$extends(withAccelerate());
```

**Cost:** Free for small usage, ~$25-100/month at scale

#### 2. Add API Response Caching

Cache ski area data aggressively (it changes monthly):

```typescript
// /api/ski-areas/route.ts
export async function GET(request: NextRequest) {
  // ... existing code ...
  
  return NextResponse.json(data, {
    headers: {
      // Cache for 24 hours at edge
      'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
    },
  });
}
```

#### 3. Use Edge Runtime for Read-Only APIs

```typescript
export const runtime = 'edge'; // Faster cold starts, global distribution
```

---

## Additional Cost Optimizations

### 1. PostHog Analytics

**Current:** Tracking all map interactions (zoom, pan, clicks)

**At scale:** 1M users × 50 events/session = 50M events/month

**Free tier:** 1M events/month

**Optimization:**
```typescript
// Reduce event frequency
const trackEvent = (name, props) => {
  // Sample 10% of users at scale
  if (Math.random() > 0.1) return;
  posthog.capture(name, props);
};
```

### 2. Vercel Bandwidth

**Current:** Each page load sends ski area GeoJSON (can be 1-5MB)

**Optimization:**
- Enable gzip/brotli compression (automatic with Vercel)
- Implement delta updates (only send changes)
- Use Vercel Edge Caching for static data

### 3. Image/Asset Optimization

```typescript
// next.config.ts
export default {
  images: {
    minimumCacheTTL: 31536000, // 1 year
  },
};
```

---

## Cost Projections Summary

### With Current Architecture

| Scale | Users/Month | MapTiler | Weather | Database | Total |
|-------|------------|----------|---------|----------|-------|
| Small | 1K | $0 | $0 | $0 | **$0** |
| Medium | 50K | $200 | $0 | $25 | **$225** |
| Large | 500K | $2,500 | $50 | $100 | **$2,650** |
| Huge | 1M | $5,000+ | $100 | $200 | **$5,300+** |

### With Optimizations Applied

| Scale | Users/Month | Tiles (Self-hosted) | Weather (Redis) | Database (Pooled) | Total |
|-------|------------|---------------------|-----------------|-------------------|-------|
| Small | 1K | $0 | $0 | $0 | **$0** |
| Medium | 50K | $20 | $10 | $25 | **$55** |
| Large | 500K | $50 | $30 | $50 | **$130** |
| Huge | 1M | $100 | $50 | $100 | **$250** |

### Key Takeaways

1. **MapTiler → Self-hosted tiles** = 90%+ cost reduction
2. **Redis weather caching** = Minimal incremental cost
3. **Database connection pooling** = Essential at 10K+ users
4. **Edge caching everywhere** = Free performance boost

---

## Implementation Priority

1. **Immediate (before scaling):**
   - Switch to OpenFreeMap or add CloudFlare tile proxy
   - Add `Cache-Control` headers to all API routes

2. **At 10K users:**
   - Add Redis for weather caching (Upstash free tier)
   - Add Prisma Accelerate for connection pooling

3. **At 100K users:**
   - Self-host terrain tiles on CloudFlare R2
   - Implement PostHog sampling
   - Consider dedicated database

4. **At 1M users:**
   - Full self-hosted tile infrastructure
   - Consider Kubernetes/dedicated hosting vs serverless
