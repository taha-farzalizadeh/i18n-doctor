package com.i18ndoctor.jetbrains.server

import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.fail
import java.nio.file.Files
import java.nio.file.Path

/**
 * The packaged plugin must ship a self-contained language server so users do
 * not need `@i18n-doctor/language-server` in their project.
 */
class PackagedServerAvailabilityTest {

  @Test
  fun `bundled server js exists and looks like a Node entrypoint`() {
    val candidates = listOf(
      Path.of("src/main/resources/server/server.js"),
      Path.of("packages/jetbrains/src/main/resources/server/server.js"),
    )
    val server = candidates.firstOrNull { Files.isRegularFile(it) }
      ?: fail(
        "Missing bundled server.js — run `npm run bundle:server -w i18n-doctor-jetbrains` " +
          "before packaging.",
      )

    assertTrue(Files.size(server) > 50_000, "bundled server looks too small: $server")
    val head = Files.readString(server).take(200)
    assertTrue(
      head.contains("require") || head.contains("exports") || head.contains("stdio"),
      "bundled server does not look like a CommonJS Node entry: ${head.take(80)}",
    )
  }
}
