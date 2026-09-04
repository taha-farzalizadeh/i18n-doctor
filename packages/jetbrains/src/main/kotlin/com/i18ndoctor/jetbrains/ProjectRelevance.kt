package com.i18ndoctor.jetbrains

/**
 * Cheap activation gate so unrelated projects never spawn the language server.
 * Real discovery (config, locales, namespaces) stays inside the language server.
 */
object ProjectRelevance {

  val I18N_PACKAGE_HINTS: Set<String> = setOf(
    "i18next",
    "react-i18next",
    "next-i18next",
    "next-intl",
    "use-intl",
    "react-intl",
    "@formatjs/intl",
    "@lingui/core",
    "@lingui/react",
    "@lingui/macro",
    "@lingui/cli",
    "vue-i18n",
    "@nuxtjs/i18n",
    "nuxt-i18n",
    "@ngx-translate/core",
    "@jsverse/transloco",
    "@ngneat/transloco",
    "i18n-doctor",
    "@i18n-doctor/cli",
    "@i18n-doctor/language-server",
  )

  val CONFIG_FILE_NAMES: Set<String> = setOf(
    "i18n-doctor.config.ts",
    "i18n-doctor.config.js",
    "i18n-doctor.config.mjs",
    "i18n-doctor.config.cjs",
    "i18n-doctor.config.json",
  )

  fun packageJsonMentionsI18n(jsonText: String): Boolean {
    // Lightweight parse: avoid pulling a JSON library into the activation path.
    // Look for known package names as JSON string keys inside dependency blocks.
    if ("\"i18n-doctor\"" in jsonText) return true
    for (hint in I18N_PACKAGE_HINTS) {
      if ("\"$hint\"" in jsonText) return true
    }
    return false
  }

  fun isConfigFileName(name: String): Boolean = name in CONFIG_FILE_NAMES

  fun looksRelevant(
    hasConfigFile: Boolean,
    packageJsonTexts: Sequence<String>,
  ): Boolean {
    if (hasConfigFile) return true
    return packageJsonTexts.any { packageJsonMentionsI18n(it) }
  }
}
