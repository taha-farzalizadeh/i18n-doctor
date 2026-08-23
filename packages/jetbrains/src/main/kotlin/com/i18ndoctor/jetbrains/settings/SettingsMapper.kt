package com.i18ndoctor.jetbrains.settings

/**
 * Pure settings model + mapping onto the language server's `languageServer`
 * initialization / didChangeConfiguration block.
 *
 * Only explicitly configured overrides are forwarded so the project's own
 * i18n-doctor config remains the source of truth for analyzer rules.
 */
data class PluginSettingsSnapshot(
  val enabled: Boolean = true,
  val nodePath: String = "",
  val serverPath: String = "",
  val debounceMs: Int? = null,
  val logLevel: String? = null,
  val maxDiagnosticsPerFile: Int? = null,
  val coverage: Boolean? = null,
)

object SettingsMapper {

  /**
   * Payload nested under `initializationOptions.languageServer` /
   * `workspace/didChangeConfiguration.settings.languageServer`.
   */
  fun toLanguageServerBlock(settings: PluginSettingsSnapshot): Map<String, Any> {
    val block = linkedMapOf<String, Any>()
    if (!settings.enabled) {
      block["enabled"] = false
    }
    settings.debounceMs?.let { block["debounce"] = it }
    settings.logLevel?.takeIf { it.isNotBlank() }?.let { block["logLevel"] = it }
    settings.maxDiagnosticsPerFile?.let { block["maxDiagnosticsPerFile"] = it }
    settings.coverage?.let { block["coverage"] = it }
    return block
  }

  fun toInitializationOptions(settings: PluginSettingsSnapshot): Map<String, Any> {
    return mapOf("languageServer" to toLanguageServerBlock(settings))
  }
}
