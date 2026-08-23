package com.i18ndoctor.jetbrains.lsp

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class SeverityMappingTest {

  @Test
  fun `maps LSP severities to JetBrains severities`() {
    assertEquals(
      SeverityMapping.IdeSeverity.ERROR,
      SeverityMapping.map(SeverityMapping.LspSeverity.ERROR),
    )
    assertEquals(
      SeverityMapping.IdeSeverity.WARNING,
      SeverityMapping.map(SeverityMapping.LspSeverity.WARNING),
    )
    assertEquals(
      SeverityMapping.IdeSeverity.WEAK_WARNING,
      SeverityMapping.map(SeverityMapping.LspSeverity.INFORMATION),
    )
    assertEquals(
      SeverityMapping.IdeSeverity.INFORMATION,
      SeverityMapping.map(SeverityMapping.LspSeverity.HINT),
    )
  }

  @Test
  fun `parses LSP numeric severity codes`() {
    assertEquals(SeverityMapping.LspSeverity.ERROR, SeverityMapping.fromLspCode(1))
    assertEquals(SeverityMapping.LspSeverity.WARNING, SeverityMapping.fromLspCode(2))
    assertEquals(SeverityMapping.LspSeverity.INFORMATION, SeverityMapping.fromLspCode(3))
    assertEquals(SeverityMapping.LspSeverity.HINT, SeverityMapping.fromLspCode(4))
    assertEquals(null, SeverityMapping.fromLspCode(0))
  }
}
