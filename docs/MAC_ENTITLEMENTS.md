# macOS Entitlements Audit (Alpha)

Before signing/notarization, document the entitlements Ticker actually needs.

## Entitlements file (tracked)

- `Sources/Ticker/Ticker.entitlements`

Keep this file under version control so signing/notarization is reproducible and reviewable.

## Known capabilities to audit

- **Accessibility API usage** (SelectionReaderService): user permission prompt and behavior
- **Global hotkeys** (Carbon): should work without sandboxing; ensure no unnecessary entitlements
- **Persistence + assets**: verify correct data location under Application Support

## Deliverable

For each entitlement/capability:
- What feature requires it
- Where it’s used in code
- How the user experiences/approves it
- Whether it affects notarization/sandbox constraints

## Goal

Keep entitlements minimal and justified. Avoid requesting capabilities you don’t use.
