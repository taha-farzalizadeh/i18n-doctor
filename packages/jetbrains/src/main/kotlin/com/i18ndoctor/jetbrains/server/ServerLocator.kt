package com.i18ndoctor.jetbrains.server

import java.io.File
import java.nio.file.Files
import java.nio.file.Path

/**
 * Resolves which language-server module the plugin should launch.
 *
 * Order (mirrors the VS Code extension):
 *  1. Explicit user override (`settings.serverPath`)
 *  2. Bundled `server/server.js` shipped inside the plugin jar
 *  3. Monorepo / workspace `@i18n-doctor/language-server/dist/bin.js` (dev only)
 */
object ServerLocator {

  enum class Kind {
    EXPLICIT,
    BUNDLED,
    WORKSPACE,
  }

  data class Result(
    val module: Path,
    val kind: Kind,
  )

  data class Failure(
    val message: String,
  )

  fun resolve(
    pluginRoot: Path,
    explicitPath: String?,
    fileExists: (Path) -> Boolean = { Files.isRegularFile(it) },
  ): Either {
    val trimmed = explicitPath?.trim().orEmpty()
    if (trimmed.isNotEmpty()) {
      val resolved = Path.of(trimmed).let { path ->
        if (path.isAbsolute) path else pluginRoot.resolve(path).normalize()
      }
      return if (fileExists(resolved)) {
        Either.Ok(Result(resolved, Kind.EXPLICIT))
      } else {
        Either.Err(
          Failure(
            "i18n-doctor server path points to \"$resolved\", but no file exists there.",
          ),
        )
      }
    }

    val bundled = pluginRoot.resolve("server").resolve("server.js")
    if (fileExists(bundled)) {
      return Either.Ok(Result(bundled, Kind.BUNDLED))
    }

    // Development: walk up looking for the monorepo language-server package.
    var current: Path? = pluginRoot
    repeat(10) {
      val here = current ?: return@repeat
      val candidate = here
        .resolve("node_modules")
        .resolve("@i18n-doctor")
        .resolve("language-server")
        .resolve("dist")
        .resolve("bin.js")
      if (fileExists(candidate)) {
        return Either.Ok(Result(candidate, Kind.WORKSPACE))
      }
      // Also accept packages/jetbrains sitting next to packages/language-server.
      val sibling = here
        .resolve("packages")
        .resolve("language-server")
        .resolve("dist")
        .resolve("bin.js")
      if (fileExists(sibling)) {
        return Either.Ok(Result(sibling, Kind.WORKSPACE))
      }
      current = here.parent
    }

    return Either.Err(
      Failure(
        "The i18n-doctor language server was not found at \"$bundled\". " +
          "Reinstall the plugin, or run \"npm run build -w i18n-doctor-jetbrains\" " +
          "when developing from the monorepo.",
      ),
    )
  }

  sealed class Either {
    data class Ok(val value: Result) : Either()
    data class Err(val value: Failure) : Either()
  }
}

/** Convenience: treat a File-based plugin path the same way. */
fun ServerLocator.resolve(
  pluginRoot: File,
  explicitPath: String?,
): ServerLocator.Either = resolve(pluginRoot.toPath(), explicitPath)
