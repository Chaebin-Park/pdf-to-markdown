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
import { refreshBBoxOverlay, clearBBox } from "./bbox-overlay";

// public/pdf.worker.min.mjs 를 직접 참조한다.
// npm install 후 postinstall 스크립트로 복사되며,
// dev(http://localhost:1420/pdf.worker.min.mjs)와
// prod(tauri://localhost/pdf.worker.min.mjs) 모두 동일 경로로 접근 가능하다.
pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

/** 현재 로드된 PDF 파일명. 외부에서 참조 가능. */
export let currentPdfName: string | null = null;

/** 현재 로드된 PDF 데이터(ArrayBuffer). 변환 API 호출 시 사용. */
export let currentPdfBuffer: ArrayBuffer | null = null;

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let pdfDoc: PDFDocumentProxy | null = null;
let resizeObserver: ResizeObserver | null = null;
let renderVersion = 0; // 재렌더링 시 이전 작업 취소용
let convertHandler: (() => void) | null = null;

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
          <label class="pdf-open-btn">
            파일 선택
            <input type="file" accept="application/pdf" style="display:none" id="pdf-file-input" />
          </label>
        </div>
      </div>
      <div class="pdf-toolbar" id="pdf-toolbar" style="display:none">
        <span class="pdf-filename" id="pdf-filename"></span>
        <span class="pdf-pagecount" id="pdf-pagecount"></span>
        <select class="pdf-mode-select" id="pdf-mode-select" title="변환 모드 선택">
          <option value="STANDARD">Standard</option>
          <option value="HYBRID">Hybrid AI</option>
          <option value="OCR">OCR</option>
          <option value="FORMULA">Formula</option>
        </select>
        <button class="pdf-convert-btn" id="pdf-convert-btn" title="Markdown으로 변환">변환</button>
        <button class="pdf-bbox-btn" id="pdf-bbox-btn" title="Bounding Box 표시" style="display:none">BBox</button>
      </div>
      <div class="pdf-pages" id="pdf-pages" style="display:none"></div>
    </div>
  `;

  registerDragAndDrop(container);
  registerFileInput(container);

  document.getElementById("pdf-convert-btn")?.addEventListener("click", () => {
    convertHandler?.();
  });
}

/**
 * PDF 변환 버튼 클릭 핸들러를 등록한다.
 * main.ts에서 converter.ts의 convertPdf를 래핑해서 전달한다.
 */
export function setConvertHandler(handler: () => void): void {
  convertHandler = handler;
}

/** 현재 선택된 변환 모드를 반환한다. */
export function getSelectedMode(): string {
  const sel = document.getElementById("pdf-mode-select") as HTMLSelectElement | null;
  return sel?.value ?? "STANDARD";
}

/**
 * BBox 버튼을 표시/숨기고 토글 핸들러를 연결한다.
 * 변환 완료 후 jsonPath가 있으면 main.ts에서 호출한다.
 */
export function setBBoxAvailable(available: boolean, onToggle?: () => void): void {
  const btn = document.getElementById("pdf-bbox-btn") as HTMLButtonElement | null;
  if (!btn) return;
  btn.style.display = available ? "inline-block" : "none";
  if (available && onToggle) {
    btn.onclick = () => {
      const active = btn.classList.toggle("active");
      btn.textContent = active ? "BBox ON" : "BBox";
      onToggle();
    };
  }
}

/**
 * 변환 진행 중 상태를 토글한다.
 * true → 버튼 비활성화 + "변환 중…" 표시
 */
export function setConverting(active: boolean): void {
  const btn = document.getElementById("pdf-convert-btn") as HTMLButtonElement | null;
  if (!btn) return;
  btn.disabled = active;
  btn.textContent = active ? "변환 중…" : "변환";
}

/** File 객체로 PDF를 로드한다. */
export async function loadPdf(file: File): Promise<void> {
  currentPdfName = file.name;
  currentPdfBuffer = await file.arrayBuffer();
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
  pages.style.display = "block";
  pages.innerHTML = "";

  // 로딩 스피너
  pages.innerHTML = `<div class="pdf-loading">
    <span class="dot"></span><span class="dot"></span><span class="dot"></span>
  </div>`;

  const loadingTask = pdfjsLib.getDocument({ data: buffer.slice(0) });
  pdfDoc = await loadingTask.promise;

  if (renderVersion !== version) return; // 취소됨

  filenameEl.textContent = name;
  pagecountEl.textContent = `${pdfDoc.numPages} pages`;
  pages.innerHTML = "";

  // ResizeObserver: 패널 너비 변경 시 재렌더링
  resizeObserver?.disconnect();
  resizeObserver = new ResizeObserver(() => {
    if (pdfDoc) rerenderAll(pdfDoc, version);
  });
  resizeObserver.observe(viewerEl);

  await renderAllPages(pdfDoc, version);
}

async function renderAllPages(doc: PDFDocumentProxy, version: number): Promise<void> {
  const pages = document.getElementById("pdf-pages") as HTMLElement;
  if (!pages) return;

  for (let i = 1; i <= doc.numPages; i++) {
    if (renderVersion !== version) return;
    const page = await doc.getPage(i);
    const canvas = buildCanvas(page, pages.clientWidth);
    const wrapper = document.createElement("div");
    wrapper.className = "pdf-page-wrapper";
    wrapper.dataset.page = String(i);
    wrapper.appendChild(canvas);
    pages.appendChild(wrapper);
    await renderPage(page, canvas);
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
  const scale = Math.max(0.5, containerWidth / baseViewport.width);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  canvas.dataset.scale = String(scale);
  return canvas;
}

async function renderPage(page: PDFPageProxy, canvas: HTMLCanvasElement): Promise<void> {
  try {
    const scale = Number(canvas.dataset.scale);
    const viewport = page.getViewport({ scale });
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
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
// Event registration
// ---------------------------------------------------------------------------

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
