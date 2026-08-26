package com.i18ndoctor.jetbrains.server

import com.intellij.openapi.application.PathManager
import com.intellij.openapi.application.PluginPathManager
import java.nio.file.Path

/**
 * Resolves this plugin's install directory using public Platform APIs only.
 *
 * Avoids `PluginManagerCore.getPlugin` (flagged as @Internal by Plugin Verifier).
 */
object PluginPaths {

  private val ANCHOR = BundledServer::class.java

  fun resolvePluginRoot(): Path? {
    // Public API: resource path is rooted at the installed plugin distribution.
    PluginPathManager.getPluginResource(ANCHOR, "server")?.toPath()?.parent?.let {
      return it
    }

    // Fallback when the distribution layout is a single jar / lib/*.jar.
    val jar = PathManager.getJarForClass(ANCHOR) ?: return null
    val parent = jar.parent ?: return null
    return if (parent.fileName?.toString() == "lib") parent.parent else parent
  }
}
