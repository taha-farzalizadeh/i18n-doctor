# Publishing i18n-doctor to JetBrains Marketplace

**Always bump the version before each deploy.** Marketplace rejects uploading
the same version twice for plugin id `com.i18ndoctor.jetbrains`.

Current release version: **0.10.0** (keep these in sync):

| File | Field |
| --- | --- |
| `gradle.properties` | `pluginVersion=0.10.0` |
| `package.json` | `"version": "0.10.0"` |
| `src/main/resources/META-INF/plugin.xml` | `<change-notes>` for that version |
| Root / package READMEs | `Beta — v0.10.0` where shown |

Next publish → **0.10.1** (or higher).

Listing text: **[MARKETPLACE.md](./MARKETPLACE.md)**

Official docs:

- [Publishing a Plugin](https://plugins.jetbrains.com/docs/intellij/publishing-plugin.html)
- [Plugin Signing](https://plugins.jetbrains.com/docs/intellij/plugin-signing.html)

---

## Release checklist

1. **Bump version** in `gradle.properties` + `package.json` (e.g. `0.9.5` → `0.9.6`)
2. Update `plugin.xml` change-notes and README / MARKETPLACE version mentions
3. `npm test -w i18n-doctor-jetbrains`
4. `npm run package -w i18n-doctor-jetbrains`
5. First time only: manual upload on [plugins.jetbrains.com](https://plugins.jetbrains.com/plugin/uploadPlugin)
6. Later releases: set env secrets → `npm run publish -w i18n-doctor-jetbrains`

---

## Prerequisites

1. JetBrains Account + Marketplace vendor
2. Signing certificate (self-signed is fine for Marketplace ZIP Signer)
3. Personal Access Token (Marketplace → **My Tokens**)

---

## Version bump (required every publish)

```bash
# Edit both (same number):
#   packages/jetbrains/gradle.properties  → pluginVersion=X.Y.Z
#   packages/jetbrains/package.json       → "version": "X.Y.Z"
```

Then refresh user-facing docs that show the version banner.

---

## Build the distribution (maintainers)

```bash
npm install
npm run package -w i18n-doctor-jetbrains
```

Artifact:

```
packages/jetbrains/build/distributions/i18n-doctor-jetbrains-<version>.zip
```

End users install from the **Marketplace**, not this zip.

---

## Signing certificate (once)

```bash
openssl genrsa -aes256 -out private_key.pem 4096
openssl req -new -x509 -key private_key.pem -out chain.crt -days 3650
```

Keep keys out of git.

---

## First upload (manual — once)

1. [Upload plugin](https://plugins.jetbrains.com/plugin/uploadPlugin)
2. Upload the zip for the **new** version
3. Paste fields from [MARKETPLACE.md](./MARKETPLACE.md)
4. Attach screenshots
5. Compatible IDEs: WebStorm 2024.3+, IDEA Ultimate, PhpStorm, …
6. Submit for review

After the page exists, use Gradle for updates.

---

## Environment variables

```bash
export PUBLISH_TOKEN="perm:…"
export CERTIFICATE_CHAIN="$(cat chain.crt)"
export PRIVATE_KEY="$(cat private_key.pem)"
export PRIVATE_KEY_PASSWORD="…"
```

---

## Publish updates

```bash
# After bumping version + updating change-notes:
npm run publish -w i18n-doctor-jetbrains
```

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Duplicate version rejected | Bump `pluginVersion` / `package.json` |
| `PUBLISH_TOKEN` missing | Export Marketplace token |
| Signing skipped | Set `CERTIFICATE_CHAIN`, `PRIVATE_KEY`, `PRIVATE_KEY_PASSWORD` |
| First Gradle publish fails | Complete the **manual** first upload |
| Users: no underlines | Tell them to set **JavaScript Runtime** to Node ≥ 18 |
