import "./style.css";
import { getServerPort, onServerReady } from "./tauri-bridge";

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
    renderReady(root);
    return;
  }

  // 서버가 아직 기동되지 않은 경우 이벤트 대기
  const unlisten = await onServerReady((port) => {
    serverBaseUrl = `http://localhost:${port}`;
    unlisten();
    renderReady(root);
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

function renderReady(root: HTMLDivElement): void {
  // TODO(3-3): 스플래시를 메인 레이아웃으로 교체한다.
  root.innerHTML = `
    <div class="splash">
      <p class="splash-label ready">준비 완료 — ${serverBaseUrl}</p>
    </div>
  `;
}

init();
