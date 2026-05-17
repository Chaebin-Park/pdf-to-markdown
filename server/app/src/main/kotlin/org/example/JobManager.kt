package org.example

import kotlinx.coroutines.channels.Channel
import org.example.models.JobResult
import org.example.models.JobStatus
import org.example.models.ProgressEvent
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * 변환 작업의 생명주기를 관리하는 싱글턴 오브젝트.
 *
 * 모든 상태는 인메모리 [ConcurrentHashMap]으로 유지된다.
 * 앱 재시작 시 초기화되며, 동시 요청이 적은 로컬 앱 환경을 가정한다.
 */
object JobManager {

    /** 작업별 진행 상황 SSE 채널. 구독자가 없을 때도 이벤트를 버퍼링한다. */
    private val channels = ConcurrentHashMap<String, Channel<ProgressEvent>>()

    /** 작업별 현재 [JobStatus]. */
    private val statuses = ConcurrentHashMap<String, JobStatus>()

    /** 작업 완료 후 저장되는 최종 결과. */
    private val results = ConcurrentHashMap<String, JobResult>()

    /**
     * 새 작업을 등록하고 고유 jobId를 반환한다.
     *
     * 초기 상태는 [JobStatus.PENDING]이며, 용량 64의 SSE 채널이 생성된다.
     *
     * @return 새로 발급된 jobId (UUID v4 문자열)
     */
    fun createJob(): String {
        val jobId = UUID.randomUUID().toString()
        statuses[jobId] = JobStatus.PENDING
        channels[jobId] = Channel(capacity = 64)
        return jobId
    }

    /**
     * 지정한 작업의 상태를 [JobStatus.RUNNING]으로 전환한다.
     *
     * @param jobId 대상 작업 식별자
     */
    fun markRunning(jobId: String) {
        statuses[jobId] = JobStatus.RUNNING
    }

    /**
     * SSE 채널에 진행 상황 이벤트를 전송한다.
     *
     * 채널이 존재하지 않으면 아무 작업도 하지 않는다.
     *
     * @param jobId 대상 작업 식별자
     * @param event 전송할 [ProgressEvent]
     */
    suspend fun sendProgress(jobId: String, event: ProgressEvent) {
        channels[jobId]?.send(event)
    }

    /**
     * 작업을 완료 상태([JobStatus.DONE])로 전환하고 결과를 저장한다.
     *
     * 완료 후 SSE 채널을 닫아 구독자가 스트림 종료를 감지할 수 있게 한다.
     *
     * @param jobId 대상 작업 식별자
     * @param result 저장할 [JobResult]
     */
    fun markDone(jobId: String, result: JobResult) {
        statuses[jobId] = JobStatus.DONE
        results[jobId] = result
        channels[jobId]?.close()
    }

    /**
     * 작업을 오류 상태([JobStatus.ERROR])로 전환하고 에러 결과를 저장한다.
     *
     * @param jobId 대상 작업 식별자
     * @param errorMessage 오류 메시지
     */
    fun markError(jobId: String, errorMessage: String) {
        statuses[jobId] = JobStatus.ERROR
        results[jobId] = JobResult(jobId = jobId, status = JobStatus.ERROR.name, error = errorMessage)
        channels[jobId]?.close()
    }

    /**
     * 지정한 작업의 SSE 채널을 반환한다.
     *
     * @param jobId 대상 작업 식별자
     * @return 채널. 존재하지 않으면 null
     */
    fun getChannel(jobId: String): Channel<ProgressEvent>? = channels[jobId]

    /**
     * 지정한 작업의 최종 결과를 반환한다.
     *
     * 작업이 완료([JobStatus.DONE] 또는 [JobStatus.ERROR])되기 전에는 null을 반환한다.
     *
     * @param jobId 대상 작업 식별자
     * @return [JobResult]. 미완료이면 null
     */
    fun getResult(jobId: String): JobResult? = results[jobId]

    /**
     * 지정한 작업의 현재 상태를 반환한다.
     *
     * @param jobId 대상 작업 식별자
     * @return [JobStatus]. 존재하지 않는 jobId이면 null
     */
    fun getStatus(jobId: String): JobStatus? = statuses[jobId]
}
