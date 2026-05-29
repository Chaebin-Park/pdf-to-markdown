/**
 * scroll-sync.ts
 *
 * PDF 패널 → Markdown 패널 단방향 동기 스크롤.
 *
 * 전략:
 *   1. bbox JSON의 heading 요소에서 page → 섹션 id 매핑 테이블 구성
 *   2. PDF IntersectionObserver → 현재 페이지 감지 → MD 패널 해당 헤딩으로 스크롤
 *   (양방향은 루프 발생 가능성이 높아 단방향으로 단순화)
 */

import type { BBoxItem } from "./bbox-overlay";
import { getBBoxItems } from "./bbox-overlay";
import { slugify } from "./markdown-renderer";

let pdfObserver: IntersectionObserver | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncing = false;

/**
 * bbox 항목을 분석해 PDF→MD 단방향 IntersectionObserver를 설치한다.
 * JSON 파싱 + 마크다운 렌더링이 완료된 뒤 호출해야 한다.
 */
export function initScrollSync(): void {
  destroyScrollSync();

  const pageToSection = buildPageToSection(getBBoxItems());
  if (pageToSection.size === 0) return; // 헤딩 없는 문서 — 동기 스크롤 불필요

  const pagesEl   = document.getElementById("pdf-pages");
  const previewEl = document.getElementById("md-preview-pane");
  if (!pagesEl || !previewEl) return;

  // ── PDF → MD ──────────────────────────────────────────────────────────────
  let lastPage = -1;

  pdfObserver = new IntersectionObserver(
    (entries) => {
      if (syncing) return;
      const visible = entries
        .filter((e) => e.isIntersecting)
        .map((e) => Number((e.target as HTMLElement).dataset.page))
        .filter((n) => !isNaN(n));
      if (visible.length === 0) return;

      const page = Math.min(...visible);
      if (page === lastPage) return; // 동일 페이지 반복 트리거 무시
      lastPage = page;

      const sectionId = nearestSection(pageToSection, page);
      if (!sectionId) return;

      const target = document.getElementById(sectionId);
      if (!target) return;

      syncing = true;
      if (syncTimer) clearTimeout(syncTimer);
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      syncTimer = setTimeout(() => { syncing = false; }, 1200);
    },
    { root: pagesEl.parentElement, threshold: 0.5 },
  );

  pagesEl
    .querySelectorAll<HTMLElement>(".pdf-page-wrapper")
    .forEach((w) => pdfObserver!.observe(w));
}

/** 진행 중인 동기 스크롤 observer를 모두 해제한다. */
export function destroyScrollSync(): void {
  pdfObserver?.disconnect();
  pdfObserver = null;
  if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
  syncing = false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** bbox 항목에서 page → 해당 페이지 첫 번째 헤딩 id 매핑 테이블을 구성한다. */
function buildPageToSection(items: BBoxItem[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const item of items) {
    if (item.type === "heading" && !map.has(item.pageNumber)) {
      const id = slugify(item.content);
      if (id) map.set(item.pageNumber, id);
    }
  }
  return map;
}

/**
 * 지정 페이지 이하에서 가장 가까운 섹션 id를 반환한다.
 * 해당 페이지에 헤딩이 없으면 이전 페이지를 탐색한다.
 */
function nearestSection(map: Map<number, string>, page: number): string | undefined {
  for (let p = page; p >= 1; p--) {
    const s = map.get(p);
    if (s) return s;
  }
  return undefined;
}
