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

## Entitlements

**Ticker uses empty entitlements.** This is intentional and correct.

### Entitlements vs TCC Permissions

- **Entitlements** = capabilities declared at build time, embedded in code signature
- **TCC permissions** = runtime permissions the user grants in System Preferences

Accessibility access (used for reading selected text) is a **TCC permission**, not an entitlement. The user grants it at runtime via System Preferences > Privacy & Security > Accessibility.

### Audit Results (2025-12-21)

All signed components have:
- Hardened Runtime enabled (`flags=0x10000(runtime)`)
- Developer ID signature
- No entitlements
- `get-task-allow` absent (required for notarization)

```
Component                                    Entitlements
─────────────────────────────────────────────────────────
Ticker.app                                   (none)
Sparkle.framework                            (none)
Sparkle.framework/.../Updater.app            (none)
Sparkle.framework/.../Downloader.xpc         (none)
Sparkle.framework/.../Installer.xpc          (none)
```

### Why No Entitlements Are Needed

| Feature | Mechanism | Entitlement? |
|---------|-----------|--------------|
| Global hotkeys (Cmd+L) | Carbon `RegisterEventHotKey` | No |
| Selection reading | Accessibility APIs | No (TCC runtime) |
| Clipboard access | `NSPasteboard` | No |
| WKWebView | WebKit | No (non-sandboxed) |
| Sparkle updates | Network + file writes | No (non-sandboxed) |
| Local file storage | Application Support | No (non-sandboxed) |

### Entitlements We Explicitly Avoid

| Entitlement | Why Not Needed |
|-------------|----------------|
| `get-task-allow` | Debug only; blocks notarization |
| `com.apple.security.cs.allow-unsigned-executable-memory` | No JIT compilation |
| `com.apple.security.cs.disable-library-validation` | All libs signed (Sparkle/GRDB via SPM) |
| `com.apple.security.automation.apple-events` | We use AX APIs, not AppleScript |
| `com.apple.security.app-sandbox` | Not sandboxed (intentional for alpha) |

### Verifying Entitlements

To audit a signed build:

```bash
# Extract entitlements (should output nothing after executable path)
codesign -d --entitlements - /path/to/Ticker.app

# Verify get-task-allow is absent
codesign -d --entitlements - /path/to/Ticker.app 2>/dev/null | grep "get-task-allow"
# (no output = correct)

# Check all components
find /path/to/Ticker.app \( -name "*.app" -o -name "*.framework" -o -name "*.xpc" \) \
  -exec sh -c 'echo "=== $1 ===" && codesign -d --entitlements - "$1" 2>/dev/null | tail -n +2' _ {} \;
```

