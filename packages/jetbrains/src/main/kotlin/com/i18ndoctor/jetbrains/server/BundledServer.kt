package com.i18ndoctor.jetbrains.server

import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.extensions.PluginId
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption

private val LOG = Logger.getInstance(BundledServer::class.java)

/**
 * Ensures `server.js` exists on disk so Node can execute it. Prefers an
 * already-unpacked copy next to the plugin; otherwise extracts the classpath
 * resource shipped inside the plugin jar into a writable location.
 */
object BundledServer {

  private const val PLUGIN_ID = "com.i18ndoctor.jetbrains"
  private const val RESOURCE = "/server/server.js"
  private const val RELATIVE = "server/server.js"

  fun resolveOnDisk(): Path? {
    val pluginPath = PluginManagerCore.getPlugin(PluginId.getId(PLUGIN_ID))?.pluginPath
    if (pluginPath != null) {
      val besidePlugin = pluginPath.resolve(RELATIVE)
      if (isUsable(besidePlugin)) return besidePlugin
      extractTo(besidePlugin)?.let { return it }
    }

    val temp = Path.of(PathManager.getPluginTempPath(), "i18n-doctor", RELATIVE)
    if (isUsable(temp)) return temp
    return extractTo(temp)
  }

  fun extractTo(target: Path): Path? {
    val stream = BundledServer::class.java.getResourceAsStream(RESOURCE)
    if (stream == null) {
      LOG.warn("Classpath resource $RESOURCE is missing from the plugin jar")
      return null
    }
    return try {
      stream.use { input ->
        Files.createDirectories(target.parent)
        Files.copy(input, target, StandardCopyOption.REPLACE_EXISTING)
      }
      LOG.info("Extracted bundled language server to $target")
      target
    } catch (error: Exception) {
      LOG.warn("Failed to extract bundled language server to $target", error)
      null
    }
  }

  private fun isUsable(path: Path): Boolean =
    Files.isRegularFile(path) && Files.size(path) > 1_000
}
