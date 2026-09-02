package com.i18ndoctor.jetbrains.settings

import com.i18ndoctor.jetbrains.lsp.I18nDoctorLspSupportProvider
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.options.BoundConfigurable
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.ui.DialogPanel
import com.intellij.platform.lsp.api.LspServerManager
import com.intellij.ui.dsl.builder.bindSelected
import com.intellij.ui.dsl.builder.bindText
import com.intellij.ui.dsl.builder.panel

private val LOG = Logger.getInstance(I18nDoctorConfigurable::class.java)

/** Settings UI under Languages & Frameworks → i18n-doctor. */
class I18nDoctorConfigurable : BoundConfigurable("i18n-doctor") {

  private val settings = I18nDoctorSettings.getInstance()

  override fun createPanel(): DialogPanel {
    val state = settings.storedState
    return panel {
      row {
        checkBox("Enable i18n-doctor diagnostics")
          .bindSelected(state::enabled)
      }
      group("Process") {
        row("Node.js path:") {
          textField()
            .bindText(state::nodePath)
            .comment(
              "Leave empty to use WebStorm's project Node interpreter " +
                "(Settings → Languages & Frameworks → JavaScript Runtime).",
            )
            .resizableColumn()
        }
        row("Server module path:") {
          textField()
            .bindText(state::serverPath)
            .comment("Development override. Leave empty to use the bundled language server.")
            .resizableColumn()
        }
      }
      group("Language server overrides") {
        row {
          comment(
            "Only filled values are sent to the server. Empty fields keep the " +
              "project's i18n-doctor config as the source of truth. " +
              "Applying changes restarts the language server so log level / " +
              "debounce take effect immediately.",
          )
        }
        row("Debounce (ms):") {
          textField().bindText(state::debounceMs)
        }
        row("Log level:") {
          textField()
            .bindText(state::logLevel)
            .comment("silent | error | warn | info | debug")
        }
        row("Max diagnostics per file:") {
          textField().bindText(state::maxDiagnosticsPerFile)
        }
        row("Coverage:") {
          textField()
            .bindText(state::coverage)
            .comment("true | false | empty (unset)")
        }
      }
    }
  }

  override fun apply() {
    super.apply()
    restartLanguageServers()
  }

  private fun restartLanguageServers() {
    ApplicationManager.getApplication().invokeLater {
      for (project in ProjectManager.getInstance().openProjects) {
        if (project.isDisposed) continue
        try {
          LspServerManager.getInstance(project)
            .stopAndRestartIfNeeded(I18nDoctorLspSupportProvider::class.java)
          LOG.info("Restarted i18n-doctor language server after settings change (${project.name})")
        } catch (error: Throwable) {
          LOG.warn("Failed to restart i18n-doctor language server for ${project.name}", error)
        }
      }
    }
  }
}
