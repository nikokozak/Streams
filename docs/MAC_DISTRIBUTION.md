# macOS Distribution (Alpha)

Goal: ship a signed + notarized build with Sparkle 2 updates, and a rollback path.

## Components

- **Developer ID signing** (Apple Developer Program)
- **Notarization** (Apple notary service)
- **Sparkle 2** (auto-updates)
- **Hosting**
  - GitHub Releases: binaries + signatures
  - GitHub Pages (or Fly static): stable appcast URL

## Release principles

- Releases must be repeatable (document the exact commands used).
- Keep last 2–3 releases available to support downgrade.
- Don’t invite alpha users until:
  - data location migration is complete
  - DB backups before migration are implemented

## Appcast guidance

- Publish an `alpha` appcast (e.g., `appcast-alpha.xml`) at a stable URL.
- Appcast entries reference GitHub Releases assets by tag.

## Rollback guidance

- Maintain appcast history so users can downgrade.
- Document manual install steps in `/alpha` docs (website).

## CI vs local signing

Alpha can start with local signing/notarization, but document:
- which machine produced releases
- how certs are installed (keychain)
- how Sparkle signing keys are stored

