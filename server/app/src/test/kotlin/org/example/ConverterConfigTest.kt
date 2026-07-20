package org.example

import org.example.models.ConvertRequest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.opendataloader.pdf.api.Config

class ConverterConfigTest {
    @Test
    fun `auto uses structure tree with xycut fallback and truthful filter defaults`() {
        val config = Converter.buildConfig(ConvertRequest(filePath = "/tmp/a.pdf"), "/tmp")

        assertTrue(config.isUseStructTree)
        assertEquals(Config.READING_ORDER_XYCUT, config.readingOrder)
        assertFalse(config.isIncludeHeaderFooter)
        assertFalse(config.isKeepLineBreaks)
        assertFalse(config.filterConfig.isFilterHiddenText)
        assertTrue(config.filterConfig.isFilterOutOfPage)
        assertTrue(config.filterConfig.isFilterTinyText)
        assertTrue(config.filterConfig.isFilterHiddenOCG)
    }

    @Test
    fun `explicit strategies and preservation options map to config`() {
        val structTree = Converter.buildConfig(ConvertRequest("/tmp/a.pdf", readingOrder = "STRUCT_TREE"), "/tmp")
        assertTrue(structTree.isUseStructTree)
        assertEquals(Config.READING_ORDER_OFF, structTree.readingOrder)

        val xyCut = Converter.buildConfig(
            ConvertRequest(
                "/tmp/a.pdf", readingOrder = "XY_CUT", includeHeaderFooter = true,
                keepLineBreaks = true, filterHiddenText = true, filterOutOfPage = false,
                filterTinyText = false, filterHiddenOcg = false
            ), "/tmp"
        )
        assertFalse(xyCut.isUseStructTree)
        assertEquals(Config.READING_ORDER_XYCUT, xyCut.readingOrder)
        assertTrue(xyCut.isIncludeHeaderFooter)
        assertTrue(xyCut.isKeepLineBreaks)
        assertTrue(xyCut.filterConfig.isFilterHiddenText)
        assertFalse(xyCut.filterConfig.isFilterOutOfPage)
        assertFalse(xyCut.filterConfig.isFilterTinyText)
        assertFalse(xyCut.filterConfig.isFilterHiddenOCG)
    }

    @Test
    fun `unknown mode and reading order are rejected`() {
        assertThrows(IllegalArgumentException::class.java) { ConvertRequest("a", mode = "magic").validatedMode() }
        assertThrows(IllegalArgumentException::class.java) { ConvertRequest("a", readingOrder = "magic").validatedReadingOrder() }
    }
}
