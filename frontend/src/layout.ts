/**
 * layout.ts
 *
 * 앱의 기본 2-패널 레이아웃을 생성하고 드래그 리사이저를 관리한다.
 *
 * 구조:
 *   #app
 *   └── .layout
 *       ├── .panel-left   (PDF 뷰어 마운트 포인트)
 *       ├── .divider      (드래그 리사이저)
 *       └── .panel-right  (Markdown 뷰어 마운트 포인트)
 */

const MIN_PANEL_PX = 200;
const DEFAULT_LEFT_RATIO = 0.5;
const RATIO_STORAGE_KEY = "panelLeftRatio";

function getSavedRatio(): number {
  const v = parseFloat(localStorage.getItem(RATIO_STORAGE_KEY) ?? "");
  return isNaN(v) ? DEFAULT_LEFT_RATIO : Math.max(0.15, Math.min(0.85, v));
}

/** 레이아웃 HTML을 #app에 주입하고 리사이저와 타이틀바를 활성화한다. */
export function mountLayout(root: HTMLDivElement): void {
  root.innerHTML = `
    <div class="app-titlebar" data-tauri-drag-region id="app-titlebar">
      <div class="titlebar-left">
        <div class="titlebar-traffic">
          <button class="tb-btn tb-close"    id="tb-close"    title="닫기"></button>
          <button class="tb-btn tb-minimize" id="tb-minimize" title="최소화"></button>
          <button class="tb-btn tb-maximize" id="tb-maximize" title="최대화"></button>
        </div>
      </div>
      <div class="titlebar-center">
        <span class="titlebar-logo"><span>P</span><span class="logo-slash">/</span><span>M</span></span>
        <span id="pdf-filename">PDF to Markdown</span>
        <span id="titlebar-meta">
          <span id="pdf-pagecount"></span>
          <span class="titlebar-tagged" id="titlebar-tagged" style="display:none">· ✓ Tagged</span>
        </span>
      </div>
      <div class="titlebar-right">
        <button class="tb-action" id="tb-open-btn">Open <kbd>⌘O</kbd></button>
        <button class="pdf-convert-btn" id="pdf-convert-btn" disabled>변환 <kbd>⌘↵</kbd></button>
        <button class="pdf-cancel-btn"  id="pdf-cancel-btn"  style="display:none">취소</button>
      </div>
    </div>
    <div class="layout">
      <div class="panel panel-left"  id="panel-left"></div>
      <div class="divider" id="divider" title="드래그하여 크기 조절"></div>
      <div class="panel panel-right" id="panel-right"></div>
    </div>
    <div class="app-statusbar" id="app-statusbar">
      <div class="sb-group">
        <span class="sb-item" id="sb-mode">● Standard</span>
      </div>
      <div class="sb-group">
        <span class="sb-item" id="sb-progress" style="display:none"></span>
        <span class="sb-item" id="sb-avgtime"  style="display:none"></span>
      </div>
      <div class="sb-group">
        <span class="sb-item" id="sb-port"></span>
      </div>
    </div>
  `;

  initWindowControls();
  initResizer(
    root.querySelector<HTMLDivElement>(".layout")!,
    root.querySelector<HTMLDivElement>(".panel-left")!,
    root.querySelector<HTMLDivElement>(".panel-right")!,
    root.querySelector<HTMLDivElement>(".divider")!,
  );
}

/** 좌측 패널 컨테이너를 반환한다. */
export function getPanelLeft(): HTMLDivElement {
  return document.getElementById("panel-left") as HTMLDivElement;
}

/** 우측 패널 컨테이너를 반환한다. */
export function getPanelRight(): HTMLDivElement {
  return document.getElementById("panel-right") as HTMLDivElement;
}

// ---------------------------------------------------------------------------
// Window controls
// ---------------------------------------------------------------------------

async function initWindowControls(): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    document.getElementById("tb-close")   ?.addEventListener("click", () => win.close());
    document.getElementById("tb-minimize")?.addEventListener("click", () => win.minimize());
    document.getElementById("tb-maximize")?.addEventListener("click", () => win.toggleMaximize());
  } catch {
    // browser dev mode — window API unavailable
  }
}

// ---------------------------------------------------------------------------
// Resizer
// ---------------------------------------------------------------------------

function initResizer(
  layout: HTMLDivElement,
  panelLeft: HTMLDivElement,
  _panelRight: HTMLDivElement,
  divider: HTMLDivElement,
): void {
  // 저장된 비율 복원, 없으면 기본값 사용
  setLeftRatio(panelLeft, getSavedRatio());

  let dragging = false;
  let startX = 0;
  let startBasis = 0;

  divider.addEventListener("mousedown", (e: MouseEvent) => {
    dragging = true;
    startX = e.clientX;
    startBasis = panelLeft.getBoundingClientRect().width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    // 드래그 중 iframe/웹뷰가 마우스 이벤트를 가로채지 않도록 오버레이
    setOverlay(true);
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e: MouseEvent) => {
    if (!dragging) return;
    const totalWidth = layout.getBoundingClientRect().width;
    const newBasis = startBasis + (e.clientX - startX);
    const clamped = Math.max(MIN_PANEL_PX, Math.min(newBasis, totalWidth - MIN_PANEL_PX - 4));
    setLeftRatio(panelLeft, clamped / totalWidth);
  });

  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    setOverlay(false);
    // 현재 비율 저장
    const totalWidth = layout.getBoundingClientRect().width;
    const currentBasis = panelLeft.getBoundingClientRect().width;
    localStorage.setItem(RATIO_STORAGE_KEY, String((currentBasis / totalWidth).toFixed(4)));
  });
}

function setLeftRatio(panelLeft: HTMLDivElement, ratio: number): void {
  panelLeft.style.flexBasis = `${(ratio * 100).toFixed(2)}%`;
}

/** 드래그 중 iframe이 이벤트를 가로채지 못하도록 투명 오버레이를 on/off 한다. */
function setOverlay(active: boolean): void {
  const id = "drag-overlay";
  if (active) {
    if (document.getElementById(id)) return;
    const el = document.createElement("div");
    el.id = id;
    el.style.cssText =
      "position:fixed;inset:0;z-index:9999;cursor:col-resize;";
    document.body.appendChild(el);
  } else {
    document.getElementById(id)?.remove();
  }
}
