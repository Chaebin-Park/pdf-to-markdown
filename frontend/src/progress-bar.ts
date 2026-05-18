/**
 * progress-bar.ts
 *
 * 변환 진행률 바 컴포넌트.
 * 레이아웃 상단(divider 위)에 오버레이 형태로 표시된다.
 *
 * 구조:
 *   .progress-overlay  (레이아웃 전체를 덮는 얇은 바 컨테이너)
 *   └── .progress-track
 *       ├── .progress-fill  (width: 0–100%)
 *       └── .progress-label (단계 설명 + ETA)
 */

interface ProgressState {
  percent: number;
  label: string;
  eta: number | null;
}

let overlayEl: HTMLElement | null = null;
let fillEl: HTMLElement | null = null;
let labelEl: HTMLElement | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** 진행률 바를 레이아웃 컨테이너에 마운트한다. */
export function mountProgressBar(layoutContainer: HTMLElement): void {
  const el = document.createElement("div");
  el.className = "progress-overlay";
  el.id = "progress-overlay";
  el.style.display = "none";
  el.innerHTML = `
    <div class="progress-track">
      <div class="progress-fill" id="progress-fill"></div>
    </div>
    <div class="progress-label" id="progress-label"></div>
  `;
  layoutContainer.appendChild(el);

  overlayEl = el;
  fillEl = document.getElementById("progress-fill");
  labelEl = document.getElementById("progress-label");
}

/** 진행률 업데이트. percent: 0–100 */
export function updateProgress(state: ProgressState): void {
  if (!overlayEl || !fillEl || !labelEl) return;

  overlayEl.style.display = "block";
  fillEl.style.width = `${state.percent}%`;

  const etaText = state.eta != null ? ` (약 ${state.eta}초 남음)` : "";
  labelEl.textContent = `${state.label}${etaText}`;
}

/** 진행률 바를 숨기고 초기화한다. */
export function hideProgress(): void {
  if (!overlayEl || !fillEl || !labelEl) return;
  // 완료 애니메이션 후 숨기기
  fillEl.style.width = "100%";
  setTimeout(() => {
    if (!overlayEl || !fillEl || !labelEl) return;
    overlayEl.style.display = "none";
    fillEl.style.width = "0%";
    labelEl.textContent = "";
  }, 400);
}
