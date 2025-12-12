# Ski Shade Map - Setup Guide

Your app is deployed at: **https://ski-shade-map.vercel.app**

## Step 1: Get a MapTiler API Key (Required for maps)

1. Go to [MapTiler Cloud](https://cloud.maptiler.com/account/keys/)
2. Sign up for a free account (100k requests/month free)
3. Create a new API key
4. Copy the key

## Step 2: Set Up NeonDB via Vercel Dashboard

1. Go to your [Vercel Project Dashboard](https://vercel.com/marchyett-gmailcoms-projects/ski-shade-map)
2. Click on **Storage** tab
3. Click **Create Database** → Select **Neon**
4. Follow the wizard to create a new Neon PostgreSQL database
5. Vercel will automatically add `DATABASE_URL` and `DIRECT_URL` to your environment variables

## Step 3: Add Environment Variables

In your Vercel project settings (Settings → Environment Variables), add:

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_MAPTILER_KEY` | Your MapTiler API key |
| `SYNC_SECRET` | A random secret string (e.g., `your-secret-key-12345`) |

The DATABASE_URL should already be set from Step 2.

## Step 4: Deploy Again

After adding environment variables, redeploy:

```bash
cd /Users/marcushyett/dev/ski-shade-map
npx vercel deploy --prod
```

Or push to git if you have git integration enabled.

## Step 5: Initialize the Database

After the database is connected, run migrations:

```bash
# Set your DATABASE_URL locally first (copy from Vercel)
export DATABASE_URL="your-neon-connection-string"
export DIRECT_URL="your-neon-direct-connection-string"

# Push the schema
npx prisma db push
```

## Step 6: Sync Ski Area Data

Once the database is set up and deployed, sync the ski area data:

```bash
# Sync France ski areas (faster, ~5 minutes)
curl -X POST "https://ski-shade-map.vercel.app/api/sync?type=all&country=FR" \
  -H "Authorization: Bearer your-sync-secret"

# Or sync ALL ski areas globally (slower, ~15-30 minutes)
curl -X POST "https://ski-shade-map.vercel.app/api/sync?type=all" \
  -H "Authorization: Bearer your-sync-secret"
```

## That's it!

After the sync completes, refresh the app and you should be able to:
1. Select a country (France, etc.)
2. Pick a ski area
3. See the runs with sun/shade visualization
4. Use the time slider to see how shadows change throughout the day
5. Toggle between 2D and 3D views

## Troubleshooting

### Map not loading?
- Check that `NEXT_PUBLIC_MAPTILER_KEY` is set correctly
- Make sure you redeployed after adding the environment variable

### No ski areas showing?
- Make sure the database is connected
- Run the sync endpoint (Step 6)
- Check Vercel logs for any errors

### Sync failing?
- Check that DATABASE_URL is set
- Check Vercel function logs for errors
- The sync may time out for global data - try syncing specific countries first

## Data Sources

| Data | Source | Update Frequency |
|------|--------|------------------|
| Ski Areas, Runs, Lifts | [OpenSkiMap](https://openskimap.org) | Community-updated |
| Map Tiles | [MapTiler](https://maptiler.com) | Real-time |
| Sun Position | [SunCalc](https://github.com/mourner/suncalc) | Calculated |

## Future Enhancements (Not Yet Implemented)

- Live lift/run status from resort APIs
- Offline map caching (PWA)
- Real DEM-based shadow ray-tracing
- Weather overlay
- User favorites and accounts

