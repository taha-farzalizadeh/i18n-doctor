package com.i18ndoctor.jetbrains.lsp

import com.i18ndoctor.jetbrains.server.BundledServer
import com.i18ndoctor.jetbrains.server.NodeLocator
import com.i18ndoctor.jetbrains.server.NodeResolver
import com.i18ndoctor.jetbrains.server.ServerLocator
import com.i18ndoctor.jetbrains.settings.I18nDoctorConfigurable
import com.i18ndoctor.jetbrains.settings.I18nDoctorSettings
import com.i18ndoctor.jetbrains.settings.SettingsMapper
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.javascript.nodejs.NodeCommandLineUtil
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.extensions.PluginId
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.platform.lsp.api.LspServer
import com.intellij.platform.lsp.api.LspServerSupportProvider
import com.intellij.platform.lsp.api.ProjectWideLspServerDescriptor
import com.intellij.platform.lsp.api.lsWidget.LspServerWidgetItem
import java.nio.file.Path

private val LOG = Logger.getInstance(I18nDoctorLspSupportProvider::class.java)

internal val SUPPORTED_EXTENSIONS = setOf(
  "js", "jsx", "mjs", "cjs",
  "ts", "tsx", "mts", "cts",
  "json", "jsonc",
  "yaml", "yml",
  "vue", "svelte",
  "html",
)

/**
 * Starts the i18n-doctor language server when a supported file opens.
 * Analysis stays entirely in the language server.
 */
class I18nDoctorLspSupportProvider : LspServerSupportProvider {

  override fun fileOpened(
    project: Project,
    file: VirtualFile,
    serverStarter: LspServerSupportProvider.LspServerStarter,
  ) {
    val settings = I18nDoctorSettings.getInstance().snapshot()
    if (!settings.enabled) return
    if (file.extension?.lowercase() !in SUPPORTED_EXTENSIONS) return

    serverStarter.ensureServerStarted(I18nDoctorLspServerDescriptor(project))
  }

  override fun createLspServerWidgetItem(
    lspServer: LspServer,
    currentFile: VirtualFile?,
  ): LspServerWidgetItem =
    LspServerWidgetItem(
      lspServer,
      currentFile,
      settingsPageClass = I18nDoctorConfigurable::class.java,
    )
}

internal class I18nDoctorLspServerDescriptor(
  project: Project,
) : ProjectWideLspServerDescriptor(project, "i18n-doctor") {

  override fun isSupportedFile(file: VirtualFile): Boolean =
    file.extension?.lowercase() in SUPPORTED_EXTENSIONS

  override fun createInitializationOptions(): Any =
    SettingsMapper.toInitializationOptions(I18nDoctorSettings.getInstance().snapshot())

  override fun createCommandLine(): GeneralCommandLine {
    val settings = I18nDoctorSettings.getInstance().snapshot()
    val pluginRoot = resolvePluginRoot()
      ?: throw IllegalStateException("i18n-doctor plugin root could not be resolved.")

    val server = resolveServerModule(pluginRoot, settings.serverPath.ifBlank { null })
      ?: run {
        val message =
          "The i18n-doctor language server could not be located or extracted. " +
            "Reinstall the plugin, or set Settings → i18n-doctor → Server module path."
        notifyFailure(project, message)
        throw IllegalStateException(message)
      }

    val node = when (val result = NodeResolver.resolve(project, settings.nodePath.ifBlank { null })) {
      is NodeLocator.Either.Ok -> result.value
      is NodeLocator.Either.Err -> {
        notifyFailure(project, result.value.message)
        throw IllegalStateException(result.value.message)
      }
    }

    LOG.info(
      "Starting i18n-doctor language server " +
        "(kind=${server.kind}, module=${server.module}, node=${node.executable})",
    )

    return GeneralCommandLine(
      node.executable.toString(),
      server.module.toAbsolutePath().toString(),
      "--stdio",
    ).apply {
      withWorkDirectory(project.basePath)
      withCharset(Charsets.UTF_8)
      NodeCommandLineUtil.configureUsefulEnvironment(this)
    }
  }
}

internal fun resolveServerModule(
  pluginRoot: Path,
  explicitPath: String?,
): ServerLocator.Result? {
  when (val result = ServerLocator.resolve(pluginRoot, explicitPath)) {
    is ServerLocator.Either.Ok -> return result.value
    is ServerLocator.Either.Err -> {
      if (explicitPath != null) {
        LOG.warn(result.value.message)
        return null
      }
    }
  }
  val extracted = BundledServer.resolveOnDisk() ?: return null
  return ServerLocator.Result(extracted, ServerLocator.Kind.BUNDLED)
}

internal fun resolvePluginRoot(): Path? {
  val plugin = PluginManagerCore.getPlugin(PluginId.getId("com.i18ndoctor.jetbrains"))
    ?: return null
  return plugin.pluginPath
}

internal fun notifyFailure(project: Project, message: String) {
  LOG.warn(message)
  NotificationGroupManager.getInstance()
    .getNotificationGroup("i18n-doctor")
    .createNotification("i18n-doctor", message, NotificationType.ERROR)
    .notify(project)
}
