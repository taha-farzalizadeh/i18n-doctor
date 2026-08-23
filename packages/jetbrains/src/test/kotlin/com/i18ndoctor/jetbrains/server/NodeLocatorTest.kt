package com.i18ndoctor.jetbrains.server

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path

class NodeLocatorTest {

  @TempDir
  lateinit var root: Path

  @Test
  fun `uses explicit node when probe succeeds`() {
    val node = root.resolve("node")
    Files.writeString(node, "#!/bin/sh\n")
    val result = NodeLocator.resolve(
      explicitPath = node.toString(),
      pathEntries = emptyList(),
      fileExists = { Files.isRegularFile(it) },
      isUsableNode = { it == node },
    )
    assertTrue(result is NodeLocator.Either.Ok)
    assertEquals(node, (result as NodeLocator.Either.Ok).value.executable)
  }

  @Test
  fun `rejects explicit node when probe fails`() {
    val node = root.resolve("node")
    Files.writeString(node, "#!/bin/sh\n")
    val result = NodeLocator.resolve(
      explicitPath = node.toString(),
      pathEntries = emptyList(),
      fileExists = { true },
      isUsableNode = { false },
    )
    assertTrue(result is NodeLocator.Either.Err)
  }

  @Test
  fun `searches PATH-like entries`() {
    val node = root.resolve("bin").resolve("node")
    Files.createDirectories(node.parent)
    Files.writeString(node, "#!/bin/sh\n")
    val result = NodeLocator.resolve(
      explicitPath = null,
      pathEntries = listOf(node.toString()),
      fileExists = { Files.isRegularFile(it) },
      isUsableNode = { it == node },
    )
    assertTrue(result is NodeLocator.Either.Ok)
  }

  @Test
  fun `real node on this machine is accepted when available`() {
    val which = ProcessBuilder("which", "node")
      .redirectErrorStream(true)
      .start()
    which.waitFor()
    if (which.exitValue() != 0) return
    val path = which.inputStream.bufferedReader().readText().trim()
    if (path.isEmpty()) return

    val result = NodeLocator.resolve(explicitPath = path)
    assertTrue(result is NodeLocator.Either.Ok, "expected real node at $path to be usable")
  }
}
