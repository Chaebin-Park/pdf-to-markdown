/**
 * tauri-bridge.ts
 *
 * Tauri 백엔드와의 모든 통신(invoke + event listen)을 캡슐화한다.
 * 컴포넌트는 이 모듈만 import하고 @tauri-apps/api를 직접 사용하지 않는다.
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

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

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** Ktor 서버 준비 완료. 페이로드: 포트 번호. */
export function onServerReady(cb: (port: number) => void): Promise<UnlistenFn> {
  return listen<number>("server-ready", (e) => cb(e.payload));
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
