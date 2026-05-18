/**
 * settings.ts
 *
 * 앱 설정 모달.
 * 현재 설정 항목:
 *   - Hybrid 모드 (docling-serve) 설치 상태 확인 및 설치 트리거
 */

import {
  checkHybridInstalled,
  installHybrid,
  onInstallProgress,
  onInstallLog,
  startDoclingServe,
  onDoclingReady,
  type InstallProgress,
} from "./tauri-bridge";
import { setDoclingReady } from "./docling-state";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** 설정 모달을 연다. */
export async function showSettings(): Promise<void> {
  if (document.getElementById("settings-modal")) return;

  const installed = await checkHybridInstalled();
  renderModal(installed);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderModal(installed: boolean): void {
  const modal = document.createElement("div");
  modal.id = "settings-modal";
  modal.className = "settings-backdrop";
  modal.innerHTML = `
    <div class="settings-card" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div class="settings-header">
        <h2 class="settings-title" id="settings-title">설정</h2>
        <button class="settings-close-btn" id="settings-close-btn" aria-label="닫기">✕</button>
      </div>

      <section class="settings-section">
        <div class="settings-section-header">
          <span class="settings-section-title">Hybrid 모드</span>
          <span class="settings-badge ${installed ? "badge-on" : "badge-off"}" id="hybrid-badge">
            ${installed ? "설치됨" : "미설치"}
          </span>
        </div>
        <p class="settings-section-desc">
          AI 기반 레이아웃 분석 엔진(docling-serve)을 활성화합니다.
          Hybrid · OCR · Formula 변환 모드에 필요합니다.
          최초 설치 시 Python 환경과 패키지를 다운로드합니다 (약 1~2GB).
        </p>

        <div class="settings-install-area" id="settings-install-area">
          ${installed ? renderInstalledState() : renderInstallButton()}
        </div>

        <!-- 설치 진행 영역 (설치 중일 때 표시) -->
        <div class="settings-progress-area" id="settings-progress-area" style="display:none">
          <div class="settings-progress-bar-track">
            <div class="settings-progress-bar-fill" id="settings-progress-fill"></div>
          </div>
          <p class="settings-progress-label" id="settings-progress-label"></p>
          <div class="settings-log-box" id="settings-log-box"></div>
        </div>
      </section>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById("settings-close-btn")?.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { closeModal(); document.removeEventListener("keydown", onKey); }
  };
  document.addEventListener("keydown", onKey);

  // 설치 버튼 클릭 핸들러
  document.getElementById("hybrid-install-btn")?.addEventListener("click", () => startInstall());
}

function renderInstallButton(): string {
  return `<button class="settings-install-btn" id="hybrid-install-btn">설치 시작</button>`;
}

function renderInstalledState(): string {
  return `<span class="settings-installed-text">✓ Hybrid 모드가 활성화되어 있습니다.</span>`;
}

function closeModal(): void {
  const modal = document.getElementById("settings-modal");
  if (!modal) return;
  modal.classList.add("settings-closing");
  setTimeout(() => modal.remove(), 200);
}

// ---------------------------------------------------------------------------
// Install flow
// ---------------------------------------------------------------------------

async function startInstall(): Promise<void> {
  const installBtn = document.getElementById("hybrid-install-btn") as HTMLButtonElement | null;
  const progressArea = document.getElementById("settings-progress-area") as HTMLElement | null;
  const badge = document.getElementById("hybrid-badge") as HTMLElement | null;

  if (installBtn) {
    installBtn.disabled = true;
    installBtn.textContent = "설치 중…";
  }
  if (progressArea) progressArea.style.display = "block";

  // 진행률 이벤트 구독
  const unlistenProgress = await onInstallProgress(updateProgress);
  const unlistenLog = await onInstallLog(appendLog);

  try {
    await installHybrid();
    // 완료
    unlistenProgress();
    unlistenLog();
    await markInstallComplete(badge);
  } catch (e) {
    unlistenProgress();
    unlistenLog();
    markInstallError(String(e));
  }
}

function updateProgress(progress: InstallProgress): void {
  const fill = document.getElementById("settings-progress-fill") as HTMLElement | null;
  const label = document.getElementById("settings-progress-label") as HTMLElement | null;
  if (fill) fill.style.width = `${progress.percent}%`;
  if (label) label.textContent = `[${progress.step}/3] ${progress.message}`;
}

function appendLog(line: string): void {
  const logBox = document.getElementById("settings-log-box");
  if (!logBox) return;
  const entry = document.createElement("div");
  entry.className = "settings-log-line";
  entry.textContent = line;
  logBox.appendChild(entry);
  logBox.scrollTop = logBox.scrollHeight;
}

async function markInstallComplete(badge: HTMLElement | null): Promise<void> {
  if (badge) {
    badge.className = "settings-badge badge-on";
    badge.textContent = "설치됨";
  }
  const installArea = document.getElementById("settings-install-area");
  if (installArea) installArea.innerHTML = renderInstalledState();
  const label = document.getElementById("settings-progress-label");
  if (label) label.textContent = "설치 완료 ✓";

  try {
    const unlisten = await onDoclingReady(() => {
      setDoclingReady(true);
      unlisten();
    });
    await startDoclingServe();
  } catch (e) {
    console.warn("[docling] 설치 후 자동 시작 실패:", e);
  }
}

function markInstallError(message: string): void {
  const label = document.getElementById("settings-progress-label");
  if (label) {
    label.textContent = `오류: ${message}`;
    label.style.color = "#f48771";
  }
  const installBtn = document.getElementById("hybrid-install-btn") as HTMLButtonElement | null;
  if (installBtn) {
    installBtn.disabled = false;
    installBtn.textContent = "재시도";
  }
}
