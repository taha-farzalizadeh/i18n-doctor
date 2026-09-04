package com.i18ndoctor.jetbrains

import com.i18ndoctor.jetbrains.lsp.projectRootLooksRelevant
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path

class ProjectRelevanceTest {

  @Test
  fun `detects i18next dependency`() {
    val json = """
      {
        "dependencies": {
          "react": "^18.0.0",
          "i18next": "^23.0.0"
        }
      }
    """.trimIndent()
    assertTrue(ProjectRelevance.packageJsonMentionsI18n(json))
  }

  @Test
  fun `ignores unrelated package json`() {
    val json = """{ "dependencies": { "lodash": "4.17.21" } }"""
    assertFalse(ProjectRelevance.packageJsonMentionsI18n(json))
  }

  @Test
  fun `config file alone is enough`() {
    assertTrue(
      ProjectRelevance.looksRelevant(
        hasConfigFile = true,
        packageJsonTexts = emptySequence(),
      ),
    )
  }

  @Test
  fun `recognizes config file names`() {
    assertTrue(ProjectRelevance.isConfigFileName("i18n-doctor.config.ts"))
    assertFalse(ProjectRelevance.isConfigFileName("vite.config.ts"))
  }

  @Test
  fun `empty project root is not relevant`(@TempDir dir: Path) {
    assertFalse(projectRootLooksRelevant(dir))
  }

  @Test
  fun `locales directory makes root relevant`(@TempDir dir: Path) {
    Files.createDirectory(dir.resolve("locales"))
    assertTrue(projectRootLooksRelevant(dir))
  }

  @Test
  fun `i18n package in package json makes root relevant`(@TempDir dir: Path) {
    Files.writeString(
      dir.resolve("package.json"),
      """{"dependencies":{"i18next":"23.0.0"}}""",
    )
    assertTrue(projectRootLooksRelevant(dir))
  }
}
