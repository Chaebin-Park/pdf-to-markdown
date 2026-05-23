import "./style.css";
import "highlight.js/styles/github-dark.css";
import "katex/dist/katex.min.css";
import {
  getServerPort, onServerReady, onServerError, readTextFile,
  checkHybridInstalled, startDoclingServe, onDoclingReady, getDoclingPort,
} from "./tauri-bridge";
import { mountLayout, getPanelLeft, getPanelRight } from "./layout";
import { mountPdfViewer, setConvertHandler, setCancelHandler, setConverting, setBBoxAvailable, getSelectedMode, currentPdfBuffer } from "./pdf-viewer";
import { mountMarkdownRenderer, setMarkdown, setStreaming, clearMarkdown, setHelpHandler, setSettingsHandler } from "./markdown-renderer";
import { convertPdf, cancelConversion } from "./converter";
import { mountProgressBar, updateProgress, hideProgress } from "./progress-bar";
import { parseBBoxJson, toggleBBoxOverlay } from "./bbox-overlay";
import { maybeShowOnboarding, showOnboarding } from "./onboarding";
import { showSettings } from "./settings";
import { initTheme } from "./theme";
import { setDoclingReady } from "./docling-state";
import { checkForUpdates } from "./updater";
import { initStatusBar, setStatusMode, setStatusDone, setStatusIdle } from "./status-bar";
import { mountFilesPanel } from "./files-panel";
import { mountOutlinePanel } from "./outline-panel";
import { mountPagesPanel } from "./pages-panel";
import { registerPanelContent } from "./activity-rail";

/**
 * Ktor 서버의 base URL. 서버가 준비되면 설정된다.
 * 다른 모듈에서 import해서 사용한다.
 */
export let serverBaseUrl: string | null = null;

async function init() {
  initTheme();
  const root = document.querySelector<HTMLDivElement>("#app")!;
  renderLoading(root);

  // docling-serve 자동 시작: Ktor 서버와 병렬로 처리한다.
  initDocling();

  // 앱 재시작 없이 핫리로드된 경우 서버가 이미 기동 중일 수 있으므로 먼저 조회한다.
  const existingPort = await getServerPort();
  if (existingPort != null) {
    serverBaseUrl = `http://localhost:${existingPort}`;
    renderApp(root);
    initStatusBar(existingPort);
    return;
  }

  // 서버가 아직 기동되지 않은 경우 이벤트 대기
  const unlisten = await onServerReady((port) => {
    serverBaseUrl = `http://localhost:${port}`;
    unlisten();
    unlistenErr();
    renderApp(root);
    initStatusBar(port);
  });

  const unlistenErr = await onServerError((message) => {
    unlistenErr();
    renderServerError(root, message);
  });
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
  root.innerHTML = `
    <div class="splash">
      <p class="splash-label" style="color:#f87171;">서버 시작 실패</p>
      <p style="font-size:12px;color:#9ca3af;max-width:400px;text-align:center;margin-top:8px;">${message}</p>
      <p style="font-size:11px;color:#6b7280;margin-top:16px;">콘솔(F12)에서 상세 로그를 확인하세요.</p>
    </div>
  `;
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

  // 최초 실행 시 온보딩 모달 표시; ? 버튼으로 재호출 가능
  setHelpHandler(() => showOnboarding());
  setSettingsHandler(() => showSettings());
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
        // bbox JSON이 있으면 파싱 후 토글 버튼 활성화
        if (jsonPath) {
          readTextFile(jsonPath).then((json) => {
            parseBBoxJson(json);
            setBBoxAvailable(true, () => toggleBBoxOverlay());
          }).catch(() => { /* JSON 없어도 계속 */ });
        }
      },
      onError: (message) => {
        hideProgress();
        setStreaming(false);
        setMarkdown(`> **오류**: ${message}`);
        setConverting(false);
        setStatusIdle();
      },
    });
  });
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
