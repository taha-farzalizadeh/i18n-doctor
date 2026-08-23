package com.i18ndoctor.jetbrains.settings

import com.intellij.openapi.options.BoundConfigurable
import com.intellij.openapi.ui.DialogPanel
import com.intellij.ui.dsl.builder.bindSelected
import com.intellij.ui.dsl.builder.bindText
import com.intellij.ui.dsl.builder.panel

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
              "project's i18n-doctor config as the source of truth.",
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
}
