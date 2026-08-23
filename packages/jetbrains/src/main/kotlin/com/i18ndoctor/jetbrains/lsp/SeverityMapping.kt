package com.i18ndoctor.jetbrains.lsp

/**
 * Documents how LSP diagnostic severities map onto JetBrains highlight
 * severities. The IntelliJ Platform LSP host performs this mapping; the plugin
 * must not hard-code every finding as an error.
 *
 * | LSP severity   | JetBrains HighlightSeverity |
 * |----------------|-----------------------------|
 * | Error          | ERROR                       |
 * | Warning        | WARNING                     |
 * | Information    | WEAK_WARNING / INFORMATION  |
 * | Hint           | INFORMATION / HINT          |
 */
object SeverityMapping {

  enum class LspSeverity {
    ERROR,
    WARNING,
    INFORMATION,
    HINT,
  }

  enum class IdeSeverity {
    ERROR,
    WARNING,
    WEAK_WARNING,
    INFORMATION,
  }

  fun map(severity: LspSeverity): IdeSeverity = when (severity) {
    LspSeverity.ERROR -> IdeSeverity.ERROR
    LspSeverity.WARNING -> IdeSeverity.WARNING
    LspSeverity.INFORMATION -> IdeSeverity.WEAK_WARNING
    LspSeverity.HINT -> IdeSeverity.INFORMATION
  }

  /** LSP numeric codes from the protocol (1=Error … 4=Hint). */
  fun fromLspCode(code: Int): LspSeverity? = when (code) {
    1 -> LspSeverity.ERROR
    2 -> LspSeverity.WARNING
    3 -> LspSeverity.INFORMATION
    4 -> LspSeverity.HINT
    else -> null
  }
}
