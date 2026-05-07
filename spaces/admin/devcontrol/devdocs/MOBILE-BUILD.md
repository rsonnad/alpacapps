# Native Mobile App Build Runbook

Build process for the AlpacaPlayhouse native mobile apps.

| | Android | iOS |
|---|---|---|
| Source | [`mobile-android/`](../../../../mobile-android/) | [`mobile-ios/`](../../../../mobile-ios/) |
| Stack | Kotlin + Jetpack Compose | Swift + SwiftUI |
| Bundle ID | `com.alpacaplayhouse.app` | `com.alpacaplayhouse.app` |
| Min OS | Android 8.0 (SDK 26) | (per Xcode project) |
| Toolchain | Gradle 9.4, Kotlin 2.3, JDK 17, Android SDK 35+36 | Xcode 26.4 |

> Capacitor was retired 2026-03-30 in favor of native — see memory `project_native-mobile-apps.md`.
> The kiosk app at [`alpaca-kiosk/`](../../../../alpaca-kiosk/) is **separate** (`com.alpacaplayhouse.kiosk`) and has its own [`INSTALL.md`](../../../../alpaca-kiosk/INSTALL.md).

## Build host

**All builds run on Alpuca (192.168.1.200).** Xcode + Apple signing certs only live there. Feature work can be authored anywhere; building, signing, and releasing happens on Alpuca.

```bash
ssh alpuca
cd ~/CodingProjects/genalpaca-admin   # or the worktree on Alpuca
git pull
```

## One-shot build

[`scripts/build-mobile.sh`](../../../../scripts/build-mobile.sh) does everything in one call: bumps the build number, builds, drops artifacts in [`mobilebuilds/build-<N>/`](../../../../mobilebuilds/), writes release notes, and tags the commit.

```bash
scripts/build-mobile.sh           # both platforms (default)
scripts/build-mobile.sh android   # Android only
scripts/build-mobile.sh ios       # iOS only
DRY_RUN=1 scripts/build-mobile.sh # bump version + write notes, skip actual build
```

### What it does

1. **Pick the next build number.** Reads `versionCode` (Android), `CURRENT_PROJECT_VERSION` (iOS), and the highest `mobile-build-N` git tag — takes max + 1. Build number is **shared across both platforms** so a given build N always corresponds to the same code.
2. **Pull marketing version.** Reads `version.json` for the site version (e.g. `v260507.02`); the `MM.NN` portion becomes the iOS `MARKETING_VERSION` and Android `versionName`.
3. **Bump version files** in [`mobile-android/app/build.gradle.kts`](../../../../mobile-android/app/build.gradle.kts) and [`mobile-ios/AlpacaPlayhouse.xcodeproj/project.pbxproj`](../../../../mobile-ios/AlpacaPlayhouse.xcodeproj/) (via `xcrun agvtool` when available, sed fallback otherwise).
4. **Build:**
   - Android — `./gradlew assembleRelease` → `mobile-android/app/build/outputs/apk/release/*.apk`
   - iOS — `xcodebuild archive` + `xcodebuild -exportArchive` with a generated `ExportOptions.plist`
5. **Copy artifacts** into `mobilebuilds/build-<N>/` as `alpacaplayhouse-<platform>-build<N>-v<marketing>.{apk,ipa}`.
6. **Write `RELEASE_NOTES.md`** — build #, marketing version, site version, git SHA + branch, builder hostname, and the `git log` between the previous `mobile-build-*` tag and HEAD.
7. **Tag** the commit `mobile-build-<N>` (skip with `SKIP_TAG=1`).

### iOS signing

The script honors these env vars (default in parens):

- `APPLE_TEAM_ID` — required for `app-store` / `ad-hoc`
- `IOS_EXPORT_METHOD` — `development` / `ad-hoc` / `app-store` / `enterprise` (`development`)
- `IOS_SIGNING_STYLE` — `Automatic` / `Manual` (`Automatic`)
- `MARKETING_VERSION` — override the marketing version (use `1.0.0`-style for App Store submissions; the default derived from `version.json` is `YYMMDD.NN`, fine for internal but rejected by App Store Connect)

Example for a TestFlight build:

```bash
APPLE_TEAM_ID=ABCD123456 IOS_EXPORT_METHOD=app-store \
  scripts/build-mobile.sh ios
```

If signing isn't configured, the iOS step will fail at `xcodebuild archive`. Configure once in Xcode → AlpacaPlayhouse target → Signing & Capabilities, then subsequent builds work headlessly.

## Outputs

```
mobilebuilds/
└── build-42/
    ├── RELEASE_NOTES.md                                 # checked into git
    ├── alpacaplayhouse-android-build42-v1.0.apk         # gitignored
    └── alpacaplayhouse-ios-build42-v1.0.ipa             # gitignored
```

Binaries are gitignored ([`mobilebuilds/.gitignore`](../../../../mobilebuilds/.gitignore)) — too large for git. Notes are committed so the release history is durable.

## Distribution (manual after build)

- **Android — internal:** AirDrop / scp the APK directly to the device. `adb install -r path.apk` for tethered installs.
- **Android — Play Store:** `./gradlew bundleRelease` for an `.aab` instead of `assembleRelease`, then upload via Play Console.
- **iOS — TestFlight:** `xcrun altool --upload-app -f path.ipa -t ios -u <apple-id> -p <app-specific-pwd>` (or use Transporter.app).
- **iOS — ad-hoc:** install via Apple Configurator 2, or host the `.ipa` + a manifest plist for OTA install.

## Troubleshooting

- **`xcrun: error: SDK "iphoneos" cannot be located`** — Xcode CLT path wrong. `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.
- **Gradle build hangs** — kill stale daemons: `./gradlew --stop`.
- **`Could not find tools.jar`** — JDK 17 not on `JAVA_HOME`. On Alpuca: `export JAVA_HOME=$(/usr/libexec/java_home -v 17)`.
- **Signing fails with "no profiles match"** — open the project in Xcode once to refresh provisioning profiles, then re-run.
- **APK rejected by Play Store ("versionCode already used")** — build script and Play track got out of sync. Manually bump `versionCode` past the highest published value and re-tag.

## Related

- Memory: `project_native-mobile-apps.md`
- Setup wizard reference: [`mobile-setup.md`](../../../../.claude/skills/setup-alpacapps-infra/references/mobile-setup.md)
- Site versioning (different system, used for `MARKETING_VERSION` lookup): [`scripts/bump-version.sh`](../../../../scripts/bump-version.sh)
- Kiosk Android app (separate): [`alpaca-kiosk/INSTALL.md`](../../../../alpaca-kiosk/INSTALL.md)
