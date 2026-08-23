package com.i18ndoctor.jetbrains.lsp

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SupportedFilesTest {

  @Test
  fun `supports JS TS JSON YAML and common frontend SFCs`() {
    for (ext in listOf("js", "jsx", "ts", "tsx", "json", "yaml", "yml", "vue", "svelte")) {
      assertTrue(ext in SUPPORTED_EXTENSIONS, ext)
    }
  }

  @Test
  fun `does not claim unrelated binary formats`() {
    assertFalse("png" in SUPPORTED_EXTENSIONS)
    assertFalse("class" in SUPPORTED_EXTENSIONS)
  }
}
