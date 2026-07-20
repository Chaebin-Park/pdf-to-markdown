/**
 * pdf-viewer.ts
 *
 * PDF.js 기반 좌측 패널 PDF 뷰어.
 * - 전체 페이지를 canvas 리스트로 렌더링 (스크롤 방식)
 * - 패널 너비에 맞게 자동 fit-to-width 스케일 계산
 * - 드래그 앤 드롭으로 PDF 열기
 * - ResizeObserver로 너비 변경 시 재렌더링
 */

import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { refreshBBoxOverlay, clearBBox, toggleOrderOverlay } from "./bbox-overlay";
import { isDoclingReady, onDoclingReadyChange } from "./docling-state";
import { openPdfFile } from "./tauri-bridge";
import { DEFAULT_QUALITY_OPTIONS, type ConversionQualityOptions } from "./conversion-options";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

// ---------------------------------------------------------------------------
// Recent files (localStorage)
// ---------------------------------------------------------------------------

const RECENT_KEY = "recentPdfs";
const RECENT_MAX = 5;
export const RECENT_CHANGED_EVENT = "recent-pdfs-changed";

interface RecentFile { name: string; path: string; pages?: number; size?: number; }

export function getRecentFiles(): RecentFile[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch { return []; }
}

/**
 * 경로로 PDF를 직접 연다.
 * 새로 추가된 파일만 Recent 맨 앞으로 이동하고, 목록에서 재열 때는 순서를 유지한다.
 */
export async function openPdfFromPath(path: string, promoteRecent = true): Promise<void> {
  const requestVersion = ++openRequestVersion;
  const { readBinaryFile } = await import("./tauri-bridge");
  const bytes = await readBinaryFile(path);
  if (openRequestVersion !== requestVersion) return;
  const name = path.split(/[\\/]/).pop() ?? path;
  currentPdfBuffer = bytes.buffer as ArrayBuffer;
  currentPdfName = name;
  currentPdfPath = path;
  if (promoteRecent) {
    addRecentFile(name, path, bytes.byteLength);
  } else {
    notifyRecentFilesChanged();
  }
  await openBuffer(bytes.buffer as ArrayBuffer, name);
}

function addRecentFile(name: string, path: string, size?: number): void {
  const list = getRecentFiles().filter((r) => r.path !== path);
  list.unshift({ name, path, size });
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  notifyRecentFilesChanged();
}

function updateRecentFileMeta(path: string, pages: number): void {
  const list = getRecentFiles();
  const entry = list.find((r) => r.path === path);
  if (entry) {
    entry.pages = pages;
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    notifyRecentFilesChanged();
  }
}

/** Recent 저장소 변경을 각 패널에 알리고 드롭존 목록을 즉시 갱신한다. */
function notifyRecentFilesChanged(): void {
  renderRecentFiles();
  window.dispatchEvent(new CustomEvent(RECENT_CHANGED_EVENT));
}

function renderRecentFiles(): void {
  const el = document.getElementById("pdf-recent-list");
  if (!el) return;
  const list = getRecentFiles();
  if (list.length === 0) { el.style.display = "none"; return; }
  el.style.display = "block";
  el.innerHTML = `<p class="pdf-recent-label">최근 파일</p>` +
    list.map((r) =>
      `<button class="pdf-recent-item${r.path === currentPdfPath ? " active" : ""}" data-path="${encodeURIComponent(r.path)}" title="${r.path}">${r.name}</button>`
    ).join("");
  el.querySelectorAll<HTMLButtonElement>(".pdf-recent-item").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const path = decodeURIComponent(btn.dataset.path ?? "");
      if (!path) return;
      try {
        await openPdfFromPath(path, false);
      } catch {
        btn.textContent = `⚠ ${btn.textContent} (파일 없음)`;
        btn.disabled = true;
      }
    });
  });
}

// 뷰어에 렌더링할 최대 페이지 수. 초과분은 DOM에 추가하지 않는다.
// 변환(서버 처리)은 전체 페이지를 그대로 전송하므로 영향 없음.
const PREVIEW_PAGE_LIMIT = 100;

/** 현재 로드된 PDF 파일명. 외부에서 참조 가능. */
export let currentPdfName: string | null = null;

/** 현재 로드된 PDF 데이터(ArrayBuffer). 변환 API 호출 시 사용. */
export let currentPdfBuffer: ArrayBuffer | null = null;

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let pdfDoc: PDFDocumentProxy | null = null;
let currentPdfPath: string | null = null;
let openRequestVersion = 0;

/** 현재 로드된 PDFDocumentProxy. Pages 패널 썸네일 렌더링에 사용. */
export function getPdfDoc(): PDFDocumentProxy | null { return pdfDoc; }

/** Recent 목록에서 현재 열린 PDF를 표시하기 위한 절대 경로를 반환한다. */
export function getCurrentPdfPath(): string | null { return currentPdfPath; }
let resizeObserver: ResizeObserver | null = null;
let renderVersion = 0; // 재렌더링 시 이전 작업 취소용
let convertHandler: (() => void) | null = null;
let cancelHandler: (() => void) | null = null;
let zoomLevel = 1.0;
const ZOOM_STEPS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * 뷰어를 `container`에 마운트한다.
 * 드롭존 UI를 표시하고 이벤트 리스너를 등록한다.
 */
export function mountPdfViewer(container: HTMLElement): void {
  container.innerHTML = `
    <div class="pdf-viewer" id="pdf-viewer">
      <div class="pdf-dropzone" id="pdf-dropzone">
        <div class="pdf-dropzone-inner">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="12" y1="12" x2="12" y2="18"/>
            <polyline points="9 15 12 12 15 15"/>
          </svg>
          <p>PDF 파일을 여기에 드롭하거나</p>
          <div class="pdf-open-row">
            <button class="pdf-open-btn-dialog" id="pdf-open-dialog-btn">파일 열기</button>
            <label class="pdf-open-btn">
              드래그 선택
              <input type="file" accept="application/pdf" style="display:none" id="pdf-file-input" />
            </label>
          </div>
        </div>
        <div class="pdf-recent-list" id="pdf-recent-list" style="display:none"></div>
      </div>
      <div class="pdf-toolbar" id="pdf-toolbar" style="display:none">
        <div class="pdf-page-nav" id="pdf-page-nav" style="display:none">
          <button class="pdf-page-nav-btn" id="pdf-page-prev" title="이전 페이지">‹</button>
          <input class="pdf-page-input" id="pdf-page-input" type="number" min="1" value="1" title="페이지 이동" />
          <span class="pdf-page-total" id="pdf-page-total">/ 1</span>
          <button class="pdf-page-nav-btn" id="pdf-page-next" title="다음 페이지">›</button>
        </div>
        <div class="ptb-zoom" id="ptb-zoom" style="display:none">
          <button class="ptb-btn" id="pdf-zoom-out" title="축소">−</button>
          <button class="ptb-zoom-label" id="pdf-zoom-fit" title="너비 맞춤">100%</button>
          <button class="ptb-btn" id="pdf-zoom-in" title="확대">+</button>
        </div>
        <span class="ptb-spacer"></span>
        <button class="ptb-toggle-btn" id="pdf-bbox-btn" title="Bounding Box 표시" style="display:none">BBox</button>
        <button class="ptb-toggle-btn" id="pdf-order-btn" title="읽기 순서 표시" style="display:none">Order</button>
        <span class="ptb-sep"></span>
        <div class="pdf-mode-group">
          <select class="pdf-mode-select" id="pdf-mode-select" title="변환 모드 선택">
            <option value="STANDARD">Standard</option>
            <option value="HYBRID">Hybrid AI</option>
            <option value="HYBRID_FULL">Table Quality</option>
            <option value="OCR">OCR</option>
            <option value="FORMULA">Formula</option>
          </select>
          <span class="pdf-mode-help" tabindex="0">?
            <span class="pdf-mode-tooltip">
              <b>Standard</b> — 빠른 텍스트 추출. 일반 문서에 적합.<br>
              <b>Hybrid AI</b> — AI 레이아웃 분석. 복잡한 논문·보고서 (설치 필요).<br>
              <b>Table Quality</b> — 전 페이지 AI 처리. 표 정확도 최대화 (설치 필요).<br>
              <b>OCR</b> — 스캔 PDF 텍스트 추출 (설치 필요).<br>
              <b>Formula</b> — 수식 포함 논문 전용, LaTeX 추출 (설치 필요).
            </span>
          </span>
        </div>
        <span class="pdf-mode-warning" id="pdf-mode-warning" style="display:none" title="docling-serve가 준비되지 않았습니다. 설정에서 Hybrid 모드를 설치하세요.">⚠</span>
        <details class="quality-options">
          <summary>품질 설정</summary>
          <div class="quality-options-popover">
            <label>문단 순서 판단
              <select id="quality-reading-order" aria-describedby="quality-reading-order-guide">
                <option value="AUTO">자동 선택 (권장)</option>
                <option value="STRUCT_TREE">문서에 저장된 순서 우선</option>
                <option value="XY_CUT">화면에 보이는 배치 우선</option>
              </select>
            </label>
            <div class="quality-option-guide" id="quality-reading-order-guide">
              <p><b>자동 선택</b> — 대부분의 PDF에 적합합니다. 문서 정보와 화면 배치를 함께 판단합니다.</p>
              <p><b>문서에 저장된 순서 우선</b> — 접근성 태그가 잘 만들어진 전자문서에 적합합니다.</p>
              <p><b>화면에 보이는 배치 우선</b> — 문단 순서가 뒤섞이거나 다단 편집된 논문에 사용하세요.</p>
              <details>
                <summary>기술 정보</summary>
                PDF 구조 태그(Struct Tree)와 위치 기반 문단 분석(XY-Cut) 중 사용할 방식을 정합니다.
              </details>
            </div>
            <label><input id="quality-header-footer" type="checkbox"> 머리글·바닥글 포함</label>
            <label><input id="quality-line-breaks" type="checkbox"> 원본 줄바꿈 유지</label>
            <hr>
            <span class="quality-filter-title">숨겨진 콘텐츠 처리</span>
            <p class="quality-filter-help">일반적으로 기본값을 권장합니다. 본문이 누락될 때만 해당 항목을 조정하세요.</p>
            <label><input id="filter-hidden-text" type="checkbox"> 숨겨진 텍스트 제거</label>
            <label><input id="filter-out-of-page" type="checkbox" checked> 페이지 밖 텍스트 제거</label>
            <label><input id="filter-tiny-text" type="checkbox" checked> 극소 텍스트 제거</label>
            <label><input id="filter-hidden-ocg" type="checkbox" checked> 숨겨진 레이어 제거</label>
            <p class="quality-risk-warning" id="quality-risk-warning" hidden>⚠ 보호 필터를 끄면 숨겨진 콘텐츠가 결과에 포함될 수 있습니다.</p>
          </div>
        </details>
      </div>
      <div class="pdf-pages" id="pdf-pages" style="display:none"></div>
    </div>
  `;

  registerNativeDragAndDrop(container);
  registerDragAndDrop(container);
  registerFileInput(container);
  registerModeWarning();
  registerQualityOptions();
  registerOpenDialog();
  initZoomControls();
  renderRecentFiles();

  document.getElementById("pdf-convert-btn")?.addEventListener("click", () => {
    convertHandler?.();
  });

  document.getElementById("pdf-cancel-btn")?.addEventListener("click", () => {
    cancelHandler?.();
  });
}

/**
 * PDF 변환 버튼 클릭 핸들러를 등록한다.
 * main.ts에서 converter.ts의 convertPdf를 래핑해서 전달한다.
 */
export function setConvertHandler(handler: () => void): void {
  convertHandler = handler;
}

export function setCancelHandler(handler: () => void): void {
  cancelHandler = handler;
}

/** 현재 선택된 변환 모드를 반환한다. */
export function getSelectedMode(): string {
  const sel = document.getElementById("pdf-mode-select") as HTMLSelectElement | null;
  return sel?.value ?? "STANDARD";
}

export function getConversionQualityOptions(): ConversionQualityOptions {
  const checked = (id: string, fallback: boolean) =>
    (document.getElementById(id) as HTMLInputElement | null)?.checked ?? fallback;
  const readingOrder = (document.getElementById("quality-reading-order") as HTMLSelectElement | null)?.value;
  return {
    readingOrder: readingOrder === "STRUCT_TREE" || readingOrder === "XY_CUT" ? readingOrder : "AUTO",
    includeHeaderFooter: checked("quality-header-footer", DEFAULT_QUALITY_OPTIONS.includeHeaderFooter),
    keepLineBreaks: checked("quality-line-breaks", DEFAULT_QUALITY_OPTIONS.keepLineBreaks),
    filterHiddenText: checked("filter-hidden-text", DEFAULT_QUALITY_OPTIONS.filterHiddenText),
    filterOutOfPage: checked("filter-out-of-page", DEFAULT_QUALITY_OPTIONS.filterOutOfPage),
    filterTinyText: checked("filter-tiny-text", DEFAULT_QUALITY_OPTIONS.filterTinyText),
    filterHiddenOcg: checked("filter-hidden-ocg", DEFAULT_QUALITY_OPTIONS.filterHiddenOcg),
  };
}

function registerQualityOptions(): void {
  const warning = document.getElementById("quality-risk-warning");
  const protectedFilters = ["filter-out-of-page", "filter-tiny-text", "filter-hidden-ocg"];
  const updateWarning = () => {
    const risky = protectedFilters.some((id) => !(document.getElementById(id) as HTMLInputElement).checked);
    if (warning) warning.hidden = !risky;
  };
  protectedFilters.forEach((id) => document.getElementById(id)?.addEventListener("change", updateWarning));
  updateWarning();
}

/**
 * BBox 버튼을 표시/숨기고 토글 핸들러를 연결한다.
 * 변환 완료 후 jsonPath가 있으면 main.ts에서 호출한다.
 */
export function setBBoxAvailable(available: boolean, onToggle?: () => void): void {
  const bboxBtn = document.getElementById("pdf-bbox-btn") as HTMLButtonElement | null;
  const orderBtn = document.getElementById("pdf-order-btn") as HTMLButtonElement | null;
  if (!bboxBtn) return;

  bboxBtn.style.display = available ? "inline-flex" : "none";
  if (orderBtn) orderBtn.style.display = available ? "inline-flex" : "none";

  if (available && onToggle) {
    bboxBtn.onclick = () => {
      bboxBtn.classList.toggle("active");
      onToggle();
    };
  }
  if (available && orderBtn) {
    orderBtn.onclick = () => {
      orderBtn.classList.toggle("active");
      toggleOrderOverlay();
    };
  }
}

/**
 * 변환 진행 중 상태를 토글한다.
 * true → 버튼 비활성화 + "변환 중…" 표시
 */
export function setConverting(active: boolean): void {
  const btn = document.getElementById("pdf-convert-btn") as HTMLButtonElement | null;
  const cancelBtn = document.getElementById("pdf-cancel-btn") as HTMLButtonElement | null;
  if (!btn) return;
  btn.disabled = active;
  btn.innerHTML = active ? "변환 중…" : '변환 <kbd>⌘↵</kbd>';
  if (cancelBtn) cancelBtn.style.display = active ? "inline-block" : "none";
}

/** File 객체로 PDF를 로드한다. */
export async function loadPdf(file: File): Promise<void> {
  const requestVersion = ++openRequestVersion;
  const buffer = await file.arrayBuffer();
  if (openRequestVersion !== requestVersion) return;
  currentPdfName = file.name;
  currentPdfBuffer = buffer;
  currentPdfPath = null;
  notifyRecentFilesChanged();
  await openBuffer(currentPdfBuffer, file.name);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function openBuffer(buffer: ArrayBuffer, name: string): Promise<void> {
  const version = ++renderVersion;

  // 이전 PDF 정리
  pdfDoc?.destroy();
  pdfDoc = null;
  clearBBox();
  setBBoxAvailable(false);

  const viewerEl = document.getElementById("pdf-viewer")!;
  const dropzone = document.getElementById("pdf-dropzone") as HTMLElement;
  const toolbar = document.getElementById("pdf-toolbar") as HTMLElement;
  const pages = document.getElementById("pdf-pages") as HTMLElement;
  const filenameEl = document.getElementById("pdf-filename")!;
  const pagecountEl = document.getElementById("pdf-pagecount")!;

  dropzone.style.display = "none";
  toolbar.style.display = "flex";
  pages.style.display = "flex";
  pages.innerHTML = "";

  zoomLevel = 1.0;
  const zoomGroup = document.getElementById("ptb-zoom") as HTMLElement | null;
  const zoomFitBtn = document.getElementById("pdf-zoom-fit") as HTMLButtonElement | null;
  if (zoomGroup) zoomGroup.style.display = "flex";
  if (zoomFitBtn) zoomFitBtn.textContent = "100%";

  // 로딩 스피너
  pages.innerHTML = `<div class="pdf-loading">
    <span class="dot"></span><span class="dot"></span><span class="dot"></span>
  </div>`;

  const loadingTask = pdfjsLib.getDocument({ data: buffer.slice(0) });
  const nextPdfDoc = await loadingTask.promise;
  if (renderVersion !== version) {
    await nextPdfDoc.destroy();
    return;
  }
  pdfDoc = nextPdfDoc;

  filenameEl.textContent = name;
  const totalPages = pdfDoc.numPages;
  const previewPages = Math.min(totalPages, PREVIEW_PAGE_LIMIT);
  pagecountEl.textContent = `${totalPages} pages`;
  if (currentPdfPath) updateRecentFileMeta(currentPdfPath, totalPages);

  // 타이틀바 메타 정보 표시 + 변환 버튼 활성화
  const titlebarMeta = document.getElementById("titlebar-meta");
  if (titlebarMeta) titlebarMeta.style.display = "flex";
  const convertBtn = document.getElementById("pdf-convert-btn") as HTMLButtonElement | null;
  if (convertBtn) convertBtn.disabled = false;
  pages.innerHTML = "";

  // 페이지 네비게이션 UI 초기화 (observer는 renderAllPages 이후에 연결)
  const pageNav = document.getElementById("pdf-page-nav") as HTMLElement | null;
  const pageInput = document.getElementById("pdf-page-input") as HTMLInputElement | null;
  const pageTotalEl = document.getElementById("pdf-page-total") as HTMLElement | null;
  if (pageNav && pageInput && pageTotalEl) {
    pageNav.style.display = "flex";
    pageInput.value = "1";
    pageInput.max = String(previewPages);
    pageTotalEl.textContent = `/ ${totalPages}`;
  }

  // 대용량 PDF 경고 배너
  if (totalPages > PREVIEW_PAGE_LIMIT) {
    const banner = document.createElement("div");
    banner.className = "pdf-preview-limit-banner";
    banner.textContent = `⚠ ${totalPages}페이지 — 미리보기는 앞 ${PREVIEW_PAGE_LIMIT}페이지만 표시됩니다. 변환은 전체 페이지를 처리합니다.`;
    pages.appendChild(banner);
  }

  // ResizeObserver: 패널 너비 변경 시 재렌더링
  resizeObserver?.disconnect();
  resizeObserver = new ResizeObserver(() => {
    if (pdfDoc) rerenderAll(pdfDoc, version);
  });
  resizeObserver.observe(viewerEl);

  await renderAllPages(pdfDoc, version, previewPages);

  // 렌더링 완료 후 IntersectionObserver + 버튼 이벤트 연결
  if (pageInput) setupPageNav(pageInput, previewPages, pages);
}

async function renderAllPages(doc: PDFDocumentProxy, version: number, limit: number = doc.numPages): Promise<void> {
  const pages = document.getElementById("pdf-pages") as HTMLElement;
  if (!pages) return;

  for (let i = 1; i <= limit; i++) {
    if (renderVersion !== version) return;
    const page = await doc.getPage(i);
    if (renderVersion !== version) return;
    const canvas = buildCanvas(page, pages.clientWidth);
    const wrapper = document.createElement("div");
    wrapper.className = "pdf-page-wrapper";
    wrapper.dataset.page = String(i);
    wrapper.appendChild(canvas);
    pages.appendChild(wrapper);
    await renderPage(page, canvas);
  }

  if (limit < doc.numPages) {
    const notice = document.createElement("div");
    notice.className = "pdf-preview-limit-notice";
    notice.textContent = `... 이하 ${doc.numPages - limit}페이지 미리보기 생략`;
    pages.appendChild(notice);
  }
}

async function rerenderAll(doc: PDFDocumentProxy, version: number): Promise<void> {
  const pages = document.getElementById("pdf-pages") as HTMLElement;
  if (!pages) return;
  const wrappers = pages.querySelectorAll<HTMLDivElement>(".pdf-page-wrapper");
  for (const wrapper of Array.from(wrappers)) {
    if (renderVersion !== version) return;
    const pageNum = Number(wrapper.dataset.page);
    const page = await doc.getPage(pageNum);
    if (renderVersion !== version) return;
    const existing = wrapper.querySelector("canvas");
    if (!existing) continue;
    const newCanvas = buildCanvas(page, pages.clientWidth);
    wrapper.replaceChild(newCanvas, existing);
    await renderPage(page, newCanvas);
  }
  // 리사이즈 후 bbox 오버레이 좌표 재계산
  refreshBBoxOverlay();
}

function buildCanvas(page: PDFPageProxy, containerWidth: number): HTMLCanvasElement {
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.max(0.5, (containerWidth * zoomLevel) / baseViewport.width);
  const viewport = page.getViewport({ scale });
  const viewportWidth = Math.floor(viewport.width);
  const viewportHeight = Math.floor(viewport.height);

  const canvas = document.createElement("canvas");
  canvas.width = viewportWidth;
  canvas.height = viewportHeight;
  canvas.style.width = `${viewportWidth}px`;
  canvas.style.height = `${viewportHeight}px`;
  canvas.dataset.scale = String(scale);
  canvas.dataset.viewportWidth = String(viewport.width);
  canvas.dataset.viewportHeight = String(viewport.height);
  canvas.dataset.viewportTransform = viewport.transform.join(",");
  return canvas;
}

async function renderPage(page: PDFPageProxy, canvas: HTMLCanvasElement): Promise<void> {
  try {
    const scale = Number(canvas.dataset.scale);
    const viewport = page.getViewport({ scale });
    const ctx = canvas.getContext("2d")!;
    // v4 API: canvas 파라미터 없음 (v5에서 추가됨)
    await page.render({ canvasContext: ctx, viewport }).promise;
  } catch (e) {
    // 렌더링 실패 시 canvas에 오류 메시지를 표시한다.
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#2d2d2d";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ce9178";
    ctx.font = "13px sans-serif";
    ctx.fillText(`렌더링 실패: ${e}`, 10, 30);
  }
}

// ---------------------------------------------------------------------------
// Page navigation
// ---------------------------------------------------------------------------

function jumpToPage(pageNum: number, pagesEl: HTMLElement): void {
  const wrapper = pagesEl.querySelector<HTMLElement>(`.pdf-page-wrapper[data-page="${pageNum}"]`);
  wrapper?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function setupPageNav(
  input: HTMLInputElement,
  previewLimit: number,
  pagesEl: HTMLElement,
): void {
  // IntersectionObserver로 현재 뷰포트 페이지 추적
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .map((e) => Number((e.target as HTMLElement).dataset.page))
        .filter((n) => !isNaN(n));
      if (visible.length > 0) {
        input.value = String(Math.min(...visible));
      }
    },
    { root: pagesEl.parentElement, threshold: 0.3 },
  );

  pagesEl.querySelectorAll<HTMLElement>(".pdf-page-wrapper").forEach((w) => observer.observe(w));

  // 입력 필드 Enter → 해당 페이지로 이동
  input.addEventListener("change", () => {
    const n = Math.max(1, Math.min(previewLimit, parseInt(input.value) || 1));
    input.value = String(n);
    jumpToPage(n, pagesEl);
  });

  // 이전/다음 버튼
  document.getElementById("pdf-page-prev")?.addEventListener("click", () => {
    const n = Math.max(1, (parseInt(input.value) || 1) - 1);
    input.value = String(n);
    jumpToPage(n, pagesEl);
  });

  document.getElementById("pdf-page-next")?.addEventListener("click", () => {
    const n = Math.min(previewLimit, (parseInt(input.value) || 1) + 1);
    input.value = String(n);
    jumpToPage(n, pagesEl);
  });
}

// ---------------------------------------------------------------------------
// Event registration
// ---------------------------------------------------------------------------

/**
 * Tauri 네이티브 드롭 이벤트에서 절대 경로를 받아 PDF를 연다.
 * HTML File API와 달리 경로가 유지되므로 최근 파일 목록에서도 다시 열 수 있다.
 */
function registerNativeDragAndDrop(container: HTMLElement): void {
  void getCurrentWebview().onDragDropEvent((event) => {
    const dropzone = container.querySelector(".pdf-dropzone");
    if (event.payload.type === "enter" || event.payload.type === "over") {
      dropzone?.classList.add("drag-over");
      return;
    }
    if (event.payload.type === "leave") {
      dropzone?.classList.remove("drag-over");
      return;
    }

    dropzone?.classList.remove("drag-over");
    const path = event.payload.paths.find((candidate) =>
      candidate.toLowerCase().endsWith(".pdf"),
    );
    if (path) void openPdfFromPath(path);
  }).catch((error) => {
    console.warn("Tauri 네이티브 드롭 이벤트 등록 실패:", error);
  });
}

/** 브라우저 환경에서 동작하는 HTML5 드래그 앤 드롭 폴백을 등록한다. */
function registerDragAndDrop(container: HTMLElement): void {
  container.addEventListener("dragover", (e) => {
    e.preventDefault();
    container.querySelector(".pdf-dropzone")?.classList.add("drag-over");
  });

  container.addEventListener("dragleave", (e) => {
    if (!container.contains(e.relatedTarget as Node)) {
      container.querySelector(".pdf-dropzone")?.classList.remove("drag-over");
    }
  });

  container.addEventListener("drop", (e) => {
    e.preventDefault();
    container.querySelector(".pdf-dropzone")?.classList.remove("drag-over");
    const file = e.dataTransfer?.files[0];
    if (file && isPdf(file)) loadPdf(file);
  });
}

function registerOpenDialog(): void {
  document.getElementById("pdf-open-dialog-btn")?.addEventListener("click", async () => {
    const result = await openPdfFile();
    if (!result) return;
    ++openRequestVersion;
    currentPdfName = result.name;
    currentPdfBuffer = result.buffer;
    currentPdfPath = result.path;
    addRecentFile(result.name, result.path, result.buffer.byteLength);
    await openBuffer(result.buffer, result.name);
  });
}

function registerFileInput(container: HTMLElement): void {
  const input = container.querySelector<HTMLInputElement>("#pdf-file-input")!;
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file && isPdf(file)) loadPdf(file);
    input.value = "";
  });
}

/** MIME 타입 또는 확장자로 PDF 파일 여부를 판정한다. */
function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

// ---------------------------------------------------------------------------
// Zoom controls
// ---------------------------------------------------------------------------

function initZoomControls(): void {
  document.getElementById("pdf-zoom-in")?.addEventListener("click", () => {
    const idx = ZOOM_STEPS.indexOf(zoomLevel);
    if (idx < ZOOM_STEPS.length - 1) applyZoom(ZOOM_STEPS[idx + 1]);
  });
  document.getElementById("pdf-zoom-out")?.addEventListener("click", () => {
    const idx = ZOOM_STEPS.indexOf(zoomLevel);
    if (idx > 0) applyZoom(ZOOM_STEPS[idx - 1]);
  });
  document.getElementById("pdf-zoom-fit")?.addEventListener("click", () => {
    applyZoom(1.0);
  });
}

function applyZoom(level: number): void {
  zoomLevel = level;
  const label = document.getElementById("pdf-zoom-fit") as HTMLButtonElement | null;
  if (label) label.textContent = `${Math.round(level * 100)}%`;
  if (pdfDoc) rerenderAll(pdfDoc, renderVersion);
}

/**
 * 모드 선택 변경 시 docling-serve가 준비되지 않은 상태에서
 * Hybrid / OCR / Formula 모드를 선택하면 경고 아이콘을 표시한다.
 */
const MODE_STORAGE_KEY = "convertMode";

function registerModeWarning(): void {
  const select = document.getElementById("pdf-mode-select") as HTMLSelectElement | null;
  const warning = document.getElementById("pdf-mode-warning") as HTMLElement | null;
  if (!select || !warning) return;

  // 마지막으로 선택한 모드 복원
  const saved = localStorage.getItem(MODE_STORAGE_KEY);
  if (saved) select.value = saved;

  const update = () => {
    localStorage.setItem(MODE_STORAGE_KEY, select.value);
    const needsDocling = select.value !== "STANDARD";
    const notReady = needsDocling && !isDoclingReady();
    warning.style.display = notReady ? "inline" : "none";
  };

  select.addEventListener("change", update);
  // docling 준비 상태 변경 시 경고 아이콘 자동 갱신
  onDoclingReadyChange(() => update());
  // 복원된 값으로 경고 초기 상태 설정
  update();
}
