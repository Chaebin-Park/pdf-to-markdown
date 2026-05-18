package org.example

import org.example.models.ConvertMode
import org.example.models.ConvertRequest
import org.example.models.JobResult
import org.example.models.JobStatus
import org.example.models.ProgressEvent
import org.opendataloader.pdf.api.Config
import org.opendataloader.pdf.api.OpenDataLoaderPDF
import org.opendataloader.pdf.hybrid.HybridConfig
import java.io.File

/**
 * opendataloader-pdf-core 를 래핑하는 변환기.
 *
 * JVM 상주 구조(ADR-002)에 따라 [OpenDataLoaderPDF.shutdown]은
 * 앱 종료 시 [App.kt]에서 한 번만 호출한다. 이 클래스에서는 호출하지 않는다.
 */
object Converter {

    /**
     * PDF 파일을 변환하고 진행 상황을 SSE 채널로 전송한다.
     *
     * @param jobId 진행 상황을 전송할 대상 job 식별자
     * @param request 변환 요청 데이터 ([ConvertRequest])
     */
    suspend fun convert(jobId: String, request: ConvertRequest) {
        val outputDir = request.outputDir
            ?: File(request.filePath).parent
            ?: "."

        val mode = runCatching { ConvertMode.valueOf(request.mode) }
            .getOrDefault(ConvertMode.STANDARD)

        JobManager.markRunning(jobId)
        JobManager.sendProgress(jobId, ProgressEvent(step = 1, label = "페이지 분석 중", percent = 10))

        val config = buildConfig(mode, outputDir)

        runCatching {
            JobManager.sendProgress(jobId, ProgressEvent(step = 2, label = "변환 중", percent = 40))
            OpenDataLoaderPDF.processFile(request.filePath, config)
        }.onSuccess {
            JobManager.sendProgress(jobId, ProgressEvent(step = 3, label = "완료", percent = 100))
            JobManager.markDone(
                jobId,
                JobResult(
                    jobId = jobId,
                    status = JobStatus.DONE.name,
                    markdownPath = "$outputDir/${File(request.filePath).nameWithoutExtension}.md",
                    jsonPath = "$outputDir/${File(request.filePath).nameWithoutExtension}.json"
                )
            )
        }.onFailure { e ->
            JobManager.markError(jobId, e.message ?: "변환 중 알 수 없는 오류 발생")
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
    private fun buildConfig(mode: ConvertMode, outputDir: String): Config =
        Config().apply {
            outputFolder = outputDir
            isGenerateMarkdown = true
            isGenerateJSON = true
            when (mode) {
                ConvertMode.HYBRID -> {
                    hybrid = Config.HYBRID_DOCLING_FAST
                }
                ConvertMode.OCR, ConvertMode.FORMULA -> {
                    hybrid = Config.HYBRID_DOCLING_FAST
                    hybridConfig.mode = HybridConfig.MODE_FULL
                }
                ConvertMode.STANDARD -> { /* 기본값 사용 — Java 파서만 실행 */ }
            }
        }
}
