package com.i18ndoctor.jetbrains.server

import com.intellij.javascript.nodejs.interpreter.NodeJsInterpreterManager
import com.intellij.javascript.nodejs.interpreter.local.NodeJsLocalInterpreter
import com.intellij.javascript.nodejs.interpreter.local.NodeJsLocalInterpreterManager
import com.intellij.openapi.project.Project
import java.nio.file.Path

/**
 * Resolves the Node.js executable used to launch the bundled language server.
 *
 * Prefers WebStorm's configured project Node interpreter (Settings → JavaScript
 * Runtime), then explicit plugin settings, then common install locations.
 */
object NodeResolver {

  fun resolve(project: Project, explicitPath: String?): NodeLocator.Either {
    val trimmed = explicitPath?.trim().orEmpty()
    if (trimmed.isNotEmpty()) {
      return NodeLocator.resolve(trimmed)
    }

    resolveFromWebStorm(project)?.let { path ->
      return NodeLocator.Either.Ok(NodeLocator.Result(path))
    }

    return NodeLocator.resolve(null)
  }

  internal fun resolveFromWebStorm(project: Project): Path? {
    val manager = NodeJsInterpreterManager.getInstance(project)
    val interpreter = manager.interpreter ?: manager.getInterpreter(false)
    if (interpreter != null) {
      val local = NodeJsLocalInterpreter.tryCast(interpreter)
      if (local != null && local.isValid) {
        val path = Path.of(local.interpreterSystemDependentPath)
        if (NodeLocator.probeNodeVersion(path)) return path
      }
    }

    val detected = NodeJsLocalInterpreterManager.getInstance().detectMostRelevant()
    if (detected != null && detected.isValid) {
      val path = Path.of(detected.interpreterSystemDependentPath)
      if (NodeLocator.probeNodeVersion(path)) return path
    }

    return null
  }
}
