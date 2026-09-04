package com.i18ndoctor.jetbrains.lsp

import com.i18ndoctor.jetbrains.ProjectRelevance
import com.i18ndoctor.jetbrains.server.BundledServer
import com.i18ndoctor.jetbrains.server.NodeLocator
import com.i18ndoctor.jetbrains.server.NodeResolver
import com.i18ndoctor.jetbrains.server.PluginPaths
import com.i18ndoctor.jetbrains.server.ServerLocator
import com.i18ndoctor.jetbrains.settings.I18nDoctorConfigurable
import com.i18ndoctor.jetbrains.settings.I18nDoctorSettings
import com.i18ndoctor.jetbrains.settings.SettingsMapper
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.javascript.nodejs.NodeCommandLineUtil
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.platform.lsp.api.LspServer
import com.intellij.platform.lsp.api.LspServerSupportProvider
import com.intellij.platform.lsp.api.ProjectWideLspServerDescriptor
import com.intellij.platform.lsp.api.lsWidget.LspServerWidgetItem
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.ConcurrentHashMap

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
 *
 * Important for Marketplace / IDE integrity checks:
 * - never start the server in unrelated projects
 * - never throw during automatic start when Node/server is missing
 *   (throws from [createCommandLine] can break the IDE UI, including the Trial widget)
 */
class I18nDoctorLspSupportProvider : LspServerSupportProvider {

  /** Projects we already logged a soft-fail for (avoid log spam). */
  private val softFailedProjects = ConcurrentHashMap.newKeySet<String>()

  override fun fileOpened(
    project: Project,
    file: VirtualFile,
    serverStarter: LspServerSupportProvider.LspServerStarter,
  ) {
    val settings = I18nDoctorSettings.getInstance().snapshot()
    if (!settings.enabled) return
    if (file.extension?.lowercase() !in SUPPORTED_EXTENSIONS) return
    if (!projectLooksRelevant(project)) return

    val readiness = resolveLaunchReadiness(project, settings.serverPath, settings.nodePath)
    if (readiness is LaunchReadiness.Unavailable) {
      val key = project.locationHash
      if (softFailedProjects.add(key)) {
        LOG.warn(
          "i18n-doctor language server not started: ${readiness.reason}. " +
            "Configure Node.js under Settings → Languages & Frameworks → JavaScript Runtime " +
            "(or Settings → i18n-doctor → Node.js path).",
        )
      }
      return
    }

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
    val readiness = resolveLaunchReadiness(project, settings.serverPath, settings.nodePath)
    if (readiness is LaunchReadiness.Unavailable) {
      // Should not be reached when fileOpened gates correctly; keep a clear message.
      throw IllegalStateException(readiness.reason)
    }
    val ready = readiness as LaunchReadiness.Ready

    LOG.info(
      "Starting i18n-doctor language server " +
        "(kind=${ready.server.kind}, module=${ready.server.module}, node=${ready.node.executable})",
    )

    return GeneralCommandLine(
      ready.node.executable.toString(),
      ready.server.module.toAbsolutePath().toString(),
      "--stdio",
    ).apply {
      withWorkDirectory(project.basePath)
      withCharset(Charsets.UTF_8)
      NodeCommandLineUtil.configureUsefulEnvironment(this)
    }
  }
}

internal sealed class LaunchReadiness {
  data class Ready(
    val server: ServerLocator.Result,
    val node: NodeLocator.Result,
  ) : LaunchReadiness()

  data class Unavailable(val reason: String) : LaunchReadiness()
}

internal fun resolveLaunchReadiness(
  project: Project,
  serverPathOverride: String,
  nodePathOverride: String,
): LaunchReadiness {
  val pluginRoot = PluginPaths.resolvePluginRoot()
    ?: return LaunchReadiness.Unavailable("i18n-doctor plugin root could not be resolved")

  val server = resolveServerModule(pluginRoot, serverPathOverride.ifBlank { null })
    ?: return LaunchReadiness.Unavailable(
      "The i18n-doctor language server could not be located or extracted",
    )

  return when (val node = NodeResolver.resolve(project, nodePathOverride.ifBlank { null })) {
    is NodeLocator.Either.Ok -> LaunchReadiness.Ready(server, node.value)
    is NodeLocator.Either.Err -> LaunchReadiness.Unavailable(node.value.message)
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

/**
 * Cheap relevance check so Marketplace checker / empty IDE projects never spawn
 * the language server (and never hit missing-Node failure paths).
 */
internal fun projectLooksRelevant(project: Project): Boolean {
  val base = project.basePath ?: return false
  return projectRootLooksRelevant(Path.of(base))
}

internal fun projectRootLooksRelevant(root: Path): Boolean {
  return try {
    val hasConfig = ProjectRelevance.CONFIG_FILE_NAMES.any { name ->
      Files.isRegularFile(root.resolve(name))
    }
    val packageJson = root.resolve("package.json")
    val packageJsonTexts =
      if (Files.isRegularFile(packageJson)) {
        sequenceOf(Files.readString(packageJson))
      } else {
        emptySequence()
      }
    if (ProjectRelevance.looksRelevant(hasConfig, packageJsonTexts)) {
      true
    } else {
      // Common locale layouts without an i18n package at the workspace root.
      Files.isDirectory(root.resolve("locales")) ||
        Files.isDirectory(root.resolve("i18n")) ||
        Files.isDirectory(root.resolve("public").resolve("locales"))
    }
  } catch (_: Exception) {
    false
  }
}
