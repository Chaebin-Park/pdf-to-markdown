package org.example

import org.example.models.ConvertMode
import org.example.models.ConvertRequest
import org.example.models.JobResult
import org.example.models.JobStatus
import org.example.models.ProgressEvent
import org.example.models.ReadingOrderStrategy
import org.opendataloader.pdf.api.Config
import org.opendataloader.pdf.api.OpenDataLoaderPDF
import org.opendataloader.pdf.hybrid.HybridConfig
import org.slf4j.LoggerFactory
import java.io.File
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.FileTime
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ensureActive
import kotlin.coroutines.coroutineContext

/**
 * opendataloader-pdf-core 를 래핑하는 변환기.
 *
 * JVM 상주 구조(ADR-002)에 따라 [OpenDataLoaderPDF.shutdown]은
 * 앱 종료 시 [App.kt]에서 한 번만 호출한다. 이 클래스에서는 호출하지 않는다.
 */
object Converter {
    /** 변환 실패의 전체 스택 트레이스를 파일 로그에 기록한다. */
    private val logger = LoggerFactory.getLogger(Converter::class.java)
    private val managedResultRoot = Path.of(System.getProperty("java.io.tmpdir"), "opendataloader-results")
        .toAbsolutePath().normalize()
    private val managedInputRoot = Path.of(System.getProperty("java.io.tmpdir"), "opendataloader-inputs")
        .toAbsolutePath().normalize()
    private val workspaces = ConcurrentHashMap<String, Path>()

    /**
     * PDF 파일을 변환하고 진행 상황을 SSE 채널로 전송한다.
     *
     * @param jobId 진행 상황을 전송할 대상 job 식별자
     * @param request 변환 요청 데이터 ([ConvertRequest])
     */
    suspend fun convert(
        jobId: String,
        request: ConvertRequest,
        processor: (String, Config) -> Unit = OpenDataLoaderPDF::processFile
    ) {
        val outputDir = jobOutputDirectory(jobId, request.outputDir)
        resetOutputDirectory(outputDir)
        workspaces[jobId] = outputDir

        val mode = request.validatedMode()

        JobManager.markRunning(jobId)
        JobManager.sendProgress(jobId, ProgressEvent(step = 1, label = "페이지 분석 중", percent = 10))

        val config = buildConfig(request, outputDir.toString())
        val startedAt = FileTime.fromMillis(System.currentTimeMillis())

        try {
            JobManager.sendProgress(jobId, ProgressEvent(step = 2, label = "변환 중", percent = 40))
            processor(request.filePath, config)
            coroutineContext.ensureActive()
            val artifacts = validateArtifacts(request.filePath, outputDir, startedAt)
            JobManager.sendProgress(jobId, ProgressEvent(step = 3, label = "완료", percent = 100))
            JobManager.markDone(
                jobId,
                JobResult(
                    jobId = jobId,
                    status = JobStatus.DONE.name,
                    markdownPath = artifacts.markdown.toString(),
                    jsonPath = artifacts.json.toString()
                )
            )
        } catch (e: CancellationException) {
            JobManager.cancelJob(jobId)
            cleanup(jobId)
            throw e
        } catch (e: Throwable) {
            logger.error(
                "PDF 변환 실패: jobId={}, mode={}, filePath={}",
                jobId,
                mode,
                request.filePath,
                e
            )
            JobManager.markError(
                jobId = jobId,
                errorMessage = e.message ?: "변환 중 알 수 없는 오류 발생",
                errorDetail = e.stackTraceToString()
                    .lineSequence()
                    .take(6)
                    .joinToString("\n")
            )
            cleanup(jobId)
        } finally {
            cleanupManagedInput(request.filePath)
        }
    }

    internal data class Artifacts(val markdown: Path, val json: Path)

    internal fun jobOutputDirectory(jobId: String, requestedRoot: String?): Path {
        val root = requestedRoot?.let(Path::of) ?: managedResultRoot
        return root.toAbsolutePath().normalize().resolve(jobId).normalize()
    }

    internal fun validateArtifacts(inputPath: String, outputDir: Path, startedAt: FileTime): Artifacts {
        val basename = File(inputPath).nameWithoutExtension
        val markdown = outputDir.resolve("$basename.md")
        val json = outputDir.resolve("$basename.json")
        listOf(markdown, json).forEach { artifact ->
            require(Files.isRegularFile(artifact)) { "변환 산출물 없음: $artifact" }
            require(Files.size(artifact) > 0L) { "변환 산출물이 비어 있음: $artifact" }
            require(Files.getLastModifiedTime(artifact) >= startedAt) {
                "변환 이전의 오래된 산출물 감지: $artifact"
            }
        }
        return Artifacts(markdown, json)
    }

    private fun resetOutputDirectory(outputDir: Path) {
        deleteRecursively(outputDir)
        Files.createDirectories(outputDir)
    }

    fun cleanup(jobId: String) {
        workspaces.remove(jobId)?.let(::deleteRecursively)
    }

    private fun cleanupManagedInput(inputPath: String) {
        val path = Path.of(inputPath).toAbsolutePath().normalize()
        if (path.startsWith(managedInputRoot)) path.parent?.let(::deleteRecursively)
    }

    private fun deleteRecursively(path: Path) {
        if (!Files.exists(path)) return
        Files.walk(path).use { paths ->
            paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) }
        }
    }

    /**
     * 변환 모드에 따라 [Config]를 구성한다.
     *
     * AI Safety 필터(ADR-003)는 [FilterConfig] 기본값으로 모두 활성화되어 있으므로 별도 설정하지 않는다.
     *
     * OCR / FORMULA 모드는 Java API에 `forceOcr`, `enrichFormula` 플래그가 없으므로
     * Docling 하이브리드 백엔드를 `full` 모드로 실행하여 모든 페이지를 AI로 처리한다.
     * (Python CLI 전용 플래그는 Java API에서 [HybridConfig.mode] = [HybridConfig.MODE_FULL] 로 대체)
     *
     * @param mode 변환 모드
     * @param outputDir 결과 파일 저장 경로
     * @return 모드에 맞게 설정된 [Config]
     */
    internal fun buildConfig(request: ConvertRequest, outputDir: String): Config =
        Config().apply {
            outputFolder = outputDir
            isGenerateMarkdown = true
            isGenerateJSON = true
            // 10-1: 경계선 없는 표(borderless table) 감지를 위해 cluster 방식 사용
            tableMethod = Config.TABLE_METHOD_CLUSTER
            isIncludeHeaderFooter = request.includeHeaderFooter
            isKeepLineBreaks = request.keepLineBreaks
            when (request.validatedReadingOrder()) {
                ReadingOrderStrategy.AUTO -> {
                    isUseStructTree = true
                    readingOrder = Config.READING_ORDER_XYCUT
                }
                ReadingOrderStrategy.STRUCT_TREE -> {
                    isUseStructTree = true
                    readingOrder = Config.READING_ORDER_OFF
                }
                ReadingOrderStrategy.XY_CUT -> {
                    isUseStructTree = false
                    readingOrder = Config.READING_ORDER_XYCUT
                }
            }
            filterConfig.apply {
                isFilterHiddenText = request.filterHiddenText
                isFilterOutOfPage = request.filterOutOfPage
                isFilterTinyText = request.filterTinyText
                isFilterHiddenOCG = request.filterHiddenOcg
            }
            val mode = request.validatedMode()
            when (mode) {
                ConvertMode.HYBRID -> {
                    hybrid = Config.HYBRID_DOCLING_FAST
                }
                ConvertMode.HYBRID_FULL -> {
                    // 10-2: 모든 페이지를 AI로 처리 — 표 정확도 0.489 → 0.928
                    hybrid = Config.HYBRID_DOCLING_FAST
                    hybridConfig.mode = HybridConfig.MODE_FULL
                }
                ConvertMode.OCR, ConvertMode.FORMULA -> {
                    hybrid = Config.HYBRID_DOCLING_FAST
                    hybridConfig.mode = HybridConfig.MODE_FULL
                }
                ConvertMode.STANDARD -> { /* Java 파서만 실행 */ }
            }
        }
}
