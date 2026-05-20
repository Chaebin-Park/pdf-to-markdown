/**
 * tauri-bridge.ts
 *
 * Tauri 백엔드와의 모든 통신(invoke + event listen)을 캡슐화한다.
 * 컴포넌트는 이 모듈만 import하고 @tauri-apps/api를 직접 사용하지 않는다.
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
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

/** Docling 서버 포트를 반환한다. 미기동 시 null. */
export function getDoclingPort(): Promise<number | null> {
  return invoke<number | null>("get_docling_port");
}

/** Hybrid 모드(docling-serve) 설치 여부를 확인한다. */
export function checkHybridInstalled(): Promise<boolean> {
  return invoke<boolean>("check_hybrid_installed");
}

/**
 * Hybrid 모드를 설치한다.
 * 진행률은 `hybrid-install-progress` / `hybrid-install-log` 이벤트로 수신한다.
 */
export function installHybrid(): Promise<void> {
  return invoke<void>("install_hybrid");
}

/** Docling 서버를 기동한다. 준비 완료 시 `docling-ready` 이벤트가 발행된다. */
export function startDoclingServe(): Promise<void> {
  return invoke<void>("start_docling_serve");
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
