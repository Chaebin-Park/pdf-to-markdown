package org.example

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.time.Instant

/** Post-conversion checks that prevent stale or structurally incomplete artifacts from being accepted. */
object ConversionQualityValidator {
    data class Report(
        val errors: List<String>,
        val warnings: List<String>,
        val declaredPages: Int?,
        val observedPages: Set<Int>,
        val emptyPages: Set<Int>
    ) {
        val isUsable: Boolean get() = errors.isEmpty()
        val hasWarnings: Boolean get() = warnings.isNotEmpty()
    }

    fun validate(markdown: File, json: File, conversionStartedAt: Instant): Report {
        val errors = mutableListOf<String>()
        val warnings = mutableListOf<String>()

        validateArtifact(markdown, "Markdown", conversionStartedAt, errors)
        validateArtifact(json, "JSON", conversionStartedAt, errors)
        if (errors.isNotEmpty()) {
            return Report(errors, warnings, null, emptySet(), emptySet())
        }

        val root = runCatching { Json.parseToJsonElement(json.readText()) as? JsonObject }
            .getOrNull()
        if (root == null) {
            errors += "JSON 결과를 파싱할 수 없습니다."
            return Report(errors, warnings, null, emptySet(), emptySet())
        }

        val declaredPages = root.intValue("number of pages") ?: root.intValue("numberOfPages")
        val kids = root["kids"] as? JsonArray ?: JsonArray(emptyList())
        val pageCounts = kids.mapNotNull { element ->
            (element as? JsonObject)?.let { it.intValue("page number") ?: it.intValue("pageNumber") }
        }.groupingBy { it }.eachCount()
        val observedPages = pageCounts.keys.filter { it > 0 }.toSortedSet()

        if (declaredPages == null || declaredPages <= 0) {
            warnings += "JSON에 유효한 전체 페이지 수가 없습니다."
        }
        if (kids.isEmpty()) {
            warnings += "JSON에 변환된 문서 요소가 없습니다."
        }

        val emptyPages = if (declaredPages != null && declaredPages > 0) {
            (1..declaredPages).filterNot(observedPages::contains).toSortedSet()
        } else {
            emptySet()
        }
        if (emptyPages.isNotEmpty()) {
            warnings += "결과 요소가 없는 페이지: ${emptyPages.joinToString(", ")}"
        }
        if (declaredPages != null && observedPages.any { it > declaredPages }) {
            warnings += "전체 페이지 수를 벗어난 페이지 번호가 있습니다."
        }

        return Report(errors, warnings, declaredPages, observedPages, emptyPages)
    }

    private fun validateArtifact(
        file: File,
        label: String,
        conversionStartedAt: Instant,
        errors: MutableList<String>
    ) {
        if (!file.isFile) {
            errors += "$label 결과 파일이 없습니다."
            return
        }
        if (file.length() == 0L) errors += "$label 결과 파일이 비어 있습니다."
        if (file.lastModified() < conversionStartedAt.toEpochMilli()) {
            errors += "$label 결과 파일이 현재 변환보다 오래되었습니다."
        }
    }

    private fun JsonObject.intValue(key: String): Int? = this[key]?.jsonPrimitive?.intOrNull
}
