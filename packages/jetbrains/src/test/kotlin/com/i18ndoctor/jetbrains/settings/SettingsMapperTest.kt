package com.i18ndoctor.jetbrains.settings

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SettingsMapperTest {

  @Test
  fun `forwards only explicit overrides`() {
    val block = SettingsMapper.toLanguageServerBlock(
      PluginSettingsSnapshot(
        enabled = true,
        debounceMs = 250,
        logLevel = "debug",
      ),
    )
    assertEquals(250, block["debounce"])
    assertEquals("debug", block["logLevel"])
    assertFalse(block.containsKey("enabled"))
    assertFalse(block.containsKey("coverage"))
  }

  @Test
  fun `maps disabled to languageServer enabled false`() {
    val block = SettingsMapper.toLanguageServerBlock(
      PluginSettingsSnapshot(enabled = false),
    )
    assertEquals(false, block["enabled"])
  }

  @Test
  fun `wraps block in initializationOptions`() {
    val options = SettingsMapper.toInitializationOptions(
      PluginSettingsSnapshot(coverage = true),
    )
    @Suppress("UNCHECKED_CAST")
    val ls = options["languageServer"] as Map<String, Any>
    assertEquals(true, ls["coverage"])
  }

  @Test
  fun `empty snapshot produces empty languageServer block`() {
    val block = SettingsMapper.toLanguageServerBlock(PluginSettingsSnapshot())
    assertTrue(block.isEmpty())
  }
}
