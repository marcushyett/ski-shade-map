# Ski Shade Map ⛷️

An interactive map application that shows sun exposure on ski runs throughout the day. Pick a ski area, choose a time, and see which slopes will be sunny or shaded.

## Features

- 🗺️ **Interactive Map**: View ski runs overlaid on terrain with 2D/3D toggle
- ☀️ **Sun Position Calculation**: Real-time shade visualization based on sun position
- ⏰ **Time Slider**: See how sun exposure changes throughout the day
- 🌍 **Global Coverage**: Ski areas worldwide (data from OpenSkiMap)
- 📱 **Mobile-First**: Optimized for mobile with desktop support
- 🎿 **Run Difficulty**: Color-coded by difficulty (green/blue/red/black)

## Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript
- **UI**: Ant Design, Tailwind CSS
- **Maps**: MapLibre GL JS with MapTiler tiles
- **Database**: NeonDB (PostgreSQL) via Prisma
- **Deployment**: Vercel
- **Data**: OpenSkiMap GeoJSON

## Setup

### Prerequisites

- Node.js 18+
- npm or yarn
- A Vercel account
- A MapTiler account (free tier available)

### 1. Clone and Install

```bash
git clone https://github.com/yourusername/ski-shade-map.git
cd ski-shade-map
npm install
```

### 2. Get API Keys

#### MapTiler (Required for maps)
1. Sign up at [MapTiler Cloud](https://cloud.maptiler.com/)
2. Create a new API key
3. Free tier includes 100,000 requests/month

### 3. Set Up Database with Vercel

1. Go to [Vercel Dashboard](https://vercel.com)
2. Create a new project and import your repository
3. In the project settings, go to **Storage** → **Create Database**
4. Select **Neon** and follow the setup wizard
5. Vercel will automatically add `DATABASE_URL` and `DIRECT_URL` to your environment variables

### 4. Configure Environment Variables

Create a `.env` file (for local development):

```env
DATABASE_URL="your-neon-connection-string"
DIRECT_URL="your-neon-direct-connection-string"
NEXT_PUBLIC_MAPTILER_KEY="your-maptiler-key"
SYNC_SECRET="a-secret-key-for-data-sync"
```

In Vercel, add these environment variables in Project Settings → Environment Variables.

### 5. Set Up Database Schema

```bash
npx prisma generate
npx prisma db push
```

### 6. Sync Ski Area Data

After deployment, trigger a data sync by calling the sync endpoint:

```bash
# Sync all ski areas (may take a few minutes)
curl -X POST "https://your-app.vercel.app/api/sync?type=all" \
  -H "Authorization: Bearer your-sync-secret"

# Or sync just France
curl -X POST "https://your-app.vercel.app/api/sync?type=all&country=FR" \
  -H "Authorization: Bearer your-sync-secret"
```

### 7. Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Data Sources

| Data | Source | License |
|------|--------|---------|
| Ski Areas, Runs, Lifts | [OpenSkiMap](https://openskimap.org) | ODbL |
| Map Tiles | [MapTiler](https://maptiler.com) | Free tier |
| Sun Position | [SunCalc](https://github.com/mourner/suncalc) | BSD-2 |

## Shade Calculation

The shade calculation uses a simplified model based on:
- **Slope orientation**: Which direction the ski run faces
- **Sun azimuth**: The compass direction of the sun
- **Sun altitude**: How high the sun is above the horizon

For full accuracy, you would need Digital Elevation Model (DEM) data and ray-tracing, which could be added as a future enhancement.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ski-areas` | GET | List ski areas with search/filter |
| `/api/ski-areas/[id]` | GET | Get ski area details with runs and lifts |
| `/api/ski-areas/countries` | GET | List countries with ski area counts |
| `/api/sun` | GET | Calculate sun position for coordinates and time |
| `/api/sync` | POST | Sync ski area data from OpenSkiMap |

## Future Enhancements

- [ ] Live lift/run status integration
- [ ] Offline map download (PWA)
- [ ] Real DEM-based shadow calculation
- [ ] Weather overlay
- [ ] User favorites
- [ ] Multi-language support

## License

MIT
