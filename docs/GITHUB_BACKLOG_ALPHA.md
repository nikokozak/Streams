# GitHub Backlog: Alpha (50 users / next month)

Use this document to create a GitHub Milestone and a set of Issues in a consistent order.

## Milestone

Create a Milestone:
- **Title:** `Alpha (50 users)`
- **Due date:** (next month, your target invite date)
- **Description:** “Signed+notarized Sparkle builds, Fly proxy with device keys + quotas, in-app Testing feedback, website waitlist/admin issuance.”

## Labels (recommended)

Create these labels (lightweight, useful):
- `alpha`
- `p0`, `p1`, `p2`
- `area:mac`, `area:web`, `area:swift`, `area:proxy`, `area:infra`, `area:docs`
- `type:bug`, `type:feature`, `type:chore`

## Issue format

For each Issue below:
- Add it to the `Alpha (50 users)` milestone
- Add the suggested labels
- Copy the Acceptance Criteria into the Issue body

---

## Epic A — Engineering workflow (blocks safe collaboration)

### A1 — Protect `main` + enforce PR workflow
- Labels: `alpha`, `type:chore`, `area:infra`, `p0`
- AC:
  - Branch protection enabled: PR required, 1 approval required, CI required
  - Direct pushes and force pushes to `main` disabled

### A2 — Add GitHub templates (issues + PR)
- Labels: `alpha`, `type:chore`, `area:docs`, `p0`
- AC:
  - Add `.github/ISSUE_TEMPLATE/bug.md` and `.github/ISSUE_TEMPLATE/feature.md`
  - Add `.github/pull_request_template.md` with: linked Issue, test plan, migration notes, rollback plan, changelog note

### A3 — Add CI (Swift build + Web typecheck)
- Labels: `alpha`, `type:chore`, `area:infra`, `p0`
- AC:
  - GitHub Actions runs:
    - `xcodebuild build -scheme Ticker -destination 'platform=OS X' -derivedDataPath .build/xcode`
    - `cd Web && npm run typecheck`
  - CI failure blocks merge

### A4 — Release discipline (versioning + changelog habit)
- Labels: `alpha`, `type:chore`, `area:docs`, `p0`
- AC:
  - Adopt `YYYY.MM.patch` release tags (documented)
  - Every user-facing PR adds a line to `CHANGELOG.md`

### A5 — Alpha test minimums documented
- Labels: `alpha`, `type:chore`, `area:docs`, `p1`
- AC:
  - `docs/TEST_STRATEGY.md` defines smoke coverage:
    - stream CRUD
    - persistence roundtrip
    - AI request flow
    - schema snapshot tests (bridge/proxy)

---

## Epic B — macOS distribution + data safety (blocks shipping)

### B1 — Entitlements audit
- Labels: `alpha`, `type:chore`, `area:mac`, `p0`
- AC:
  - Document required entitlements and why (Accessibility/hotkeys/persistence)
  - Remove any unused entitlements

### B2 — Standardize data location (Application Support) + migrate
- Labels: `alpha`, `type:feature`, `area:swift`, `p0`
- AC:
  - Data stored under `~/Library/Application Support/Ticker/`
  - Migration from `~/.config/ticker/` is automatic and safe
  - Pre-migration backup created

### B3 — SQLite backup-before-migration
- Labels: `alpha`, `type:feature`, `area:swift`, `p0`
- AC:
  - Before any DB schema migration runs, create a timestamped DB backup
  - Keep last N backups (choose N)

### B4 — Sparkle 2 integration (alpha channel)
- Labels: `alpha`, `type:feature`, `area:mac`, `p0`
- AC:
  - “Check for Updates…” exists
  - Sparkle updates from alpha appcast work end-to-end
  - Update prompt behavior acceptable for alpha testers

### B5 — Signed + notarized release runbook (initially local)
- Labels: `alpha`, `type:chore`, `area:mac`, `p0`
- AC:
  - Document exact steps to produce signed+notarized build and appcast update
  - Repeatable on the designated release machine

### B6 — Rollback support
- Labels: `alpha`, `type:feature`, `area:mac`, `p1`
- AC:
  - Appcast keeps last 2–3 releases
  - `/alpha` page documents manual downgrade/install steps

---

## Epic C — Proxy (Fly.io Phoenix) (blocks removing vendor keys)

### C1 — Phoenix proxy skeleton on Fly.io
- Labels: `alpha`, `type:feature`, `area:proxy`, `area:infra`, `p0`
- AC:
  - Deployed to Fly.io with TLS
  - Secrets managed via Fly secrets
  - Health endpoint present

### C2 — Device key issuance + storage (admin)
- Labels: `alpha`, `type:feature`, `area:proxy`, `p0`
- AC:
  - Admin can issue/revoke keys
  - Keys stored hashed
  - Key associated to user email + device label

### C3 — Device binding enforcement
- Labels: `alpha`, `type:feature`, `area:proxy`, `p0`
- AC:
  - First request binds key to `device_id`
  - Subsequent requests with different `device_id` → `401` with actionable message

### C4 — Ticker-native LLM request API (v1)
- Labels: `alpha`, `type:feature`, `area:proxy`, `p0`
- AC:
  - `POST /v1/llm/request` implemented for at least 1 provider
  - Returns `X-Ticker-Request-Id` for every response
  - Uses developer-owned provider keys (no user keys)

### C5 — Metering + quotas (req/min + daily + monthly)
- Labels: `alpha`, `type:feature`, `area:proxy`, `p0`
- AC:
  - Default limits: 20 req/min, 100k daily tokens, 1M monthly tokens
  - Per-key override supported in admin
  - Returns `429` with reset info when exceeded

### C6 — Diagnostics ingestion + 30-day retention
- Labels: `alpha`, `type:feature`, `area:proxy`, `p0`
- AC:
  - Endpoints for structured events and crash markers
  - Raw logs retained max 30 days (purge job)

### C7 — Feedback ingestion (bug + feature) with attachments
- Labels: `alpha`, `type:feature`, `area:proxy`, `p1`
- AC:
  - `POST /v1/feedback` supports `bug|feature`
  - Optional attachment upload (size cap, retention policy)
  - Returns `feedback_id`
  - Admin can view and export/copy feedback for manual GitHub promotion

---

## Epic D — In-app alpha support + UX (reduces support load)

### D1 — Key entry + validation (Keychain)
- Labels: `alpha`, `type:feature`, `area:swift`, `area:web`, `p0`
- AC:
  - Settings allows entering a device key and validating it against proxy
  - Key stored in Keychain
  - Never display/log raw key; show `support_id` instead

### D2 — Usage UI + limit messaging
- Labels: `alpha`, `type:feature`, `area:web`, `p0`
- AC:
  - Show daily/monthly usage + caps + reset timing
  - Clear messages for quota exceeded

### D3 — Robust proxy error handling
- Labels: `alpha`, `type:feature`, `area:web`, `p0`
- AC:
  - Proxy unreachable: AI disabled, editor usable, clear message
  - `401`: invalid/bound-elsewhere key: prompt next step
  - `429`: quota exceeded: show usage + reset timing
  - `5xx`: retry affordance + request id

### D4 — Request correlation captured and surfaced
- Labels: `alpha`, `type:feature`, `area:web`, `p1`
- AC:
  - App captures `X-Ticker-Request-Id` and includes it in support bundle

### D5 — “Testing” tab: bug report + feature request + support bundle
- Labels: `alpha`, `type:feature`, `area:web`, `p1`
- AC:
  - “Report a bug” and “Request a feature” forms
  - Optional attachment upload (screenshot)
  - “Copy Support Bundle” button (no content, no raw key)
  - Submits to proxy and returns `feedback_id` for the user to reference

### D6 — Diagnostics: default ON + disclosure + opt-out
- Labels: `alpha`, `type:feature`, `area:web`, `p1`
- AC:
  - First-run disclosure OR settings disclosure (acceptable)
  - Toggle to disable diagnostics
  - Default ON

### D7 — Export single stream (MD + text)
- Labels: `alpha`, `type:feature`, `area:web`, `p2`
- AC:
  - Export current stream to Markdown and plain text
  - Bulk export explicitly deferred

---

## Epic E — Website + onboarding

### E1 — Landing + waitlist
- Labels: `alpha`, `type:feature`, `area:infra`, `p1`
- AC:
  - Landing page + waitlist form stored in DB

### E2 — Alpha + privacy + contact pages
- Labels: `alpha`, `type:feature`, `area:infra`, `p1`
- AC:
  - `/alpha`: expectations + update policy + how to send feedback
  - `/privacy`: diagnostics collected + opt-out + retention (30-day logs)
  - Contact page

### E3 — Status page
- Labels: `alpha`, `type:feature`, `area:infra`, `p2`
- AC:
  - `/status` shows proxy status (manual toggle acceptable)

### E4 — Admin approval → key issuance email
- Labels: `alpha`, `type:feature`, `area:infra`, `p1`
- AC:
  - Admin approves waitlist entry
  - System issues device key and emails instructions

