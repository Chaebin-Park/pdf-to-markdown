/**
 * safety-panel.ts
 *
 * AI Safety 필터 결과를 사이드 패널로 표시한다.
 * JSON의 "hidden text": true 항목을 파싱해 필터링된 콘텐츠 목록을 보여준다.
 */

import { getHiddenItems } from "./bbox-overlay";

const FILTERS = [
  { label: "Hidden Text",  desc: "투명·저대비 숨김 텍스트 차단" },
  { label: "Off-page",     desc: "페이지 경계 외부 콘텐츠 차단" },
  { label: "Tiny Font",    desc: "≤1pt 극소 폰트 텍스트 차단" },
  { label: "Hidden OCG",   desc: "Optional Content Group 차단" },
];

let panelContainer: HTMLElement | null = null;

export function mountSafetyPanel(container: HTMLElement): void {
  panelContainer = container;
  renderPanel(container);
}

/** 변환 완료 후 JSON 파싱 결과로 패널을 갱신한다. */
export function updateSafetyPanel(): void {
  if (panelContainer) renderPanel(panelContainer);
}

function renderPanel(container: HTMLElement): void {
  const items = getHiddenItems();
  const count = items.length;
  const hasJson = count >= 0;

  container.innerHTML = `
    <div class="safety-panel">
      <div class="safety-status ${count > 0 ? "safety-warn-state" : "safety-ok-state"}">
        ${count > 0
          ? `<span class="safety-status-icon">⚠</span> 숨겨진 콘텐츠 ${count}개 감지됨`
          : hasJson
            ? `<span class="safety-status-icon">✓</span> AI Safety 보호 적용됨`
            : `<span class="safety-status-icon">✓</span> AI Safety 보호 적용됨`
        }
      </div>

      <div class="safety-section">
        <p class="safety-section-label">활성화된 필터</p>
        ${FILTERS.map(f => `
          <div class="safety-filter-row">
            <span class="safety-badge-on">ON</span>
            <div class="safety-filter-info">
              <span class="safety-filter-name">${f.label}</span>
              <span class="safety-filter-desc">${f.desc}</span>
            </div>
          </div>
        `).join("")}
      </div>

      ${count > 0 ? `
        <div class="safety-section">
          <p class="safety-section-label">감지된 항목 (${count})</p>
          ${items.map(item => `
            <div class="safety-item-row">
              <div class="safety-item-header">
                <span class="safety-item-type">${item.type}</span>
                <span class="safety-item-page">p.${item.pageNumber}</span>
              </div>
              ${item.content ? `<div class="safety-item-content">${escapeHtml(item.content.slice(0, 120))}</div>` : ""}
            </div>
          `).join("")}
        </div>
      ` : ""}
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
