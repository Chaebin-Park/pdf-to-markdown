/**
 * onboarding.ts
 *
 * 최초 실행 시 앱 사용법을 안내하는 모달을 표시한다.
 * 완료 상태는 localStorage에 저장하여 이후 실행에서는 표시하지 않는다.
 */

const STORAGE_KEY = "pdf2md_onboarding_done";

const STEPS = [
  {
    icon: "📄",
    title: "PDF 열기",
    desc: "왼쪽 패널에 PDF 파일을 드래그 앤 드롭하거나 [파일 선택]을 클릭하세요.",
  },
  {
    icon: "⚙️",
    title: "모드 선택",
    desc: "Standard(기본) · Hybrid AI · OCR · Formula 중 용도에 맞는 모드를 선택하세요.",
  },
  {
    icon: "▶️",
    title: "변환 실행",
    desc: "[변환] 버튼을 누르면 PDF가 Markdown으로 변환되어 오른쪽 패널에 표시됩니다.",
  },
  {
    icon: "📋",
    title: "결과 활용",
    desc: "[Copy] 버튼으로 Markdown을 복사하거나 [BBox] 버튼으로 요소별 위치를 확인하세요.",
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * 온보딩 완료 여부를 확인하고, 미완료면 모달을 표시한다.
 * 항상 마운트가 완료된 후 호출해야 한다.
 */
export function maybeShowOnboarding(): void {
  if (localStorage.getItem(STORAGE_KEY)) return;
  showModal();
}

/** 강제로 온보딩 모달을 표시한다 (도움말 버튼 등에서 사용). */
export function showOnboarding(): void {
  showModal();
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function showModal(): void {
  // 이미 열려 있으면 중복 생성 방지
  if (document.getElementById("onboarding-modal")) return;

  const stepsHtml = STEPS.map(
    (s) => `
      <div class="ob-step">
        <span class="ob-icon">${s.icon}</span>
        <div>
          <div class="ob-step-title">${s.title}</div>
          <div class="ob-step-desc">${s.desc}</div>
        </div>
      </div>`,
  ).join("");

  const modal = document.createElement("div");
  modal.id = "onboarding-modal";
  modal.className = "ob-backdrop";
  modal.innerHTML = `
    <div class="ob-card" role="dialog" aria-modal="true" aria-labelledby="ob-title">
      <h2 class="ob-title" id="ob-title">PDF to Markdown에 오신 것을 환영합니다</h2>
      <p class="ob-subtitle">빠르게 시작하는 방법을 안내합니다.</p>
      <div class="ob-steps">${stepsHtml}</div>
      <button class="ob-start-btn" id="ob-start-btn">시작하기</button>
    </div>
  `;

  document.body.appendChild(modal);

  // 배경 클릭 또는 버튼 클릭으로 닫기
  document.getElementById("ob-start-btn")?.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  // Esc 키로 닫기
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      closeModal();
      document.removeEventListener("keydown", onKey);
    }
  };
  document.addEventListener("keydown", onKey);

  // 포커스 트랩
  requestAnimationFrame(() => {
    document.getElementById("ob-start-btn")?.focus();
  });
}

function closeModal(): void {
  const modal = document.getElementById("onboarding-modal");
  if (!modal) return;
  modal.classList.add("ob-closing");
  setTimeout(() => {
    modal.remove();
    localStorage.setItem(STORAGE_KEY, "1");
  }, 200);
}
