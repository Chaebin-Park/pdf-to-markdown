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

/** 레이아웃 HTML을 #app에 주입하고 리사이저를 활성화한다. */
export function mountLayout(root: HTMLDivElement): void {
  root.innerHTML = `
    <div class="layout">
      <div class="panel panel-left" id="panel-left"></div>
      <div class="divider" id="divider" title="드래그하여 크기 조절"></div>
      <div class="panel panel-right" id="panel-right"></div>
    </div>
  `;

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
