package com.i18ndoctor.jetbrains.actions

import com.i18ndoctor.jetbrains.lsp.I18nDoctorLspSupportProvider
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.DumbAware
import com.intellij.platform.lsp.api.LspServerManager

private val LOG = Logger.getInstance(RestartServerAction::class.java)

/** Restarts the i18n-doctor language server for the current project. */
class RestartServerAction : AnAction(), DumbAware {

  override fun actionPerformed(e: AnActionEvent) {
    val project = e.project ?: return
    ApplicationManager.getApplication().invokeLater({
      try {
        LspServerManager.getInstance(project)
          .stopAndRestartIfNeeded(I18nDoctorLspSupportProvider::class.java)
        LOG.info("i18n-doctor language server restarted")
      } catch (error: Throwable) {
        LOG.warn("Failed to restart i18n-doctor language server", error)
      }
    }, project.disposed)
  }
}
