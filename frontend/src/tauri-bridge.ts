/**
 * tauri-bridge.ts
 *
 * Tauri 백엔드와의 모든 통신(invoke + event listen)을 캡슐화한다.
 * 컴포넌트는 이 모듈만 import하고 @tauri-apps/api를 직접 사용하지 않는다.
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { save, open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** install_hybrid 진행 상황 이벤트 페이로드 */
export interface InstallProgress {
  step: number;
  message: string;
  percent: number;
}

export type DoclingProfile = "hybrid" | "ocr" | "formula";

export interface HybridDiagnostics {
  installed: boolean;
  expectedVersion: string;
  installedVersion: string | null;
  runningProfile: DoclingProfile | null;
  port: number | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Ktor 서버 포트를 반환한다.
 * 서버가 아직 기동되지 않았으면 null을 반환하므로
 * 호출 전에 `server-ready` 이벤트를 수신했는지 확인해야 한다.
 */
export function getServerPort(): Promise<number | null> {
  return invoke<number | null>("get_server_port");
}

/**
 * 마지막 Ktor 서버 시작 실패 메시지를 반환한다.
 *
 * JVM 실행 오류가 WebView 이벤트 구독보다 먼저 발생한 경우에도
 * 초기 실패 화면을 표시하기 위해 사용한다.
 */
export function getServerError(): Promise<string | null> {
  return invoke<string | null>("get_server_error");
}

/** Docling 서버 포트를 반환한다. 미기동 시 null. */
export function getDoclingPort(): Promise<number | null> {
  return invoke<number | null>("get_docling_port");
}

/** Hybrid 모드(docling-serve) 설치 여부를 확인한다. */
export function checkHybridInstalled(): Promise<boolean> {
  return invoke<boolean>("check_hybrid_installed");
}

/** 설치 버전, 실행 프로필, 포트와 마지막 오류를 반환한다. */
export function getHybridDiagnostics(): Promise<HybridDiagnostics> {
  return invoke<HybridDiagnostics>("get_hybrid_diagnostics");
}

/**
 * Hybrid 모드를 설치한다.
 * 진행률은 `hybrid-install-progress` / `hybrid-install-log` 이벤트로 수신한다.
 */
export function installHybrid(): Promise<void> {
  return invoke<void>("install_hybrid");
}

/** Docling 서버를 기동한다. 준비 완료 시 `docling-ready` 이벤트가 발행된다. */
export function startDoclingServe(profile: DoclingProfile = "hybrid"): Promise<void> {
  return invoke<void>("start_docling_serve", { profile });
}

/** 하이브리드 모드 환경(venv + 플래그 파일)을 삭제하고 docling-serve를 종료한다. */
export function uninstallHybrid(): Promise<void> {
  return invoke<void>("uninstall_hybrid");
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** Ktor 서버 준비 완료. 페이로드: 포트 번호. */
export function onServerReady(cb: (port: number) => void): Promise<UnlistenFn> {
  return listen<number>("server-ready", (e) => cb(e.payload));
}

/** Ktor 서버 시작 실패. 페이로드: 에러 메시지. */
export function onServerError(cb: (message: string) => void): Promise<UnlistenFn> {
  return listen<string>("server-error", (e) => cb(e.payload));
}

/** Docling 서버 준비 완료. 페이로드: 포트 번호. */
export function onDoclingReady(cb: (port: number) => void): Promise<UnlistenFn> {
  return listen<number>("docling-ready", (e) => cb(e.payload));
}

/** Hybrid 설치 진행률. */
export function onInstallProgress(
  cb: (progress: InstallProgress) => void
): Promise<UnlistenFn> {
  return listen<InstallProgress>("hybrid-install-progress", (e) => cb(e.payload));
}

/** Hybrid 설치 로그 라인. */
export function onInstallLog(cb: (line: string) => void): Promise<UnlistenFn> {
  return listen<string>("hybrid-install-log", (e) => cb(e.payload));
}

// ---------------------------------------------------------------------------
// File utilities
// ---------------------------------------------------------------------------

/**
 * PDF 바이트 배열을 시스템 임시 디렉터리에 저장하고 절대 경로를 반환한다.
 * Ktor 서버에 filePath를 전달할 때 사용한다.
 */
export function saveTempPdf(data: Uint8Array): Promise<string> {
  return invoke<string>("save_temp_pdf", { data: Array.from(data) });
}

/** 지정 경로의 텍스트 파일 내용을 읽어 반환한다. */
export function readTextFile(path: string): Promise<string> {
  return invoke<string>("read_text_file", { path });
}

/** 지정 경로의 파일을 바이너리로 읽어 Uint8Array로 반환한다. */
export async function readBinaryFile(path: string): Promise<Uint8Array> {
  const bytes = await invoke<number[]>("read_binary_file", { path });
  return new Uint8Array(bytes);
}

/** Rust 부트스트랩 로그와 Ktor server.log가 저장되는 디렉터리를 반환한다. */
export function getLogDir(): Promise<string> {
  return invoke<string>("get_log_dir");
}

/** OS 기본 파일 탐색기로 앱 진단 로그 디렉터리를 연다. */
export function openLogDir(): Promise<void> {
  return invoke<void>("open_log_dir");
}

/**
 * PDF 파일 열기 다이얼로그를 표시하고 선택한 파일을 읽어 반환한다.
 * 취소 시 null을 반환한다.
 */
export async function openPdfFile(): Promise<{ buffer: ArrayBuffer; name: string; path: string } | null> {
  const path = await dialogOpen({
    filters: [{ name: "PDF", extensions: ["pdf"] }],
    multiple: false,
  });
  if (!path || typeof path !== "string") return null;
  const name = path.split(/[\\/]/).pop() ?? path;
  const bytes = await readBinaryFile(path);
  return { buffer: bytes.buffer as ArrayBuffer, name, path };
}

/**
 * 저장 다이얼로그를 열고 사용자가 선택한 경로에 마크다운을 저장한다.
 * 취소 시 null을 반환한다.
 */
export async function saveMarkdownFile(
  content: string,
  defaultName: string
): Promise<string | null> {
  const path = await save({
    defaultPath: defaultName,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!path) return null;
  await writeTextFile(path, content);
  return path;
}
