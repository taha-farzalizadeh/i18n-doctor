package com.i18ndoctor.jetbrains

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

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
}
