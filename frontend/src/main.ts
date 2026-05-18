import "./style.css";
import "highlight.js/styles/github-dark.css";
import { getServerPort, onServerReady } from "./tauri-bridge";
import { mountLayout, getPanelLeft, getPanelRight } from "./layout";
import { mountPdfViewer, setConvertHandler, setConverting, setBBoxAvailable, getSelectedMode, currentPdfBuffer } from "./pdf-viewer";
import { mountMarkdownRenderer, setMarkdown, setStreaming, clearMarkdown, setHelpHandler, setSettingsHandler } from "./markdown-renderer";
import { convertPdf } from "./converter";
import { mountProgressBar, updateProgress, hideProgress } from "./progress-bar";
import { parseBBoxJson, toggleBBoxOverlay } from "./bbox-overlay";
import { readTextFile } from "./tauri-bridge";
import { maybeShowOnboarding, showOnboarding } from "./onboarding";
import { showSettings } from "./settings";

/**
 * Ktor 서버의 base URL. 서버가 준비되면 설정된다.
 * 다른 모듈에서 import해서 사용한다.
 */
export let serverBaseUrl: string | null = null;

async function init() {
  const root = document.querySelector<HTMLDivElement>("#app")!;
  renderLoading(root);

  // 앱 재시작 없이 핫리로드된 경우 서버가 이미 기동 중일 수 있으므로 먼저 조회한다.
  const existingPort = await getServerPort();
  if (existingPort != null) {
    serverBaseUrl = `http://localhost:${existingPort}`;
    renderApp(root);
    return;
  }

  // 서버가 아직 기동되지 않은 경우 이벤트 대기
  const unlisten = await onServerReady((port) => {
    serverBaseUrl = `http://localhost:${port}`;
    unlisten();
    renderApp(root);
  });
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

  // 진행률 바는 레이아웃 컨테이너에 마운트 (두 패널 위에 오버레이)
  const layoutEl = root.querySelector<HTMLElement>(".layout")!;
  mountProgressBar(layoutEl);

  // 최초 실행 시 온보딩 모달 표시; ? 버튼으로 재호출 가능
  setHelpHandler(() => showOnboarding());
  setSettingsHandler(() => showSettings());
  maybeShowOnboarding();

  setConvertHandler(async () => {
    const buffer = currentPdfBuffer;
    if (!buffer) return;

    setConverting(true);
    clearMarkdown();
    setStreaming(true);

    const mode = getSelectedMode() as Parameters<typeof convertPdf>[1];
    await convertPdf(buffer, mode, {
      onProgress: (event) => {
        updateProgress({ percent: event.percent, label: event.label, eta: event.eta });
      },
      onComplete: (markdown, jsonPath) => {
        hideProgress();
        setStreaming(false);
        setMarkdown(markdown);
        setConverting(false);
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
      },
    });
  });
}

init();
