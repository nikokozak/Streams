# Sparkle 2 (Alpha Channel) — Implementation Plan

This document is a task-specific plan for integrating Sparkle 2 auto-updates for the Ticker alpha.

## Dependency: App bundle first (blocks Sparkle)

Sparkle requires a **real `.app` bundle**. Today, Ticker builds as a Mach-O executable via SwiftPM and lacks a committed `Info.plist` and bundle metadata.

**Sparkle is unblocked once:**
- `Ticker.app` is produced by `xcodebuild` (macOS App target)
- `Info.plist` exists with stable `CFBundleIdentifier`, `CFBundleShortVersionString`, `CFBundleVersion`
- The web UI assets are bundled into the `.app` resources deterministically

Recommended workflow:
- Track the app-bundle work as its own Issue/branch/PR.
- Keep Sparkle wiring work in its own Issue/branch, marked as blocked until the `.app` work merges.

### App Bundle Migration (prerequisite slices)

#### Slice A1 — Commit an Xcode project (canonical build)

Work:
- Stop ignoring Xcode projects/workspaces in `.gitignore` (so the project is shareable and CI-able).
- Create `Ticker.xcodeproj` with a **macOS App** target and scheme `Ticker`.
- Add a committed `Info.plist` with:
  - `CFBundleIdentifier` (pick a stable, long-lived value)
  - `CFBundleShortVersionString` + `CFBundleVersion` (use `YYYY.MM.patch`)
  - `LSMinimumSystemVersion = 14.0`
- Ensure entitlements are tracked (use `Sources/Ticker/Ticker.entitlements`).

Acceptance criteria:
- `xcodebuild -project Ticker.xcodeproj -scheme Ticker -destination 'platform=macOS' build` produces `Ticker.app`.

#### Slice A2 — Add sources + entry point

Work:
- Add `Sources/Ticker/**/*.swift` to the app target.
- Keep the existing `@main` entry point (`Sources/Ticker/App/AppDelegate.swift`) unless the Xcode template introduces a competing entrypoint.

Acceptance criteria:
- App builds and launches as a `.app` with the existing UI.

#### Slice A3 — Add dependencies via Xcode SPM

Work:
- Add Swift packages in Xcode: `GRDB.swift`, `mlx-swift-lm`.

Acceptance criteria:
- Release build succeeds with dependencies linked.

#### Slice A4 — Bundle Web assets deterministically

Work:
- Add a build phase (or equivalent) that builds/copies `Web` output into the app bundle resources.
- Avoid relying on uncommitted `Sources/Ticker/Resources` artifacts from local dev.

Acceptance criteria:
- `Ticker.app/Contents/Resources/...` contains the required web assets and the app loads the UI.

#### Slice A5 — Update docs/CI to use the canonical build

Work:
- Update build instructions (and CI) to build the Xcode project target.

Acceptance criteria:
- CI builds the `.app` deterministically and does not rely on local developer state.

## Goal

- Ship Ticker to ~50 alpha users with **repeatable** updates.
- Users should **not** manually download new builds: Sparkle checks, downloads, and prompts to install (install on quit/relaunch is acceptable).

## Non-goals (alpha)

- App Store distribution
- Fully unattended “silent” updates while the app continues running
- CI-based signing/notarization (local release machine is acceptable for alpha)
- Beta/stable channel (alpha only for now)

## Key decisions (locked)

- Update framework: **Sparkle 2**
- API/version scheme: `YYYY.MM.patch`
- Hosting:
  - **GitHub Releases**: binaries/signatures
  - **Stable appcast URL** (recommended: GitHub Pages): `appcast-alpha.xml`
- Rollback: keep last **2–3** releases in the appcast

## Prerequisites / discovery (must answer before coding)

Sparkle updates an **.app bundle**. This repo currently builds via SwiftPM and `xcodebuild -scheme Ticker`.

Claude should confirm:
- How Ticker is produced as a **signed `.app` bundle** (not just a CLI binary).
- Where **Info.plist** lives (or how it’s generated) so Sparkle keys (`SUFeedURL`, `SUPublicEDKey`, etc.) can be set.
- Bundle ID and versioning source of truth.

If no `.app` is produced yet, Sparkle wiring can still be added, but end-to-end updates require the “mac distribution” workstream to exist.

## Slice plan (small, verifiable increments)

### Slice 0 — Define update artifacts + URLs (no code)

**Decide:**
- Update package format: prefer `Ticker.app.zip` (Sparkle-friendly).
- Appcast URL: stable URL (GitHub Pages recommended).
- Version fields:
  - `CFBundleShortVersionString = YYYY.MM.patch` (display)
  - `CFBundleVersion = YYYY.MM.patch` (or monotonic build number; choose one and document)

**Acceptance criteria**
- A comment on the Issue capturing the decisions + exact appcast URL.

### Slice 1 — Add Sparkle dependency (SwiftPM)

**Work**
- Add Sparkle 2 package dependency (Sparkle project).
- Link to the app target.
- Ensure build compiles with Sparkle import available.

**Acceptance criteria**
- `xcodebuild build ...` succeeds with Sparkle dependency included.

### Slice 2 — Minimal updater wiring (manual “Check for Updates…”)

**Work**
- Create a long-lived `SPUStandardUpdaterController` instance (App lifetime).
- Add menu item: **Ticker → Check for Updates…**
- Wire to trigger an update check.

**Acceptance criteria**
- Menu item exists.
- Clicking triggers a Sparkle check (even if appcast URL is not live yet).

### Slice 3 — Configure alpha appcast + signing keys

**Work**
- Add Sparkle keys to Info.plist (or equivalent configuration):
  - `SUFeedURL` → stable appcast URL
  - `SUPublicEDKey` → Sparkle public key (EdDSA)
- Generate Sparkle signing keys:
  - Private key stored only on release machine (and later CI secrets).
  - Public key committed in the repo.

**Acceptance criteria**
- App points at the alpha appcast URL.
- Sparkle validates signatures for a test update entry (once appcast exists).

### Slice 4 — Release runbook (manual but repeatable)

**Work**
Create a step-by-step, copy/pastable runbook (and optionally a script) that:
- Builds Release `.app`
- Codesigns (Developer ID)
- Notarizes + staples
- Packages `Ticker.app.zip`
- Generates Sparkle signatures + appcast entry (Sparkle tooling)
- Creates a GitHub Release `vYYYY.MM.patch` and uploads assets
- Updates `appcast-alpha.xml` (stable URL) referencing the GitHub Release assets

**Acceptance criteria**
- A human can follow the runbook and publish an update without guesswork.

### Slice 5 — Rollback + alpha UX expectations

**Work**
- Ensure appcast retains last 2–3 entries.
- Document:
  - “install on quit/relaunch” expectation
  - manual downgrade steps (link to GitHub Releases)

**Acceptance criteria**
- Rollback path documented and viable.

### Slice 6 — Optional hardening (post-alpha)

- Automatic update checks enabled by default with a Settings toggle.
- Move signing/notarization into GitHub Actions once stable.
- Add stable channel feed later (`appcast.xml`).

## Implementation notes (what Claude will likely need)

### Sparkle 2 “automatic” behavior

Sparkle can:
- auto-check periodically
- auto-download
- prompt to install (often on quit/relaunch)

It cannot reliably “hot swap” a running executable without relaunch; assume relaunch is required.

### Appcast hosting recommendation

Even if binaries are on GitHub Releases, prefer a stable appcast URL (GitHub Pages or Fly static).
GitHub release asset URLs may redirect; a stable feed URL tends to reduce edge-case failures.

### Security and key handling

- Never commit the Sparkle **private** key.
- Commit only the Sparkle **public** key in Info.plist.
- Keep 30-day logs policy separate; Sparkle update logs should not include user content.

## Acceptance criteria summary (end state)

- “Check for Updates…” works.
- Sparkle updates from `appcast-alpha.xml` referencing GitHub Releases assets.
- Updates verify signature, and installs on quit/relaunch.
- Last 2–3 releases remain available for rollback.
