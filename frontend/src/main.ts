import "./style.css";
import "highlight.js/styles/github-dark.css";
import "katex/dist/katex.min.css";
import {
  getServerPort, getServerError, onServerReady, onServerError, readTextFile,
  checkHybridInstalled, startDoclingServe, onDoclingReady, getDoclingPort,
  getLogDir,
} from "./tauri-bridge";
import { mountLayout, getPanelLeft, getPanelRight } from "./layout";
import { mountPdfViewer, setConvertHandler, setCancelHandler, setConverting, setBBoxAvailable, getSelectedMode, currentPdfBuffer } from "./pdf-viewer";
import { mountMarkdownRenderer, setMarkdown, setStreaming, clearMarkdown } from "./markdown-renderer";
import { convertPdf, cancelConversion } from "./converter";
import { mountProgressBar, updateProgress, hideProgress } from "./progress-bar";
import { parseBBoxJson, toggleBBoxOverlay, getHiddenItems } from "./bbox-overlay";
import { maybeShowOnboarding, showOnboarding } from "./onboarding";
import { showSettings } from "./settings";
import { initTheme } from "./theme";
import { setDoclingReady } from "./docling-state";
import { checkForUpdates } from "./updater";
import { initStatusBar, setStatusMode, setStatusDone, setStatusIdle, setStatusSafety, startJvmPolling } from "./status-bar";
import { mountFilesPanel } from "./files-panel";
import { mountOutlinePanel } from "./outline-panel";
import { mountPagesPanel } from "./pages-panel";
import { mountSearchPanel } from "./search-panel";
import { mountSafetyPanel, updateSafetyPanel } from "./safety-panel";
import { registerPanelContent } from "./activity-rail";

/**
 * Ktor 서버의 base URL. 서버가 준비되면 설정된다.
 * 다른 모듈에서 import해서 사용한다.
 */
export let serverBaseUrl: string | null = null;

// Matches the Rust startup budget: 60s until PORT= plus 30s TCP readiness.
const SERVER_BOOT_TIMEOUT_MS = 90_000;
const SERVER_STATUS_POLL_MS = 1_000;

async function init() {
  initTheme();
  const root = document.querySelector<HTMLDivElement>("#app")!;
  renderLoading(root);

  // docling-serve 자동 시작: Ktor 서버와 병렬로 처리한다.
  initDocling();

  await waitForServer(root);
}

async function waitForServer(root: HTMLDivElement): Promise<void> {
  let settled = false;
  let timeoutId: number | null = null;
  let pollId: number | null = null;
  let unlistenReady: (() => void) | null = null;
  let unlistenError: (() => void) | null = null;

  const cleanup = () => {
    if (timeoutId != null) window.clearTimeout(timeoutId);
    if (pollId != null) window.clearInterval(pollId);
    unlistenReady?.();
    unlistenError?.();
  };

  const showApp = (port: number) => {
    if (settled) return;
    settled = true;
    cleanup();
    serverBaseUrl = `http://localhost:${port}`;
    renderApp(root);
    initStatusBar(port);
    startJvmPolling(serverBaseUrl);
  };

  const showError = (message: string) => {
    if (settled) return;
    settled = true;
    cleanup();
    renderServerError(root, message);
  };

  // 이벤트 유실을 막기 위해 구독을 먼저 설치한 뒤 현재 Rust 상태를 조회한다.
  [unlistenReady, unlistenError] = await Promise.all([
    onServerReady(showApp),
    onServerError(showError),
  ]);
  if (settled) {
    cleanup();
    return;
  }

  const checkServerState = async () => {
    const [port, error] = await Promise.all([getServerPort(), getServerError()]);
    if (port != null) {
      showApp(port);
      return;
    }
    if (error != null) {
      showError(error);
    }
  };

  try {
    await checkServerState();
  } catch (e) {
    showError(`서버 상태 조회 실패: ${String(e)}`);
    return;
  }

  if (settled) return;

  pollId = window.setInterval(() => {
    checkServerState().catch((e) => showError(`서버 상태 조회 실패: ${String(e)}`));
  }, SERVER_STATUS_POLL_MS);

  timeoutId = window.setTimeout(async () => {
    let logHint = "";
    try {
      logHint = `\n로그 디렉토리: ${await getLogDir()}`;
    } catch {
      logHint = "";
    }
    showError(`서버 시작 타임아웃 (${SERVER_BOOT_TIMEOUT_MS / 1000}초).${logHint}`);
  }, SERVER_BOOT_TIMEOUT_MS);
}

/**
 * Hybrid 모드 설치 여부를 확인하고, 설치돼 있으면 docling-serve를 자동 시작한다.
 * Ktor 서버 초기화와 병렬로 실행되므로 await하지 않는다.
 */
async function initDocling(): Promise<void> {
  try {
    // 핫리로드 등으로 이미 기동된 경우 포트가 반환된다.
    const existingPort = await getDoclingPort();
    if (existingPort != null) {
      setDoclingReady(true);
      return;
    }

    const installed = await checkHybridInstalled();
    if (!installed) return;

    // 준비 완료 이벤트를 먼저 구독한 뒤 시작 명령을 보낸다.
    const unlisten = await onDoclingReady(() => {
      setDoclingReady(true);
      unlisten();
    });

    await startDoclingServe();
  } catch (e) {
    // docling 시작 실패는 치명적이지 않으므로 콘솔에만 기록한다.
    console.warn("[docling] 자동 시작 실패:", e);
  }
}

function renderServerError(root: HTMLDivElement, message: string): void {
  const splash = document.createElement("div");
  splash.className = "splash";

  const label = document.createElement("p");
  label.className = "splash-label";
  label.style.color = "#f87171";
  label.textContent = "서버 시작 실패";

  const body = document.createElement("p");
  body.style.fontSize = "12px";
  body.style.color = "#9ca3af";
  body.style.maxWidth = "400px";
  body.style.textAlign = "center";
  body.style.marginTop = "8px";
  body.style.whiteSpace = "pre-wrap";
  body.textContent = message;

  const hint = document.createElement("p");
  hint.style.fontSize = "11px";
  hint.style.color = "#6b7280";
  hint.style.marginTop = "16px";
  hint.textContent = "위 경로의 로그 파일에서 상세 진단 정보를 확인하세요.";

  splash.append(label, body, hint);
  root.replaceChildren(splash);
}

function renderLoading(root: HTMLDivElement): void {
  root.innerHTML = `
    <div class="splash">
      <div class="splash-dots">
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
      </div>
      <p class="splash-label">서버 시작 중…</p>
    </div>
  `;
}

function renderApp(root: HTMLDivElement): void {
  mountLayout(root);
  mountPdfViewer(getPanelLeft());
  mountMarkdownRenderer(getPanelRight());

  // 타이틀바 Open 버튼 → 기존 파일 열기 다이얼로그 위임
  document.getElementById("tb-open-btn")?.addEventListener("click", () => {
    document.getElementById("pdf-open-dialog-btn")?.click();
  });

  // 진행률 바는 레이아웃 컨테이너에 마운트 (두 패널 위에 오버레이)
  const layoutEl = root.querySelector<HTMLElement>(".layout")!;
  mountProgressBar(layoutEl);

  // Activity Rail 패널 콘텐츠 등록
  registerPanelContent("files", mountFilesPanel);
  registerPanelContent("pages", mountPagesPanel);
  registerPanelContent("outline", mountOutlinePanel);
  registerPanelContent("search", mountSearchPanel);
  registerPanelContent("safety", mountSafetyPanel);

  // Rail 하단 버튼 핸들러 직접 등록 (md-help-btn/md-settings-btn 제거 후 대체)
  document.getElementById("rail-help")?.addEventListener("click", () => showOnboarding());
  document.getElementById("rail-settings")?.addEventListener("click", () => showSettings());

  // 최초 실행 시 온보딩 모달 표시
  maybeShowOnboarding();
  checkForUpdates();
  registerKeyboardShortcuts();

  document.getElementById("pdf-mode-select")?.addEventListener("change", (e) => {
    setStatusMode((e.target as HTMLSelectElement).value);
  });

  setCancelHandler(() => {
    cancelConversion();
    hideProgress();
    setStreaming(false);
    setConverting(false);
    setStatusIdle();
  });

  setConvertHandler(async () => {
    const buffer = currentPdfBuffer;
    if (!buffer) return;

    setConverting(true);
    clearMarkdown();
    setStreaming(true);

    const mode = getSelectedMode() as Parameters<typeof convertPdf>[1];
    let conversionStartTime = Date.now();
    setStatusMode(mode);
    setStatusIdle();
    await convertPdf(buffer, mode, {
      onProgress: (event) => {
        updateProgress({ percent: event.percent, label: event.label, eta: event.eta });
      },
      onComplete: (markdown, jsonPath) => {
        hideProgress();
        setStreaming(false);
        setMarkdown(markdown);
        setConverting(false);
        const pagesText = document.getElementById("pdf-pagecount")?.textContent ?? "";
        const totalPages = parseInt(pagesText, 10) || 0;
        setStatusDone(totalPages, Date.now() - conversionStartTime);
        // bbox JSON이 있으면 파싱 후 토글 버튼 활성화 + safety 패널 갱신
        if (jsonPath) {
          readTextFile(jsonPath).then((json) => {
            parseBBoxJson(json);
            setBBoxAvailable(true, () => toggleBBoxOverlay());
            const hiddenCount = getHiddenItems().length;
            setStatusSafety(hiddenCount);
            updateSafetyPanel();
          }).catch(() => { /* JSON 없어도 계속 */ });
        }
      },
      onError: (message, detail) => {
        hideProgress();
        setStreaming(false);
        setMarkdown(formatConversionError(message, detail));
        setConverting(false);
        setStatusIdle();
      },
    });
  });
}

/**
 * 변환 오류를 Markdown 패널에 표시할 진단 블록으로 변환한다.
 *
 * 상세 정보는 접힌 영역에 넣어 일반 사용 흐름을 방해하지 않는다.
 * 전체 스택 트레이스는 설정의 로그 폴더에서 확인할 수 있다.
 */
function formatConversionError(message: string, detail?: string | null): string {
  if (!detail) return `> **오류**: ${message}`;
  const safeDetail = detail.replace(/```/g, "'''");
  return [
    `> **오류**: ${message}`,
    "",
    "<details>",
    "<summary>오류 상세 보기</summary>",
    "",
    "```text",
    safeDetail,
    "```",
    "",
    "</details>",
    "",
    "> 전체 스택 트레이스는 설정의 **진단 로그** 폴더에서 확인할 수 있습니다.",
  ].join("\n");
}

function registerKeyboardShortcuts(): void {
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;

    // 입력 필드 포커스 중에는 단축키 비활성화
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    if (mod && e.key === "o") {
      e.preventDefault();
      (document.getElementById("pdf-open-dialog-btn") as HTMLButtonElement | null)?.click();
    } else if (mod && e.key === "Enter") {
      e.preventDefault();
      const convertBtn = document.getElementById("pdf-convert-btn") as HTMLButtonElement | null;
      if (convertBtn && !convertBtn.disabled) convertBtn.click();
    } else if (mod && e.key === "s") {
      e.preventDefault();
      (document.getElementById("md-save-btn") as HTMLButtonElement | null)?.click();
    } else if (e.key === "Escape") {
      const cancelBtn = document.getElementById("pdf-cancel-btn") as HTMLButtonElement | null;
      if (cancelBtn && cancelBtn.style.display !== "none") cancelBtn.click();
    }
  });
}

init();
