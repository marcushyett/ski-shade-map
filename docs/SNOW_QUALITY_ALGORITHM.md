# Snow Quality Scoring Algorithm

This document explains how the ski-shade-map calculates snow quality scores for each piste.

## Overview

The snow quality score is a **0-100% rating** that predicts snow conditions for each run based on:

- Recent weather history (last 7 days)
- Current conditions (temperature, sun exposure, wind)
- Slope characteristics (aspect, steepness, altitude)
- Time of day (conditions deteriorate through the day)

## Base Score

Every run starts with a **base score of 50%** (neutral conditions). Various factors then add or subtract from this base.

## Scoring Factors

### 1. Fresh Snow (+10 to +30)

The most impactful positive factor. Recent snowfall dramatically improves conditions.

| Condition | Score Impact |
|-----------|--------------|
| Snow in last 24 hours, >10cm | +30 |
| Snow in last 2 days, >5cm | +20 |
| Snow in last 4 days, >10cm | +10 |

### 2. Temperature (-20 to +5)

Temperature affects snow structure significantly.

| Condition | Score Impact |
|-----------|--------------|
| Very warm (>5°C) | -20 |
| Warm (>0°C) + sun-facing + sun up | -10 |
| Very cold (<-10°C) | +5 |

### 3. Altitude (-10 to +10)

Higher altitude means better snow preservation.

| Condition | Score Impact |
|-----------|--------------|
| High altitude (>2500m) | +10 |
| Low altitude (<1500m) | -10 |

### 4. Time of Day (-10 to 0)

Conditions typically worsen through the day as snow gets skied out and temperatures rise.

| Condition | Score Impact |
|-----------|--------------|
| Late afternoon (after 3pm) + warm day | -10 |
| Morning | 0 |

### 5. Sun Exposure (-10 to +5)

Slope aspect relative to sun position affects melting and preservation.

| Condition | Score Impact |
|-----------|--------------|
| Sun-facing + warm + sun up | -10 |
| Shaded (north-facing) + warm weather | +5 |

**Sun-facing definition**: Slope aspect is within 60° of the sun's azimuth.

### 6. Wind (-10 to 0)

High winds create hardpack and scoured conditions.

| Condition | Score Impact |
|-----------|--------------|
| High wind (>30 km/h) | -10 |
| Calm | 0 |

### 7. Steepness / Mogul Formation (-5 to 0)

Steep runs develop moguls through the day.

| Condition | Score Impact |
|-----------|--------------|
| Steep (>25°) + afternoon | -5 |
| Gentle or morning | 0 |

## Final Score Calculation

```
Final Score = Base (50) + Fresh Snow + Temperature + Altitude + Time + Sun + Wind + Steepness
```

The final score is **clamped to 0-100%**.

## Condition Types

Based on the score and weather factors, the algorithm determines a condition type. Conditions are checked in priority order:

| Priority | Condition | When Assigned |
|----------|-----------|---------------|
| 1 | **Powder** | Fresh snow (<1 day), >15cm, temp <0°C |
| 2 | **Fresh Groomed** | Morning, recent snow (<3 days), temp <2°C |
| 3 | **Slush** | Warm (>5°C) or sun-facing in warm conditions |
| 4 | **Icy** | Very cold (<-5°C), no recent snow (>5 days), cold nights |
| 5 | **Spring Snow** | Freeze-thaw cycle (max >3°C, min <-3°C), morning |
| 6 | **Wind-affected** | Wind >40 km/h |
| 7 | **Moguls** | Steep (>28°) + afternoon |
| 8 | **Crusty** | Freeze-thaw cycle, no recent snow |
| 9 | **Packed Powder** | Score ≥60%, temp <2°C |
| 10 | **Hard Pack** | Score ≥40%, temp <0°C |
| 11 | **Fresh Groomed** | Morning, score ≥35% (default morning state) |
| 12 | **Packed Powder** | Afternoon, score ≥50%, temp <5°C |
| 13 | **Hard Pack** | Temp <2°C, score ≥30% |
| 14 | **Spring Snow** | Temp 0-5°C, score ≥30% (softening) |
| 15 | **Variable** | Score ≥30% (rare fallback) |
| 16 | **Poor** | Score <30% |

## Color Scale

The score is displayed with a color indicating quality:

| Score Range | Color | Meaning |
|-------------|-------|---------|
| 70-100% | 🟢 Green | Excellent conditions |
| 50-70% | 🟡 Lime | Good conditions |
| 40-50% | ⚪ Gray | Fair conditions |
| 25-40% | 🟠 Orange | Poor conditions |
| 0-25% | 🔴 Red | Bad conditions |

## Altitude-Based Calculation

For elevation profile displays, the algorithm calculates snow quality at different elevations along the run. This accounts for:

- Temperature lapse rate (~6.5°C per 1000m)
- Different sun exposure at different elevations
- Varying wind exposure

## Data Sources

The algorithm uses:

1. **Hourly Weather**: Temperature, wind speed for current conditions
2. **Daily Weather**: Snowfall totals, max/min temperatures for the last 7 days
3. **Run Geometry**: Coordinates with elevation data for aspect, altitude, and steepness calculations

## Limitations

- **Grooming schedule unknown**: We assume morning runs are groomed but don't know actual grooming times
- **Microclimate variations**: Local wind patterns, tree cover, etc. are not modeled
- **Snowpack depth**: We only consider recent snowfall, not total snowpack
- **Humidity/precipitation type**: Rain events are not specifically tracked
- **Ski traffic**: Popular runs degrade faster but we don't have traffic data

## Implementation

The algorithm is implemented in `src/lib/snow-quality.ts`:

- `calculateSnowQuality()` - Main scoring function for a single run
- `calculateSnowQualityByAltitude()` - Score at different elevations
- `analyzeResortSnowQuality()` - Analyze all runs in a resort
- `calculateResortSnowSummary()` - Overall resort summary
- `determineCondition()` - Map score/weather to condition type

