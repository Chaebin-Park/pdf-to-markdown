package org.example

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import java.time.Instant

class ConversionQualityValidatorTest {
    @TempDir
    lateinit var tempDir: Path

    @Test
    fun `accepts fresh complete artifacts`() {
        val startedAt = Instant.now().minusSeconds(1)
        val markdown = tempDir.resolve("result.md").toFile().apply { writeText("# title\n\nbody") }
        val json = tempDir.resolve("result.json").toFile().apply {
            writeText("""{"number of pages":2,"kids":[{"page number":1},{"page number":2}]}""")
        }

        val report = ConversionQualityValidator.validate(markdown, json, startedAt)

        assertTrue(report.isUsable)
        assertFalse(report.hasWarnings)
    }

    @Test
    fun `rejects missing or empty artifacts`() {
        val markdown = tempDir.resolve("result.md").toFile().apply { writeText("") }
        val json = tempDir.resolve("missing.json").toFile()

        val report = ConversionQualityValidator.validate(markdown, json, Instant.now().minusSeconds(1))

        assertFalse(report.isUsable)
        assertTrue(report.errors.any { it.contains("비어") })
        assertTrue(report.errors.any { it.contains("없습니다") })
    }

    @Test
    fun `warns with exact pages that have no elements`() {
        val startedAt = Instant.now().minusSeconds(1)
        val markdown = tempDir.resolve("result.md").toFile().apply { writeText("body") }
        val json = tempDir.resolve("result.json").toFile().apply {
            writeText("""{"number of pages":4,"kids":[{"page number":1},{"page number":3}]}""")
        }

        val report = ConversionQualityValidator.validate(markdown, json, startedAt)

        assertTrue(report.isUsable)
        assertTrue(report.hasWarnings)
        assertTrue(report.emptyPages == setOf(2, 4))
    }

    @Test
    fun `rejects stale artifacts`() {
        val markdown = tempDir.resolve("result.md").toFile().apply { writeText("old") }
        val json = tempDir.resolve("result.json").toFile().apply {
            writeText("""{"number of pages":1,"kids":[{"page number":1}]}""")
        }
        val startedAt = Instant.now().plusSeconds(1)

        val report = ConversionQualityValidator.validate(markdown, json, startedAt)

        assertFalse(report.isUsable)
        assertTrue(report.errors.count { it.contains("오래되었습니다") } == 2)
    }
}
