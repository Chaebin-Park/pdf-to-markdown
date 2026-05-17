package org.example.models

import kotlinx.serialization.Serializable

/** PDF 변환 모드. */
enum class ConvertMode { STANDARD, HYBRID, OCR, FORMULA }

/** 변환 작업의 실행 상태. */
enum class JobStatus { PENDING, RUNNING, DONE, ERROR }

/**
 * PDF 변환 요청 본문.
 *
 * @property filePath 변환할 PDF 파일의 절대 경로
 * @property mode 변환 모드 ([ConvertMode] 이름과 일치)
 * @property outputDir 결과 파일 저장 디렉토리. null 이면 원본 파일과 같은 폴더 사용
 */
@Serializable
data class ConvertRequest(
    val filePath: String,
    val mode: String = "STANDARD",
    val outputDir: String? = null
)

/**
 * 변환 요청 수락 응답.
 *
 * @property jobId 진행 상황·결과 조회에 사용할 고유 식별자
 */
@Serializable
data class ConvertResponse(
    val jobId: String
)

/**
 * SSE로 전송되는 진행 상황 이벤트.
 *
 * @property step 현재 단계 번호 (1-based)
 * @property label 단계 설명 문자열
 * @property percent 전체 진행률 (0–100)
 * @property eta 예상 남은 시간(초). 알 수 없으면 null
 */
@Serializable
data class ProgressEvent(
    val step: Int,
    val label: String,
    val percent: Int,
    val eta: Int? = null
)

/**
 * 변환 완료 후 결과 조회 응답.
 *
 * @property jobId 작업 식별자
 * @property status 최종 상태 ([JobStatus] 이름과 일치)
 * @property markdownPath 생성된 Markdown 파일 경로. 실패 시 null
 * @property jsonPath 생성된 JSON(bounding box 포함) 파일 경로. 실패 시 null
 * @property error 오류 메시지. 성공 시 null
 */
@Serializable
data class JobResult(
    val jobId: String,
    val status: String,
    val markdownPath: String? = null,
    val jsonPath: String? = null,
    val error: String? = null
)