# JetBrains Marketplace — listing copy

Paste these fields into
[plugins.jetbrains.com → Upload / Edit plugin](https://plugins.jetbrains.com/plugin/uploadPlugin).

Plugin id (do not change after first publish): `com.i18ndoctor.jetbrains`

---

## Name

```
i18n-doctor
```

## Short description (one line)

```
Live i18n diagnostics — missing, unused, and duplicate translation keys underlined as you type
```

## Detailed description (HTML)

Marketplace accepts HTML. Copy everything between the markers:

```html
<!-- BEGIN MARKETPLACE DESCRIPTION -->
<h2>Live i18n diagnostics for JavaScript &amp; TypeScript</h2>

<p>
  <b>i18n-doctor</b> underlines missing, unused, and duplicate translation keys
  while you edit — powered by the same analyzer as the
  <code>i18n-doctor</code> CLI. This plugin is a thin Language Server Protocol
  (LSP) client: it does not re-implement parsing or analysis inside the IDE.
</p>

<h3>What you get</h3>
<ul>
  <li>
    <b>Missing keys</b> — <code>t("auth.nonexistent")</code> underlines exactly
    <code>"auth.nonexistent"</code> with a clear message.
  </li>
  <li>
    <b>Unused keys</b> — unused catalog entries are highlighted on the property
    key in every locale file that defines them.
  </li>
  <li>
    <b>Duplicates &amp; coverage</b> — duplicate definitions and cross-locale gaps
    (when enabled).
  </li>
  <li>
    <b>Live updates</b> — unsaved editor buffers are analyzed; add or remove a
    translation and diagnostics update without restarting the IDE.
  </li>
</ul>

<h3>Zero project dependency</h3>
<p>
  The language server is <b>bundled</b> with the plugin. You do <b>not</b> need
  to install <code>@i18n-doctor/language-server</code> or any i18n-doctor package
  in your project for the editor to work.
</p>

<h3>Requirements</h3>
<ul>
  <li>WebStorm / IntelliJ IDEA Ultimate / PhpStorm / other IDEs with the platform LSP API — <b>2024.3+</b></li>
  <li><b>Node.js ≥ 18</b> — configure under <em>Settings → Languages &amp; Frameworks → JavaScript Runtime</em></li>
</ul>

<h3>Quick start</h3>
<ol>
  <li>Install the plugin and restart the IDE.</li>
  <li>Set your Node.js runtime (JavaScript Runtime settings).</li>
  <li>Open a <code>.tsx</code> / <code>.ts</code> / <code>.json</code> file in an i18n project.</li>
  <li>Check the <b>Language Services</b> status-bar widget — <code>i18n-doctor</code> should be running.</li>
</ol>

<h3>Configuration</h3>
<p>
  Analyzer rules, ignores, and severities come from your project's
  <code>i18n-doctor</code> config (same as the CLI). Optional IDE overrides live under
  <em>Settings → Languages &amp; Frameworks → i18n-doctor</em>
  (enable, Node path, debounce, log level, coverage).
</p>

<p>
  Command: <em>Tools → Restart Language Server</em>
</p>

<h3>Supported stacks</h3>
<p>
  Works with common JS/TS i18n setups detected by i18n-doctor (including
  i18next / react-i18next, next-intl, vue-i18n, FormatJS / react-intl, Lingui,
  ngx-translate / Transloco, and more). JSON, YAML, and JS/TS catalog modules
  are supported.
</p>

<h3>Links</h3>
<ul>
  <li>Documentation &amp; source: <a href="https://github.com/taha-farzalizadeh/i18n-doctor">github.com/taha-farzalizadeh/i18n-doctor</a></li>
  <li>CLI: <code>npx i18n-doctor check</code></li>
</ul>

<p><i>Beta v0.9.3 — please report issues on GitHub.</i></p>
<!-- END MARKETPLACE DESCRIPTION -->
```

## Tags / categories (suggestions)

- Categories: **Code tools**, **Inspection tools** / **Linter**
- Tags: `i18n`, `l10n`, `localization`, `translation`, `i18next`, `javascript`, `typescript`, `lsp`, `diagnostics`

## Compatible products

Mark at least:

- WebStorm
- IntelliJ IDEA Ultimate
- PhpStorm
- (optional) other IDEs that include the platform LSP + JavaScript plugin

**Do not** list IntelliJ IDEA Community or Android Studio (no LSP module).

## License

```
MIT
```

## Vendor

```
Name: i18n-doctor
URL: https://github.com/taha-farzalizadeh/i18n-doctor
Email: (your contact email)
```

## Repository / homepage

```
https://github.com/taha-farzalizadeh/i18n-doctor
https://github.com/taha-farzalizadeh/i18n-doctor/tree/main/packages/jetbrains
```

## Screenshots to attach (recommended)

Capture from `npm run runIde -w i18n-doctor-jetbrains` + `examples/demo-project`:

1. `src/Login.tsx` with `"auth.nonexistent"` underlined + tooltip message  
2. `locales/en.json` with unused `"logout"` key underlined  
3. Problems tool window listing i18n-doctor findings  
4. Settings page: Languages & Frameworks → i18n-doctor  

## Channel notes

- Use channel **default** for public releases.
- Use channel **eap** only if you intentionally ship pre-releases.

## Change notes (0.9.3)

```html
<h3>0.9.3</h3>
<p>Fix Marketplace Plugin Verifier rejection: stop using internal Platform APIs.</p>
<ul>
  <li>Resolve plugin path via public PluginPathManager</li>
  <li>Extract bundled server under PathManager.getTempPath()</li>
</ul>
```

## Change notes (0.9.2)

Update this block every time you bump the version before publish:

```
0.9.3 — Fix internal API usages for Marketplace approval
• LSP client for the bundled i18n-doctor language server
• Live diagnostics for missing / unused / duplicate / coverage keys
• Self-contained server bundle (no project dependency required)
• Uses WebStorm JavaScript Runtime for Node.js when available
• Plugin icons for light and dark themes
```

**Before the next deploy**, change `0.9.3` → the new version (e.g. `0.9.4`) in
`gradle.properties`, `package.json`, `plugin.xml`, and this section.
