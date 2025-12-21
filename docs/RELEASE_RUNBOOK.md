# Release Runbook (Alpha Channel)

Step-by-step guide to release a new Ticker alpha build with Sparkle auto-updates.

## Prerequisites

- macOS with Xcode installed
- Apple Developer ID certificate (for code signing)
- Sparkle private key in Keychain (generated via `generate_keys`)
- `gh` CLI authenticated (`gh auth login`)
- Sparkle CLI tools (see below)

### Sparkle CLI Tools Setup (one-time)

SPM provides the Sparkle framework, but release tools (`sign_update`, `generate_appcast`) should be downloaded separately:

```bash
# Download Sparkle release (check for latest version)
curl -L -o /tmp/Sparkle-2.6.4.tar.xz \
  https://github.com/sparkle-project/Sparkle/releases/download/2.6.4/Sparkle-2.6.4.tar.xz

# Extract tools to project (gitignored)
mkdir -p tools/sparkle
tar -xf /tmp/Sparkle-2.6.4.tar.xz -C tools/sparkle
```

Add to `.gitignore`:
```
tools/sparkle/
```

Tools are now at `tools/sparkle/bin/sign_update` and `tools/sparkle/bin/generate_appcast`.

### GitHub Pages Setup (one-time)

If not already done:

```bash
# Create orphan gh-pages branch
git checkout --orphan gh-pages
git reset --hard
echo "# Ticker Updates" > README.md
cat > appcast-alpha.xml << 'EOF'
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Ticker Alpha</title>
  </channel>
</rss>
EOF
git add README.md appcast-alpha.xml
git commit -m "Initialize gh-pages for Sparkle appcast"
git push origin gh-pages
git checkout main
```

Then in GitHub repo **Settings > Pages**:
- Source: **Deploy from a branch**
- Branch: **gh-pages** / **/ (root)**
- Save

Verify: `https://nikokozak.github.io/Streams/appcast-alpha.xml` should return the XML.

---

## Release Steps

### 1. Update version numbers

Edit `Ticker.xcodeproj/project.pbxproj`:
- `MARKETING_VERSION` → `YYYY.MM.patch` (e.g., `2025.12.1`)

The build number (`CURRENT_PROJECT_VERSION`) is set automatically from git commit count.

### 2. Build Release configuration (unsigned)

```bash
# Get build number from git
BUILD_NUMBER=$(git rev-list --count HEAD)

# Build Release without code signing (sign separately)
xcodebuild build \
  -project Ticker.xcodeproj \
  -scheme Ticker \
  -configuration Release \
  -destination 'platform=macOS' \
  -derivedDataPath /tmp/ticker-release-build \
  CODE_SIGNING_ALLOWED=NO \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER"

APP_PATH="/tmp/ticker-release-build/Build/Products/Release/Ticker.app"
```

### 3. Code sign with Developer ID

```bash
codesign --deep --force --verify --verbose \
  --sign "Developer ID Application: Nikolai Kozak (Z5DX2YK8FA)" \
  --options runtime \
  "$APP_PATH"
```

### 4. Notarize and staple

```bash
# Create zip for notarization (sequester resource forks)
ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" /tmp/Ticker-notarize.zip

# Submit for notarization
xcrun notarytool submit /tmp/Ticker-notarize.zip \
  --apple-id "your@email.com" \
  --team-id "TEAM_ID" \
  --password "@keychain:AC_PASSWORD" \
  --wait

# Staple the notarization ticket
xcrun stapler staple "$APP_PATH"

# Verify signing and notarization
spctl -a -vv "$APP_PATH"
```

The `spctl` command should output: `accepted` and `source=Notarized Developer ID`.

### 5. Create distribution zip

```bash
VERSION=$(defaults read "$APP_PATH/Contents/Info.plist" CFBundleShortVersionString)
ZIP_NAME="Ticker-${VERSION}.zip"

cd /tmp/ticker-release-build/Build/Products/Release
ditto -c -k --sequesterRsrc --keepParent Ticker.app "/tmp/$ZIP_NAME"

# Get file size for appcast
FILE_SIZE=$(stat -f%z "/tmp/$ZIP_NAME")
echo "File size: $FILE_SIZE bytes"
```

### 6. Sign the zip with Sparkle

```bash
# Sign and get signature for appcast
./tools/sparkle/bin/sign_update "/tmp/$ZIP_NAME"
```

This outputs:
```
sparkle:edSignature="BASE64_SIGNATURE" length="12345678"
```

**Save these values** — you'll need them for the appcast entry.

### 7. Create GitHub Release

```bash
gh release create "v${VERSION}" \
  --title "Ticker ${VERSION}" \
  --notes "Release notes here" \
  "/tmp/$ZIP_NAME"
```

**Important**: The uploaded asset filename (`Ticker-YYYY.MM.patch.zip`) must exactly match what you put in the appcast URL.

### 8. Update appcast-alpha.xml

**Option A: Use generate_appcast (recommended)**

```bash
# Point generate_appcast at a folder containing your signed zip
mkdir -p /tmp/appcast-source
cp "/tmp/$ZIP_NAME" /tmp/appcast-source/

./tools/sparkle/bin/generate_appcast /tmp/appcast-source

# This creates/updates appcast.xml in that folder
# Copy the <item> entry to your gh-pages appcast-alpha.xml
```

**Option B: Manual edit**

Switch to `gh-pages` branch and edit `appcast-alpha.xml`:

```bash
git checkout gh-pages
```

Add a new `<item>` entry at the top of the channel (keep previous 2-3 entries for rollback):

```xml
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Ticker Alpha</title>

    <item>
      <title>Version YYYY.MM.patch</title>
      <pubDate>Sat, 21 Dec 2025 12:00:00 +0000</pubDate>
      <sparkle:version>BUILD_NUMBER</sparkle:version>
      <sparkle:shortVersionString>YYYY.MM.patch</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>14.0</sparkle:minimumSystemVersion>
      <enclosure
        url="https://github.com/nikokozak/Streams/releases/download/vYYYY.MM.patch/Ticker-YYYY.MM.patch.zip"
        type="application/octet-stream"
        sparkle:edSignature="BASE64_SIGNATURE_FROM_STEP_6"
        length="FILE_SIZE_FROM_STEP_5"
      />
    </item>

    <!-- Keep previous 2-3 releases for rollback -->
  </channel>
</rss>
```

Commit and push:

```bash
git add appcast-alpha.xml
git commit -m "Release vYYYY.MM.patch"
git push origin gh-pages
git checkout main  # or your working branch
```

---

## Verification

1. Open Ticker
2. Click **Ticker > Check for Updates...**
3. Sparkle should find and offer the update
4. Install and verify the new version launches correctly

---

## Rollback

- **Keep last 2-3 `<item>` entries** in appcast-alpha.xml
- **Do not delete older release assets** from GitHub Releases
- Users can manually download previous versions from: https://github.com/nikokozak/Streams/releases

---

## Private Key Location

The Sparkle EdDSA private key is stored in the macOS Keychain. To locate it:

1. Open **Keychain Access**
2. Search for "Sparkle"
3. The private key is stored as an application password

> **WARNING**: Never paste, export, or commit the private key to git, PRs, or any text that could be shared. The private key must remain on the release machine (or as a CI secret).

To export for CI (store as `SPARKLE_PRIVATE_KEY` secret):
```bash
# Find the key in Keychain Access first to confirm the account/service names
security find-generic-password -a "ed25519" -w
```

For CI signing, pipe the secret to sign_update:
```bash
echo "$SPARKLE_PRIVATE_KEY" | ./tools/sparkle/bin/sign_update --ed-key-file - "/tmp/$ZIP_NAME"
```
