package org.example

import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.example.models.ConvertRequest
import org.example.models.ConvertResponse
import org.example.models.JobStatus

/**
 * 애플리케이션의 모든 HTTP 라우트를 등록한다.
 *
 * - `POST /convert` — 변환 요청 수신 및 작업 시작
 * - `GET /progress/{jobId}` — SSE 진행 상황 스트림
 * - `GET /result/{jobId}` — 완료된 변환 결과 조회
 * - `GET /health` — 서버 기동 확인용 헬스체크
 */
fun Application.configureRouting() {
    routing {
        get("/health") {
            call.respond(mapOf("status" to "ok"))
        }

        post("/convert") {
            val request = call.receive<ConvertRequest>()
            val jobId = JobManager.createJob()

            // 변환 작업을 별도 코루틴으로 실행하여 즉시 jobId 반환
            launch { runConversion(jobId, request) }

            call.respond(HttpStatusCode.Accepted, ConvertResponse(jobId = jobId))
        }

        get("/progress/{jobId}") {
            val jobId = call.parameters["jobId"]
                ?: return@get call.respond(HttpStatusCode.BadRequest, "jobId required")

            val channel = JobManager.getChannel(jobId)
                ?: return@get call.respond(HttpStatusCode.NotFound, "job not found")

            call.respondTextWriter(contentType = ContentType.Text.EventStream) {
                for (event in channel) {
                    write("data: ${Json.encodeToString(event)}\n\n")
                    flush()
                }
            }
        }

        get("/result/{jobId}") {
            val jobId = call.parameters["jobId"]
                ?: return@get call.respond(HttpStatusCode.BadRequest, "jobId required")

            val status = JobManager.getStatus(jobId)
                ?: return@get call.respond(HttpStatusCode.NotFound, "job not found")

            if (status == JobStatus.PENDING || status == JobStatus.RUNNING) {
                call.respond(HttpStatusCode.Accepted, mapOf("status" to status.name))
                return@get
            }

            val result = JobManager.getResult(jobId)
                ?: return@get call.respond(HttpStatusCode.NotFound, "result not found")

            call.respond(result)
        }
    }
}

/**
 * 실제 변환 작업을 수행한다.
 *
 * [Converter.convert]에 위임하여 opendataloader-pdf-core로 변환을 실행하고
 * 진행 상황을 SSE 채널로 전송한다.
 *
 * @param jobId 대상 작업 식별자
 * @param request 변환 요청 데이터
 */
private suspend fun runConversion(jobId: String, request: ConvertRequest) {
    Converter.convert(jobId, request)
}
