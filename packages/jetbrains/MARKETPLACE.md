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
Live i18n diagnostics — missing, unused, coverage, and untranslated UI text as you type
```

## Detailed description (HTML)

Marketplace accepts HTML. Copy everything between the markers:

```html
<!-- BEGIN MARKETPLACE DESCRIPTION -->
<h2>Live i18n diagnostics for JavaScript &amp; TypeScript</h2>

<p>
  <b>i18n-doctor</b> underlines missing, unused, duplicate, and untranslated
  text issues while you edit — powered by the same analyzer as the
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
    key in every locale file that defines them. Softened to info when a
    dynamic usage may cover the key.
  </li>
  <li>
    <b>Untranslated text</b> — hardcoded JSX / UI attribute strings not passed
    through a translator (default severity: info).
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

<p><i>Beta v0.10.2 — please report issues on GitHub.</i></p>
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

## Change notes (0.11.0)

```html
<h3>0.11.0</h3>
<p>Phase 20 — Translation Intelligence (Go to Translation, Hover, Completion).</p>
<ul>
  <li><b>Go to Translation</b> — navigate from <code>t("key")</code> to the catalog entry</li>
  <li><b>Hover</b> — show locale values, namespace, and source location</li>
  <li><b>Completion</b> — suggest translation keys inside supported calls</li>
  <li>Shared translation index with ESLint / analyzer (no second parser)</li>
</ul>
```

## Change notes (0.10.3)

```html
<h3>0.10.3</h3>
<p>Marketplace integrity fix: do not disturb the IDE Trial widget.</p>
<ul>
  <li>Start the language server only in i18n-relevant projects (config, i18n deps, or locales)</li>
  <li>Skip automatic start when Node.js / server binary is unavailable — log instead of throwing</li>
</ul>
```

## Change notes (0.10.2)

```html
<h3>0.10.2</h3>
<p>Monorepo release with settings, <code>ignoreKeys</code>, and ESLint cache fixes.</p>
<ul>
  <li><b>Log level / debounce apply immediately</b> — saving Settings → i18n-doctor restarts the language server</li>
  <li><b><code>ignoreKeys</code> matching</b> — <code>SERVER_*</code> also matches namespaced / nested keys</li>
  <li><b>Config without <code>i18n-doctor</code> package</b> — plain JSON / object configs work for IDE-only users</li>
  <li>Rebundled language server @ 0.10.2</li>
</ul>
```

## Change notes (0.10.1)

```html
<h3>0.10.1</h3>
<p>Bug fixes for settings, <code>ignoreKeys</code>, and config without a CLI install.</p>
<ul>
  <li><b>Log level / debounce apply immediately</b> — saving Settings → i18n-doctor now restarts the language server so overrides take effect (previously only applied on cold start)</li>
  <li><b><code>ignoreKeys</code> matching</b> — patterns like <code>SERVER_*</code> also match namespaced / nested keys (<code>common:SERVER_USER</code>, <code>errors.SERVER_TIMEOUT</code>)</li>
  <li><b>Config without <code>i18n-doctor</code> package</b> — use plain <code>i18n-doctor.config.json</code> or <code>export default { ignoreKeys: […] }</code>; no import required for IDE-only users</li>
  <li>Rebundled language server with the above fixes</li>
</ul>
```

## Change notes (0.10.0)

```html
<h3>0.10.0</h3>
<p>Unified configuration — one <code>i18n-doctor.config.ts</code> for CLI, ESLint, and IDE.</p>
<ul>
  <li>The language server now loads the same <code>i18n-doctor.config.ts</code> from the workspace root</li>
  <li>New <code>ignoreKeys</code> option (glob patterns) to suppress <code>unused</code> findings for backend-provided or dynamically referenced keys</li>
  <li><code>ignoreKeys</code> affects only <code>unused</code> — missing-key, duplicate-key, locale-consistency, and hardcoded-text detection stay active</li>
  <li>TypeScript configs are parsed statically and never executed — no build step needed</li>
  <li>Clear errors naming the file for invalid configs</li>
  <li>Rebundled language server with the above</li>
</ul>
```

## Change notes (0.9.5)

```html
<h3>0.9.5</h3>
<p>Detect hardcoded UI text that is not passed through translation helpers.</p>
<ul>
  <li>New <code>untranslated-text</code> findings for JSX text and common UI attributes</li>
  <li>Default severity: info (raise via config <code>rules["untranslated-text"]</code>)</li>
</ul>
```

## Change notes (0.9.4)

```html
<h3>0.9.4</h3>
<p>Analyzer improvements in the bundled language server.</p>
<ul>
  <li>Detect keys used via prop-passed <code>t</code></li>
  <li>Resolve statically concatenated keys</li>
  <li>Soften unused-key findings when a dynamic usage may cover the key</li>
</ul>
```

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
0.10.0 — Unified config: ignoreKeys (unused-only) + i18n-doctor.config.ts everywhere
• Untranslated hardcoded UI text (info) (0.9.5)
• Prop-passed t + static key concat + dynamic unused softening (0.9.4)
• LSP client for the bundled i18n-doctor language server
• Live diagnostics for missing / unused / duplicate / coverage / untranslated text
• Self-contained server bundle (no project dependency required)
• Uses WebStorm JavaScript Runtime for Node.js when available
• Plugin icons for light and dark themes
```

**Before the next deploy**, change `0.10.0` → the new version (e.g. `0.10.1`) in
`gradle.properties`, `package.json`, `plugin.xml`, and this section.
