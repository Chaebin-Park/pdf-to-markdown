/**
 * converter.ts
 *
 * PDF → Markdown 변환 전체 플로우를 담당한다.
 *
 * 플로우:
 *   1. saveTempPdf()  — ArrayBuffer를 임시 파일로 저장 → filePath 획득
 *   2. POST /convert  — filePath + mode 전송 → jobId 획득
 *   3. GET /progress/{jobId} (SSE) — ProgressEvent 수신 → 진행률 콜백
 *   4. GET /result/{jobId}   — JobResult 획득 → markdownPath
 *   5. readTextFile()  — markdownPath 읽어 Markdown 문자열 반환
 */

import { saveTempPdf, readTextFile, startDoclingServe, type DoclingProfile } from "./tauri-bridge";
import { inlineImages } from "./image-inliner";
import { serverBaseUrl } from "./main";
import {
  pollConversionResult,
  type JobResult,
  type ProgressEvent,
} from "./result-polling";
import { conversionRequestBody, type ConversionQualityOptions } from "./conversion-options";

// ---------------------------------------------------------------------------
// Types (mirrors Kotlin Models.kt)
// ---------------------------------------------------------------------------

export type ConvertMode = "STANDARD" | "HYBRID" | "HYBRID_FULL" | "OCR" | "FORMULA";

interface ConvertResponse {
  jobId: string;
}

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

export interface ConversionCallbacks {
  /** 진행률 업데이트 (0–100) */
  onProgress: (event: ProgressEvent) => void;
  /** 변환 완료 — Markdown 문자열 전달 */
  onComplete: (markdown: string, jsonPath: string | null) => void | Promise<void>;
  /** 오류 발생 */
  onError: (message: string, detail?: string | null) => void;
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

let activeEventSource: EventSource | null = null;
let activeJob: { base: string; jobId: string } | null = null;
let activeProgressResolve: (() => void) | null = null;
let conversionCancelled = false;

/** 진행 중인 변환을 취소한다. SSE 연결을 닫고 이후 단계를 건너뛴다. */
export function cancelConversion(): void {
  conversionCancelled = true;
  activeEventSource?.close();
  activeEventSource = null;
  activeProgressResolve?.();
  activeProgressResolve = null;
  if (activeJob) {
    void fetch(`${activeJob.base}/jobs/${activeJob.jobId}`, { method: "DELETE" });
    activeJob = null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * PDF를 변환한다.
 *
 * @param pdfBuffer 프론트엔드에서 로드한 PDF ArrayBuffer
 * @param mode      변환 모드
 * @param callbacks 진행률/완료/오류 콜백
 */
export async function convertPdf(
  pdfBuffer: ArrayBuffer,
  mode: ConvertMode,
  options: ConversionQualityOptions,
  callbacks: ConversionCallbacks,
): Promise<void> {
  conversionCancelled = false;

  const base = serverBaseUrl;
  if (!base) {
    callbacks.onError("서버가 아직 준비되지 않았습니다.");
    return;
  }

  const profileByMode: Partial<Record<ConvertMode, DoclingProfile>> = {
    HYBRID: "hybrid",
    HYBRID_FULL: "hybrid",
    OCR: "ocr",
    FORMULA: "formula",
  };
  const profile = profileByMode[mode];
  if (profile) {
    try {
      await startDoclingServe(profile);
    } catch (e) {
      callbacks.onError(`Hybrid ${profile} 프로필 시작 실패: ${e}`);
      return;
    }
  }

  // 1. 임시 파일 저장
  let filePath: string;
  try {
    filePath = await saveTempPdf(new Uint8Array(pdfBuffer));
  } catch (e) {
    callbacks.onError(`PDF 임시 저장 실패: ${e}`);
    return;
  }

  // 2. 변환 요청
  let jobId: string;
  try {
    const res = await fetch(`${base}/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(conversionRequestBody(filePath, mode, options)),
    });
    if (!res.ok) {
      callbacks.onError(`변환 요청 실패: HTTP ${res.status}`);
      return;
    }
    const data: ConvertResponse = await res.json();
    jobId = data.jobId;
    activeJob = { base, jobId };
  } catch (e) {
    callbacks.onError(`변환 요청 오류: ${e}`);
    return;
  }

  // 3. SSE 진행률 수신
  await listenProgress(base, jobId, callbacks.onProgress);

  if (conversionCancelled) return;

  // 4. 결과 조회
  let result: JobResult;
  try {
    result = await pollConversionResult(base, jobId, callbacks.onProgress, {
      isCancelled: () => conversionCancelled,
    });
  } catch (e) {
    if (conversionCancelled) return;
    callbacks.onError(`결과 조회 오류: ${e}`);
    return;
  }

  if (conversionCancelled) return;

  if (result.status === "ERROR" || !result.markdownPath) {
    activeJob = null;
    callbacks.onError(
      result.error ?? "알 수 없는 변환 오류가 발생했습니다.",
      result.errorDetail,
    );
    return;
  }

  // 5. Markdown 파일 읽기
  let markdown: string;
  try {
    markdown = await readTextFile(result.markdownPath);
  } catch (e) {
    callbacks.onError(`Markdown 파일 읽기 실패: ${e}`);
    return;
  }

  // 6. 로컬 이미지 경로 → Base64 인라인 치환 (오프라인 지원)
  try {
    markdown = await inlineImages(markdown, result.markdownPath);
  } catch (e) {
    console.warn("[converter] 이미지 인라인 처리 실패, 원본 마크다운 사용:", e);
  }

  await callbacks.onComplete(markdown, result.jsonPath ?? null);
  activeJob = null;
  void fetch(`${base}/artifacts/${jobId}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// SSE helper
// ---------------------------------------------------------------------------

/**
 * SSE 스트림을 구독하고 ProgressEvent를 콜백으로 전달한다.
 * 스트림이 닫히면 (서버가 연결 종료) Promise가 resolve된다.
 */
function listenProgress(
  base: string,
  jobId: string,
  onProgress: (e: ProgressEvent) => void,
): Promise<void> {
  return new Promise((resolve) => {
    activeProgressResolve = resolve;
    const es = new EventSource(`${base}/progress/${jobId}`);
    activeEventSource = es;

    es.onmessage = (event) => {
      try {
        const data: ProgressEvent = JSON.parse(event.data);
        onProgress(data);
      } catch {
        // JSON 파싱 실패는 무시
      }
    };

    es.onerror = () => {
      // 서버가 스트림을 닫거나 브라우저가 일시 오류를 감지하면 onerror가 발생한다.
      // 이후 /result 폴링에서 최종 DONE/ERROR 상태를 확인한다.
      es.close();
      activeProgressResolve = null;
      resolve();
    };
  });
}
