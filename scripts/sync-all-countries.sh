#!/bin/bash

# Sync ski resort data for multiple countries
# Usage: DATABASE_URL="your-prod-db-url" ./scripts/sync-all-countries.sh
#
# Or if you have .env.production with DATABASE_URL:
# source .env.production && ./scripts/sync-all-countries.sh

# List of countries to sync
# France, Switzerland, Germany, Italy, Bulgaria, Romania, USA, Canada, New Zealand
COUNTRIES=("FR" "CH" "DE" "IT" "BG" "RO" "US" "CA" "NZ")

# Country names for logging
declare -A COUNTRY_NAMES
COUNTRY_NAMES["FR"]="France"
COUNTRY_NAMES["CH"]="Switzerland"
COUNTRY_NAMES["DE"]="Germany"
COUNTRY_NAMES["IT"]="Italy"
COUNTRY_NAMES["BG"]="Bulgaria"
COUNTRY_NAMES["RO"]="Romania"
COUNTRY_NAMES["US"]="USA"
COUNTRY_NAMES["CA"]="Canada"
COUNTRY_NAMES["NZ"]="New Zealand"

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "❌ DATABASE_URL environment variable is not set!"
    echo ""
    echo "To run this script, you need to set your production DATABASE_URL:"
    echo ""
    echo "Option 1 - Inline:"
    echo "  DATABASE_URL=\"postgresql://...\" ./scripts/sync-all-countries.sh"
    echo ""
    echo "Option 2 - Create .env.production file with DATABASE_URL and run:"
    echo "  source .env.production && ./scripts/sync-all-countries.sh"
    echo ""
    echo "Get your DATABASE_URL from Vercel Dashboard → Settings → Environment Variables"
    exit 1
fi

echo "🎿 Starting multi-country ski data sync"
echo "========================================"
echo ""
echo "Countries to sync: ${COUNTRIES[*]}"
echo ""

TOTAL=${#COUNTRIES[@]}
CURRENT=0
FAILED=()

for country in "${COUNTRIES[@]}"; do
    CURRENT=$((CURRENT + 1))
    echo ""
    echo "════════════════════════════════════════════════════════════════"
    echo "[$CURRENT/$TOTAL] Syncing ${COUNTRY_NAMES[$country]} ($country)..."
    echo "════════════════════════════════════════════════════════════════"
    echo ""
    
    if npx tsx scripts/sync-data.ts --country=$country; then
        echo ""
        echo "✅ ${COUNTRY_NAMES[$country]} sync completed!"
    else
        echo ""
        echo "❌ ${COUNTRY_NAMES[$country]} sync failed!"
        FAILED+=("$country")
    fi
done

echo ""
echo "========================================"
echo "🏁 Sync completed!"
echo ""

if [ ${#FAILED[@]} -eq 0 ]; then
    echo "✅ All $TOTAL countries synced successfully!"
else
    echo "⚠️  ${#FAILED[@]} countries failed: ${FAILED[*]}"
fi

