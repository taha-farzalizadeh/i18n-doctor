# JetBrains / WebStorm client

Use the production plugin in [`packages/jetbrains`](../../jetbrains) — a thin
LSP client that bundles this language server and talks stdio via the IntelliJ
Platform LSP API (`com.intellij.platform.lsp`).

```
WebStorm → i18n-doctor plugin → node server.js --stdio → this package → analyzer
```

Install / develop / publish:

- [packages/jetbrains/README.md](../../jetbrains/README.md)
- [packages/jetbrains/PUBLISHING.md](../../jetbrains/PUBLISHING.md)
- [packages/jetbrains/MARKETPLACE.md](../../jetbrains/MARKETPLACE.md)

## Minimal custom client

If you are embedding the server in your own plugin instead of using
`i18n-doctor-jetbrains`, the shape is:

```kotlin
package com.example.i18ndoctor

import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.openapi.project.Project
import com.intellij.platform.lsp.api.LspServerSupportProvider
import com.intellij.platform.lsp.api.ProjectWideLspServerDescriptor
import com.intellij.openapi.vfs.VirtualFile

private val SUPPORTED = setOf("js", "jsx", "ts", "tsx", "json", "yaml", "yml")

class I18nDoctorLspSupportProvider : LspServerSupportProvider {
  override fun fileOpened(
    project: Project,
    file: VirtualFile,
    serverStarter: LspServerSupportProvider.LspServerStarter,
  ) {
    if (file.extension !in SUPPORTED) return
    serverStarter.ensureServerStarted(I18nDoctorLspDescriptor(project))
  }
}

private class I18nDoctorLspDescriptor(project: Project) :
  ProjectWideLspServerDescriptor(project, "i18n-doctor") {

  override fun isSupportedFile(file: VirtualFile) = file.extension in SUPPORTED

  override fun createCommandLine(): GeneralCommandLine =
    GeneralCommandLine(
      "node",
      "/absolute/path/to/bundled/server.js",
      "--stdio",
    )
}
```

Register it in `plugin.xml`:

```xml
<depends>com.intellij.modules.ultimate</depends>
<extensions defaultExtensionNs="com.intellij">
  <platform.lsp.serverSupportProvider
      implementation="com.example.i18ndoctor.I18nDoctorLspSupportProvider"/>
</extensions>
```

## Notes

- Prefer shipping a self-contained `server.js` (see `packages/jetbrains/scripts/bundle-server.mjs`)
  so end users do not need `@i18n-doctor/language-server` in the project.
- `ProjectWideLspServerDescriptor` gives the server one workspace root, which is
  what `initialize` uses for project discovery.
- JetBrains sends `file:` URIs with a percent-encoded drive letter on Windows
  (`file:///c%3A/…`); the server normalizes both spellings to the same document.
- Server logs arrive as `window/logMessage` and appear in the IDE log / LSP
  console — keep stdout reserved for JSON-RPC.
