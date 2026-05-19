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

import { saveTempPdf, readTextFile } from "./tauri-bridge";
import { inlineImages } from "./image-inliner";
import { serverBaseUrl } from "./main";

// ---------------------------------------------------------------------------
// Types (mirrors Kotlin Models.kt)
// ---------------------------------------------------------------------------

export type ConvertMode = "STANDARD" | "HYBRID" | "OCR" | "FORMULA";

interface ConvertResponse {
  jobId: string;
}

interface ProgressEvent {
  step: number;
  label: string;
  percent: number;
  eta: number | null;
}

interface JobResult {
  jobId: string;
  status: "PENDING" | "RUNNING" | "DONE" | "ERROR";
  markdownPath: string | null;
  jsonPath: string | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

export interface ConversionCallbacks {
  /** 진행률 업데이트 (0–100) */
  onProgress: (event: ProgressEvent) => void;
  /** 변환 완료 — Markdown 문자열 전달 */
  onComplete: (markdown: string, jsonPath: string | null) => void;
  /** 오류 발생 */
  onError: (message: string) => void;
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
  callbacks: ConversionCallbacks,
): Promise<void> {
  const base = serverBaseUrl;
  if (!base) {
    callbacks.onError("서버가 아직 준비되지 않았습니다.");
    return;
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
      body: JSON.stringify({ filePath, mode }),
    });
    if (!res.ok) {
      callbacks.onError(`변환 요청 실패: HTTP ${res.status}`);
      return;
    }
    const data: ConvertResponse = await res.json();
    jobId = data.jobId;
  } catch (e) {
    callbacks.onError(`변환 요청 오류: ${e}`);
    return;
  }

  // 3. SSE 진행률 수신
  await listenProgress(base, jobId, callbacks.onProgress);

  // 4. 결과 조회
  let result: JobResult;
  try {
    const res = await fetch(`${base}/result/${jobId}`);
    if (!res.ok) {
      callbacks.onError(`결과 조회 실패: HTTP ${res.status}`);
      return;
    }
    result = await res.json();
  } catch (e) {
    callbacks.onError(`결과 조회 오류: ${e}`);
    return;
  }

  if (result.status === "ERROR" || !result.markdownPath) {
    callbacks.onError(result.error ?? "알 수 없는 변환 오류가 발생했습니다.");
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

  callbacks.onComplete(markdown, result.jsonPath ?? null);
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
    const es = new EventSource(`${base}/progress/${jobId}`);

    es.onmessage = (event) => {
      try {
        const data: ProgressEvent = JSON.parse(event.data);
        onProgress(data);
      } catch {
        // JSON 파싱 실패는 무시
      }
    };

    es.onerror = () => {
      // 서버가 스트림을 닫으면 onerror가 발생한다 (정상 종료 포함)
      es.close();
      resolve();
    };
  });
}
