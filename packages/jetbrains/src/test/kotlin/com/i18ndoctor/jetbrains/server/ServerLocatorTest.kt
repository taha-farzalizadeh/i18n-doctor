package com.i18ndoctor.jetbrains.server

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path

class ServerLocatorTest {

  @TempDir
  lateinit var root: Path

  @Test
  fun `prefers explicit path when the file exists`() {
    val server = root.resolve("custom-server.js")
    Files.writeString(server, "// server")
    val result = ServerLocator.resolve(root, server.toString())
    assertTrue(result is ServerLocator.Either.Ok)
    val ok = result as ServerLocator.Either.Ok
    assertEquals(ServerLocator.Kind.EXPLICIT, ok.value.kind)
    assertEquals(server, ok.value.module)
  }

  @Test
  fun `fails loudly when explicit path is missing`() {
    val result = ServerLocator.resolve(root, root.resolve("missing.js").toString())
    assertTrue(result is ServerLocator.Either.Err)
  }

  @Test
  fun `uses bundled server under plugin root`() {
    val bundled = root.resolve("server").resolve("server.js")
    Files.createDirectories(bundled.parent)
    Files.writeString(bundled, "// bundled")
    val result = ServerLocator.resolve(root, null)
    assertTrue(result is ServerLocator.Either.Ok)
    val ok = result as ServerLocator.Either.Ok
    assertEquals(ServerLocator.Kind.BUNDLED, ok.value.kind)
    assertEquals(bundled, ok.value.module)
  }

  @Test
  fun `finds workspace language-server during monorepo development`() {
    val monorepo = root.resolve("repo")
    val bin = monorepo
      .resolve("packages")
      .resolve("language-server")
      .resolve("dist")
      .resolve("bin.js")
    Files.createDirectories(bin.parent)
    Files.writeString(bin, "// workspace")
    val pluginRoot = monorepo.resolve("packages").resolve("jetbrains")
    Files.createDirectories(pluginRoot)

    val result = ServerLocator.resolve(pluginRoot, null)
    assertTrue(result is ServerLocator.Either.Ok)
    val ok = result as ServerLocator.Either.Ok
    assertEquals(ServerLocator.Kind.WORKSPACE, ok.value.kind)
    assertEquals(bin, ok.value.module)
  }

  @Test
  fun `reports a clear error when nothing is available`() {
    val result = ServerLocator.resolve(root, null)
    assertTrue(result is ServerLocator.Either.Err)
    val err = result as ServerLocator.Either.Err
    assertTrue(err.value.message.contains("not found"))
  }
}
