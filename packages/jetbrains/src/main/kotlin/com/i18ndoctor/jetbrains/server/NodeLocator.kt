package com.i18ndoctor.jetbrains.server

import java.io.File
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.TimeUnit

/**
 * Locates a Node.js ≥ 18 executable used to run the bundled language server.
 *
 * The plugin does not ship a Node runtime. Resolution order:
 *  1. Explicit path from settings
 *  2. `node` on PATH
 *  3. Common install locations (Homebrew, nvm default alias, fnm, Volta)
 */
object NodeLocator {

  data class Result(val executable: Path)

  data class Failure(val message: String)

  fun resolve(
    explicitPath: String?,
    pathEntries: List<String> = defaultPathEntries(),
    fileExists: (Path) -> Boolean = { Files.isRegularFile(it) || Files.isExecutable(it) },
    isUsableNode: (Path) -> Boolean = ::probeNodeVersion,
  ): Either {
    val trimmed = explicitPath?.trim().orEmpty()
    if (trimmed.isNotEmpty()) {
      val path = Path.of(trimmed)
      return if (fileExists(path) && isUsableNode(path)) {
        Either.Ok(Result(path))
      } else {
        Either.Err(
          Failure(
            "i18n-doctor Node.js path points to \"$path\", but it is not a usable " +
              "Node.js ≥ 18 executable.",
          ),
        )
      }
    }

    for (entry in pathEntries) {
      val candidate = Path.of(entry)
      if (!fileExists(candidate)) continue
      if (isUsableNode(candidate)) {
        return Either.Ok(Result(candidate))
      }
    }

    return Either.Err(
      Failure(
        "Node.js ≥ 18 was not found. Configure it under Settings → Languages & Frameworks → " +
          "JavaScript Runtime, or set Settings → i18n-doctor → Node.js path.",
      ),
    )
  }

  fun defaultPathEntries(): List<String> {
    val fromPath = System.getenv("PATH")
      ?.split(File.pathSeparator)
      ?.map { dir -> File(dir, "node").absolutePath }
      .orEmpty()

    val home = System.getProperty("user.home").orEmpty()
    val extras = listOf(
      "/opt/homebrew/bin/node",
      "/usr/local/bin/node",
      "/usr/bin/node",
      "$home/.volta/bin/node",
      "$home/.local/share/fnm/aliases/default/bin/node",
      "$home/.nvm/current/bin/node",
    )

    return (fromPath + extras).distinct()
  }

  /**
   * Runs `node -p process.versions.node` and accepts major ≥ 18.
   * Fail-open on probe errors only when the file exists and looks executable —
   * callers already checked existence; this filters obviously ancient Node.
   */
  fun probeNodeVersion(executable: Path): Boolean {
    return try {
      val process = ProcessBuilder(executable.toString(), "-p", "process.versions.node")
        .redirectErrorStream(true)
        .start()
      val finished = process.waitFor(5, TimeUnit.SECONDS)
      if (!finished) {
        process.destroyForcibly()
        return false
      }
      if (process.exitValue() != 0) return false
      val version = process.inputStream.bufferedReader().readText().trim()
      val major = version.substringBefore('.').toIntOrNull() ?: return false
      major >= 18
    } catch (_: Exception) {
      false
    }
  }

  sealed class Either {
    data class Ok(val value: Result) : Either()
    data class Err(val value: Failure) : Either()
  }
}
