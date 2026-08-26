package com.i18ndoctor.jetbrains.server

import com.intellij.openapi.application.PathManager
import com.intellij.openapi.application.PluginPathManager
import com.intellij.openapi.diagnostic.Logger
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption

private val LOG = Logger.getInstance(BundledServer::class.java)

/**
 * Ensures `server.js` exists on disk so Node can execute it. Prefers an
 * already-unpacked copy in the plugin distribution; otherwise extracts the
 * classpath resource shipped inside the plugin jar into a writable location.
 *
 * Uses only public Platform APIs (`PluginPathManager`, `PathManager.getTempPath`)
 * — never `PluginManagerCore` / `getPluginTempPath`.
 */
object BundledServer {

  private const val RESOURCE = "/server/server.js"
  private const val RELATIVE = "server/server.js"

  fun resolveOnDisk(): Path? {
    val besidePlugin = PluginPathManager.getPluginResource(BundledServer::class.java, RELATIVE)
      ?.toPath()
    if (besidePlugin != null) {
      if (isUsable(besidePlugin)) return besidePlugin
      extractTo(besidePlugin)?.let { return it }
    }

    val temp = Path.of(PathManager.getTempPath(), "i18n-doctor", RELATIVE)
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
