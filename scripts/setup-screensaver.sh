#!/bin/bash
# setup-screensaver.sh — Download alpaca artwork + configure macOS screensaver
# Run on Alpaca Mac: bash setup-screensaver.sh
#
# Prerequisites:
# - Supabase anon key (hardcoded, same as in shared/supabase.js)
# - curl + jq installed
# - Images generated in image_gen_jobs with batch_label 'Alpaca Mac Screensaver'

set -euo pipefail

SUPABASE_URL="https://aphrrfprbixmhissnjfn.supabase.co"
SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwaHJyZnByYml4bWhpc3NuamZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc0OTQ0ODQsImV4cCI6MjA1MzA3MDQ4NH0.Q0dRQJmsH7VHQw16bd2fHFj72OYOIlFrXEJuV4lAKhw"
SCREENSAVER_DIR="$HOME/Pictures/AlpacaScreensaver"

echo "🦙 Alpaca Screensaver Setup"
echo "=========================="

# 1. Create screensaver image folder
mkdir -p "$SCREENSAVER_DIR"
echo "✓ Created folder: $SCREENSAVER_DIR"

# 2. Fetch completed screensaver image URLs from Supabase
echo "⏳ Fetching generated images..."
RESPONSE=$(curl -s \
  "${SUPABASE_URL}/rest/v1/image_gen_jobs?batch_label=eq.Alpaca%20Mac%20Screensaver&status=eq.completed&select=id,result_url,prompt" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}")

COUNT=$(echo "$RESPONSE" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

if [ "$COUNT" = "0" ]; then
  echo "⚠️  No completed images found yet."
  echo "   The image generation jobs are queued and will complete when the Gemini API quota resets."
  echo "   Re-run this script later: bash ~/setup-screensaver.sh"
  echo ""
  echo "   Checking job status..."
  STATUS=$(curl -s \
    "${SUPABASE_URL}/rest/v1/image_gen_jobs?batch_label=eq.Alpaca%20Mac%20Screensaver&select=id,status" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_ANON_KEY}")
  echo "$STATUS" | python3 -c "
import sys, json
jobs = json.load(sys.stdin)
for j in jobs:
    print(f'   {j[\"id\"][:8]}... → {j[\"status\"]}')
print(f'   Total: {len(jobs)} jobs')
"
  exit 1
fi

echo "✓ Found $COUNT completed images"

# 3. Download each image
echo "⏳ Downloading images..."
INDEX=0
echo "$RESPONSE" | python3 -c "
import sys, json
jobs = json.load(sys.stdin)
for j in jobs:
    if j.get('result_url'):
        print(j['result_url'])
" | while read -r URL; do
  INDEX=$((INDEX + 1))
  FILENAME="alpaca_${INDEX}.png"
  echo "   Downloading $FILENAME..."
  curl -sL "$URL" -o "${SCREENSAVER_DIR}/${FILENAME}"
done

DOWNLOADED=$(ls -1 "$SCREENSAVER_DIR"/*.png 2>/dev/null | wc -l | tr -d ' ')
echo "✓ Downloaded $DOWNLOADED images to $SCREENSAVER_DIR"

# 4. Configure macOS screensaver
echo "⏳ Configuring screensaver..."

# Set screensaver to iLifeSlideshows (Ken Burns effect)
defaults -currentHost write com.apple.screensaver moduleDict -dict \
  moduleName "iLifeSlideshows" \
  path "/System/Library/Frameworks/ScreenSaver.framework/PlugIns/iLifeSlideshows.appex" \
  type -int 0

# Configure Ken Burns style with our custom folder
defaults -currentHost write com.apple.ScreenSaver.iLifeSlideshows styleKey "KenBurns"
defaults -currentHost write com.apple.ScreenSaver.iLifeSlideshows selectedFolderPath "$SCREENSAVER_DIR"
defaults -currentHost write com.apple.ScreenSaver.iLifeSlideshows selectedSource -int 4

# Set screensaver to activate after 5 minutes of inactivity
defaults -currentHost write com.apple.screensaver idleTime -int 300

# Disable screen lock (this is a home server, no need for lock screen)
defaults -currentHost write com.apple.screensaver askForPassword -int 0

echo "✓ Screensaver configured: Ken Burns effect"
echo "✓ Activates after 5 minutes of inactivity"
echo ""
echo "🦙 Done! Your Alpaca Mac will now show alpaca-themed artwork"
echo "   as a screensaver with the Ken Burns pan/zoom effect."
echo ""
echo "   Preview: open System Preferences → Screen Saver"
echo "   Images: $SCREENSAVER_DIR"
