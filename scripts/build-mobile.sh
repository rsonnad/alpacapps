#!/usr/bin/env bash
# build-mobile.sh — build native mobile apps, drop artifacts in mobilebuilds/, write release notes.
#
# Designed to run on Alpuca (Xcode 26.4, Android SDK 35+36, Gradle 9.4, JDK 17).
# Increments versionCode (Android) and CURRENT_PROJECT_VERSION (iOS) atomically — both
# platforms share one monotonic build number tracked by git tag `mobile-build-<N>`.
#
# Usage:
#   scripts/build-mobile.sh android        # build Android APK only
#   scripts/build-mobile.sh ios            # build iOS IPA only (signed if env set)
#   scripts/build-mobile.sh both           # both platforms (default)
#
# Optional env:
#   APPLE_TEAM_ID            Apple Developer team ID (for iOS signing)
#   IOS_EXPORT_METHOD        ad-hoc | development | app-store | enterprise (default: development)
#   IOS_SIGNING_STYLE        Manual | Automatic (default: Automatic)
#   SKIP_TAG=1               Don't create the mobile-build-<N> git tag
#   DRY_RUN=1                Bump version + write notes but skip actual builds

set -euo pipefail

TARGET="${1:-both}"
case "$TARGET" in android|ios|both) ;; *) echo "Usage: $0 [android|ios|both]" >&2; exit 1 ;; esac

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

ANDROID_GRADLE="$PROJECT_ROOT/mobile-android/app/build.gradle.kts"
IOS_PROJ_DIR="$PROJECT_ROOT/mobile-ios"
IOS_PBXPROJ="$IOS_PROJ_DIR/AlpacaPlayhouse.xcodeproj/project.pbxproj"
IOS_SCHEME="AlpacaPlayhouse"
OUT_ROOT="$PROJECT_ROOT/mobilebuilds"

# ── 1) compute next build number ─────────────────────────────────────
android_code=$(grep -E '^\s*versionCode\s*=' "$ANDROID_GRADLE" | head -1 | sed -E 's/.*versionCode\s*=\s*([0-9]+).*/\1/')
ios_code=$(grep -E 'CURRENT_PROJECT_VERSION\s*=' "$IOS_PBXPROJ" | head -1 | sed -E 's/.*CURRENT_PROJECT_VERSION\s*=\s*([0-9]+).*/\1/')
last_tag=$(git tag --list 'mobile-build-*' | sed -E 's/mobile-build-//' | sort -n | tail -1 || true)
[ -z "$last_tag" ] && last_tag=0

prev=$(printf "%s\n%s\n%s\n" "${android_code:-0}" "${ios_code:-0}" "$last_tag" | sort -n | tail -1)
NEW_BUILD=$((prev + 1))

# Marketing version: env override wins; otherwise derive from version.json (site version
# like `v260507.02 1:40p` becomes `260507.02`, which works internally but is not
# App-Store-friendly — set MARKETING_VERSION=1.0.0 explicitly for store submissions).
MARKETING=$(python3 -c "import json;print(json.load(open('version.json')).get('version','0.0'))" 2>/dev/null || echo "0.0")
if [ -n "${MARKETING_VERSION:-}" ]; then
  SHORT_MARKETING="$MARKETING_VERSION"
else
  SHORT_MARKETING=$(echo "$MARKETING" | sed -E 's/^v?([0-9]+\.[0-9]+).*/\1/')
fi
[ -z "$SHORT_MARKETING" ] && SHORT_MARKETING="1.0"

GIT_SHA=$(git rev-parse --short HEAD)
GIT_BRANCH=$(git branch --show-current 2>/dev/null || echo HEAD)
BUILD_DATE=$(date -u +"%Y-%m-%d %H:%M UTC")
OUT_DIR="$OUT_ROOT/build-$NEW_BUILD"
mkdir -p "$OUT_DIR"

echo "→ Mobile build #$NEW_BUILD (marketing=$SHORT_MARKETING site=$MARKETING sha=$GIT_SHA)"
echo "→ Output: $OUT_DIR"

# ── 2) bump version files ────────────────────────────────────────────
sed_inplace() { if sed --version 2>/dev/null | grep -q GNU; then sed -i "$@"; else sed -i '' "$@"; fi; }

sed_inplace -E "s/(versionCode\s*=\s*)[0-9]+/\1$NEW_BUILD/" "$ANDROID_GRADLE"
sed_inplace -E "s/(versionName\s*=\s*\")[^\"]*(\")/\1$SHORT_MARKETING (build $NEW_BUILD)\2/" "$ANDROID_GRADLE" || true

if command -v xcrun >/dev/null 2>&1 && [ -d "$IOS_PROJ_DIR" ]; then
  ( cd "$IOS_PROJ_DIR" && xcrun agvtool new-version -all "$NEW_BUILD" >/dev/null 2>&1 \
      && xcrun agvtool new-marketing-version "$SHORT_MARKETING" >/dev/null 2>&1 ) || {
    # Fallback: pure sed
    sed_inplace -E "s/(CURRENT_PROJECT_VERSION = )[0-9]+;/\1$NEW_BUILD;/g" "$IOS_PBXPROJ"
    sed_inplace -E "s/(MARKETING_VERSION = )[^;]+;/\1$SHORT_MARKETING;/g" "$IOS_PBXPROJ"
  }
else
  sed_inplace -E "s/(CURRENT_PROJECT_VERSION = )[0-9]+;/\1$NEW_BUILD;/g" "$IOS_PBXPROJ"
  sed_inplace -E "s/(MARKETING_VERSION = )[^;]+;/\1$SHORT_MARKETING;/g" "$IOS_PBXPROJ"
fi

# ── 3) release notes ────────────────────────────────────────────────
NOTES="$OUT_DIR/RELEASE_NOTES.md"
if [ "$last_tag" -gt 0 ] && git rev-parse "mobile-build-$last_tag" >/dev/null 2>&1; then
  RANGE="mobile-build-$last_tag..HEAD"
  COMMITS=$(git log --pretty='- %h %s (%an)' "$RANGE" 2>/dev/null || echo "")
  COMPARE_LINK="git diff mobile-build-$last_tag..HEAD"
else
  COMMITS=$(git log -20 --pretty='- %h %s (%an)')
  COMPARE_LINK="(no previous mobile-build tag — showing last 20 commits)"
fi
[ -z "$COMMITS" ] && COMMITS="- (no commits since previous mobile-build tag)"

cat > "$NOTES" <<EOF
# AlpacaPlayhouse mobile — build $NEW_BUILD

- **Build #:** $NEW_BUILD
- **Marketing version:** $SHORT_MARKETING
- **Site version at build time:** $MARKETING
- **Git:** \`$GIT_SHA\` on \`$GIT_BRANCH\`
- **Built:** $BUILD_DATE
- **Builder:** $(scutil --get ComputerName 2>/dev/null || hostname -s)
- **Targets:** $TARGET

## Changes since previous mobile build

$COMPARE_LINK

$COMMITS

## Artifacts

EOF

# ── 4) build Android ─────────────────────────────────────────────────
build_android() {
  echo "→ Building Android (release APK)…"
  if [ "${DRY_RUN:-0}" = "1" ]; then
    echo "  [dry-run] skipping gradle assembleRelease"
    echo "- alpacaplayhouse-android-build${NEW_BUILD}.apk (dry-run, not built)" >> "$NOTES"
    return
  fi
  ( cd "$PROJECT_ROOT/mobile-android" && ./gradlew --quiet assembleRelease )
  src=$(ls -t mobile-android/app/build/outputs/apk/release/*.apk 2>/dev/null | head -1)
  if [ -z "$src" ]; then echo "ERROR: APK not produced" >&2; exit 1; fi
  dst="$OUT_DIR/alpacaplayhouse-android-build${NEW_BUILD}-v${SHORT_MARKETING}.apk"
  cp "$src" "$dst"
  size=$(du -h "$dst" | cut -f1)
  echo "- [$(basename "$dst")](./$(basename "$dst")) ($size)" >> "$NOTES"
  echo "  ✓ $dst ($size)"
}

# ── 5) build iOS ─────────────────────────────────────────────────────
build_ios() {
  echo "→ Building iOS (archive + export)…"
  if [ "${DRY_RUN:-0}" = "1" ]; then
    echo "  [dry-run] skipping xcodebuild"
    echo "- alpacaplayhouse-ios-build${NEW_BUILD}.ipa (dry-run, not built)" >> "$NOTES"
    return
  fi
  if ! command -v xcodebuild >/dev/null 2>&1; then
    echo "  ⚠ xcodebuild not found — skipping iOS (run on Alpuca)" | tee -a "$NOTES"
    return
  fi

  ARCHIVE="$OUT_DIR/AlpacaPlayhouse.xcarchive"
  EXPORT_DIR="$OUT_DIR/ios-export"
  EXPORT_PLIST="$OUT_DIR/ExportOptions.plist"
  METHOD="${IOS_EXPORT_METHOD:-development}"
  STYLE="${IOS_SIGNING_STYLE:-Automatic}"

  cat > "$EXPORT_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyLists-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>$METHOD</string>
  <key>signingStyle</key><string>$STYLE</string>
  $( [ -n "${APPLE_TEAM_ID:-}" ] && echo "<key>teamID</key><string>$APPLE_TEAM_ID</string>" )
  <key>stripSwiftSymbols</key><true/>
</dict></plist>
PLIST

  ( cd "$IOS_PROJ_DIR" && xcodebuild \
      -project AlpacaPlayhouse.xcodeproj \
      -scheme "$IOS_SCHEME" \
      -configuration Release \
      -destination 'generic/platform=iOS' \
      -archivePath "$ARCHIVE" \
      archive | tail -5 )

  ( cd "$IOS_PROJ_DIR" && xcodebuild \
      -exportArchive \
      -archivePath "$ARCHIVE" \
      -exportPath "$EXPORT_DIR" \
      -exportOptionsPlist "$EXPORT_PLIST" | tail -5 )

  src=$(ls -t "$EXPORT_DIR"/*.ipa 2>/dev/null | head -1)
  if [ -z "$src" ]; then echo "ERROR: IPA not produced" >&2; exit 1; fi
  dst="$OUT_DIR/alpacaplayhouse-ios-build${NEW_BUILD}-v${SHORT_MARKETING}.ipa"
  mv "$src" "$dst"
  rm -rf "$ARCHIVE" "$EXPORT_DIR" "$EXPORT_PLIST"
  size=$(du -h "$dst" | cut -f1)
  echo "- [$(basename "$dst")](./$(basename "$dst")) ($size, $METHOD)" >> "$NOTES"
  echo "  ✓ $dst ($size)"
}

case "$TARGET" in
  android) build_android ;;
  ios)     build_ios ;;
  both)    build_android; build_ios ;;
esac

# ── 6) tag the build ─────────────────────────────────────────────────
if [ "${SKIP_TAG:-0}" != "1" ] && [ "${DRY_RUN:-0}" != "1" ]; then
  git tag -a "mobile-build-$NEW_BUILD" -m "Mobile build $NEW_BUILD ($TARGET, v$SHORT_MARKETING, $GIT_SHA)" 2>/dev/null \
    && echo "→ Tagged mobile-build-$NEW_BUILD (push with: git push origin mobile-build-$NEW_BUILD)" \
    || echo "→ Tag mobile-build-$NEW_BUILD already exists, skipping"
fi

echo
echo "Done. Build #$NEW_BUILD artifacts + notes in: $OUT_DIR"
echo "Release notes: $NOTES"
