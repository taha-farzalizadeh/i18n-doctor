package com.i18ndoctor.jetbrains.settings

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.util.xmlb.XmlSerializerUtil

/**
 * Application-level plugin settings. Analyzer rules stay in the project's
 * i18n-doctor config; these fields only cover IDE / process concerns.
 */
@State(
  name = "I18nDoctorSettings",
  storages = [Storage("i18nDoctor.xml")],
)
class I18nDoctorSettings : PersistentStateComponent<I18nDoctorSettings.State> {

  data class State(
    var enabled: Boolean = true,
    var nodePath: String = "",
    var serverPath: String = "",
    /** Empty string = unset (do not override project config). */
    var debounceMs: String = "",
    var logLevel: String = "",
    var maxDiagnosticsPerFile: String = "",
    /** Tri-state: "" unset, "true", "false". */
    var coverage: String = "",
  )

  /** Mutable bean bound by the settings UI. Named to avoid clashing with [getState]. */
  var storedState: State = State()

  override fun getState(): State = storedState

  override fun loadState(state: State) {
    XmlSerializerUtil.copyBean(state, storedState)
  }

  fun snapshot(): PluginSettingsSnapshot {
    return PluginSettingsSnapshot(
      enabled = storedState.enabled,
      nodePath = storedState.nodePath,
      serverPath = storedState.serverPath,
      debounceMs = storedState.debounceMs.trim().toIntOrNull(),
      logLevel = storedState.logLevel.trim().takeIf { it.isNotEmpty() },
      maxDiagnosticsPerFile = storedState.maxDiagnosticsPerFile.trim().toIntOrNull(),
      coverage = when (storedState.coverage.trim().lowercase()) {
        "true" -> true
        "false" -> false
        else -> null
      },
    )
  }

  companion object {
    fun getInstance(): I18nDoctorSettings =
      ApplicationManager.getApplication().getService(I18nDoctorSettings::class.java)
  }
}
