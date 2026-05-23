/**
 * activity-rail.ts
 *
 * 좌측 56px 아이콘 Activity Rail.
 * 버튼 클릭 시 사이드 패널을 열고/닫는다.
 * 패널 콘텐츠는 registerPanelContent()로 외부에서 주입한다.
 */

const PANEL_LABELS: Record<string, string> = {
  files:   "Files",
  pages:   "Pages",
  outline: "Outline",
  search:  "Search",
  safety:  "Safety",
};

type PanelMountFn = (container: HTMLElement) => void;

let activePanel: string | null = null;
const panelMounts = new Map<string, PanelMountFn>();

export function initActivityRail(): void {
  document.querySelectorAll<HTMLButtonElement>(".rail-btn[data-panel]").forEach((btn) => {
    btn.addEventListener("click", () => togglePanel(btn.dataset.panel!));
  });

  document.getElementById("sp-close")?.addEventListener("click", closePanel);

  // 하단 고정 버튼은 기존 핸들러에 위임
  document.getElementById("rail-help")?.addEventListener("click", () => {
    document.getElementById("md-help-btn")?.click();
  });
  document.getElementById("rail-settings")?.addEventListener("click", () => {
    document.getElementById("md-settings-btn")?.click();
  });
}

/**
 * 패널 콘텐츠 마운트 함수를 등록한다.
 * 해당 패널이 이미 열려 있으면 즉시 마운트한다.
 */
export function registerPanelContent(panelId: string, mountFn: PanelMountFn): void {
  panelMounts.set(panelId, mountFn);
  if (activePanel === panelId) {
    const body = document.getElementById("sp-body");
    if (body) { body.innerHTML = ""; mountFn(body); }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function togglePanel(panelId: string): void {
  activePanel === panelId ? closePanel() : openPanel(panelId);
}

function openPanel(panelId: string): void {
  activePanel = panelId;

  document.querySelectorAll<HTMLButtonElement>(".rail-btn[data-panel]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.panel === panelId);
  });

  const title = document.getElementById("sp-title");
  if (title) title.textContent = PANEL_LABELS[panelId] ?? panelId;

  const body = document.getElementById("sp-body");
  if (body) {
    body.innerHTML = "";
    const mountFn = panelMounts.get(panelId);
    if (mountFn) {
      mountFn(body);
    } else {
      body.innerHTML = `<p class="sp-empty">준비 중</p>`;
    }
  }

  const panel = document.getElementById("side-panel");
  if (panel) panel.style.display = "flex";
}

function closePanel(): void {
  activePanel = null;
  document.querySelectorAll<HTMLButtonElement>(".rail-btn[data-panel]").forEach((btn) => {
    btn.classList.remove("active");
  });
  const panel = document.getElementById("side-panel");
  if (panel) panel.style.display = "none";
}
