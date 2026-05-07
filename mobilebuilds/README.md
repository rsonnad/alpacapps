# mobilebuilds/

Output directory for native mobile app builds (`mobile-android/`, `mobile-ios/`).

Each invocation of [`scripts/build-mobile.sh`](../scripts/build-mobile.sh) creates a `build-<N>/` subdirectory containing:

- `RELEASE_NOTES.md` — checked into git, documents what shipped
- `*.apk` / `*.ipa` — gitignored binaries

The full build runbook lives at [`reference/MOBILE-BUILD.md`](../reference/MOBILE-BUILD.md).
