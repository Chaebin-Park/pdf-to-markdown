/**
 * bbox-overlay.ts
 *
 * opendataloader-pdf JSON 출력의 bounding box를 PDF 페이지 캔버스 위에 오버레이한다.
 *
 * JSON 구조:
 *   { "file name", "number of pages", "kids": [ element, ... ] }
 *
 * 각 element:
 *   { "type", "page number", "bounding box": [leftX, bottomY, rightX, topY],
 *     "content"?, "kids"?, "rows"?, "cells"?, "list items"? }
 *
 * 좌표계 변환:
 *   PDF.js가 렌더링에 사용한 viewport transform을 canvas dataset에서 읽어
 *   PDF 좌표를 CSS 픽셀 좌표로 변환한다.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RawElement {
  type?: string;
  "page number"?: number;
  "bounding box"?: [number, number, number, number];
  content?: string;
  "hidden text"?: boolean;
  kids?: RawElement[];
  rows?: RawElement[];
  cells?: RawElement[];
  "list items"?: RawElement[];
}

export interface SafetyItem {
  type: string;
  pageNumber: number;
  content: string;
}

export interface BBoxItem {
  type: string;
  pageNumber: number;
  bbox: [number, number, number, number]; // [leftX, bottomY, rightX, topY]
  content: string;
  meta?: string; // 타입별 부가 정보 (예: "8 cols × 10 rows", "level 2")
}

// ---------------------------------------------------------------------------
// Color map (type → fill color, border is same at higher opacity)
// ---------------------------------------------------------------------------

const TYPE_FILL: Record<string, string> = {
  paragraph: "rgba(78,201,176,0.18)",
  heading: "rgba(255,200,50,0.22)",
  table: "rgba(200,100,255,0.18)",
  "table row": "rgba(180,80,240,0.1)",
  "table cell": "rgba(160,60,220,0.08)",
  list: "rgba(100,180,255,0.18)",
  "list item": "rgba(80,160,235,0.1)",
  image: "rgba(255,150,100,0.22)",
  formula: "rgba(255,100,150,0.22)",
  "text chunk": "rgba(200,200,200,0.08)",
};
const DEFAULT_FILL = "rgba(200,200,200,0.1)";

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let items: BBoxItem[] = [];
let hiddenItems: SafetyItem[] = [];
let visible = false;
let orderVisible = false;

// ---------------------------------------------------------------------------
// Floating tooltip
// ---------------------------------------------------------------------------

let tooltipEl: HTMLDivElement | null = null;

function getTooltip(): HTMLDivElement {
  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.id = "bbox-tooltip";
    tooltipEl.style.cssText =
      "position:fixed;background:rgba(20,20,20,0.88);color:#e8e8e8;font-size:11px;" +
      "font-family:monospace;padding:3px 8px;border-radius:4px;pointer-events:none;" +
      "display:none;z-index:9999;white-space:nowrap;";
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

function attachTooltip(el: HTMLDivElement, label: string): void {
  const tip = getTooltip();
  el.addEventListener("mouseenter", () => {
    tip.textContent = label;
    tip.style.display = "block";
  });
  el.addEventListener("mousemove", (e: MouseEvent) => {
    tip.style.left = `${e.clientX + 14}px`;
    tip.style.top = `${e.clientY - 28}px`;
  });
  el.addEventListener("mouseleave", () => {
    tip.style.display = "none";
  });
}

const TOP_LEVEL_TYPES = new Set(["paragraph", "heading", "table", "list", "image", "formula"]);

type ViewportTransform = [number, number, number, number, number, number];

interface CanvasRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function parseNumberList(value: string | undefined, expectedLength: number): number[] | null {
  if (!value) return null;
  const numbers = value.split(",").map((part) => Number(part));
  if (numbers.length !== expectedLength || numbers.some((n) => !Number.isFinite(n))) return null;
  return numbers;
}

function applyViewportTransform(x: number, y: number, transform: ViewportTransform): [number, number] {
  const [a, b, c, d, e, f] = transform;
  return [a * x + c * y + e, b * x + d * y + f];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function bboxToCanvasRect(
  bbox: [number, number, number, number],
  transform: ViewportTransform,
  viewportW: number,
  viewportH: number,
  canvasW: number,
  canvasH: number,
): CanvasRect | null {
  const [lx, by, rx, ty] = bbox;
  const points = [
    applyViewportTransform(lx, by, transform),
    applyViewportTransform(rx, by, transform),
    applyViewportTransform(rx, ty, transform),
    applyViewportTransform(lx, ty, transform),
  ];
  const cssScaleX = canvasW / viewportW;
  const cssScaleY = canvasH / viewportH;
  const xs = points.map(([x]) => x * cssScaleX);
  const ys = points.map(([, y]) => y * cssScaleY);

  const left = clamp(Math.min(...xs), 0, canvasW);
  const top = clamp(Math.min(...ys), 0, canvasH);
  const right = clamp(Math.max(...xs), 0, canvasW);
  const bottom = clamp(Math.max(...ys), 0, canvasH);
  const w = right - left;
  const h = bottom - top;
  if (w <= 0 || h <= 0) return null;
  return { x: left, y: top, w, h };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * opendataloader-pdf JSON 문자열을 파싱하여 내부 bbox 목록을 구성한다.
 * 파싱 완료 후 현재 visible 상태이면 즉시 렌더링한다.
 */
export function parseBBoxJson(json: string): void {
  items = [];
  hiddenItems = [];
  try {
    const doc = JSON.parse(json);
    extractItems(doc.kids ?? []);
  } catch (e) {
    console.warn("bbox JSON 파싱 실패:", e);
  }
  if (visible) renderOverlays();
}

/** safety 필터로 감지된 숨겨진 텍스트 항목 목록을 반환한다. */
export function getHiddenItems(): SafetyItem[] {
  return hiddenItems;
}

/** 파싱된 전체 bbox 항목 목록을 반환한다. */
export function getBBoxItems(): BBoxItem[] {
  return items;
}

/** 오버레이를 표시한다. */
export function showBBoxOverlay(): void {
  visible = true;
  renderOverlays();
}

/** 오버레이를 숨긴다. */
export function hideBBoxOverlay(): void {
  visible = false;
  clearOverlays();
}

/** 오버레이 토글. 현재 가시성의 반전값을 반환한다. */
export function toggleBBoxOverlay(): boolean {
  visible ? hideBBoxOverlay() : showBBoxOverlay();
  return visible;
}

/** 읽기 순서 chip 오버레이 토글. */
export function toggleOrderOverlay(): boolean {
  orderVisible = !orderVisible;
  renderOverlays();
  return orderVisible;
}

/** PDF 재렌더링 후 오버레이를 갱신한다 (ResizeObserver 콜백 등에서 사용). */
export function refreshBBoxOverlay(): void {
  if (visible || orderVisible) renderOverlays();
}

/** 모든 bbox 데이터와 오버레이를 초기화한다. */
export function clearBBox(): void {
  items = [];
  visible = false;
  orderVisible = false;
  clearOverlays();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderOverlays(): void {
  clearOverlays();
  if ((!visible && !orderVisible) || items.length === 0) return;

  // 페이지별로 그룹화
  const byPage = new Map<number, BBoxItem[]>();
  for (const item of items) {
    const list = byPage.get(item.pageNumber) ?? [];
    list.push(item);
    byPage.set(item.pageNumber, list);
  }

  const wrappers = document.querySelectorAll<HTMLDivElement>(".pdf-page-wrapper");
  for (const wrapper of Array.from(wrappers)) {
    const pageNum = Number(wrapper.dataset.page);
    const pageItems = byPage.get(pageNum);
    if (!pageItems?.length) continue;

    const canvas = wrapper.querySelector<HTMLCanvasElement>("canvas");
    if (!canvas) continue;

    // CSS 픽셀 기준 캔버스 크기와 PDF.js viewport 변환값을 같은 기준으로 사용한다.
    const canvasBox = canvas.getBoundingClientRect();
    const canvasW = canvasBox.width || parseFloat(canvas.style.width);
    const canvasH = canvasBox.height || parseFloat(canvas.style.height);
    const viewportW = Number(canvas.dataset.viewportWidth);
    const viewportH = Number(canvas.dataset.viewportHeight);
    const transformValues = parseNumberList(canvas.dataset.viewportTransform, 6);
    if (!canvasW || !canvasH || !viewportW || !viewportH || !transformValues) continue;
    const transform = transformValues as ViewportTransform;

    const layer = document.createElement("div");
    layer.className = "bbox-layer";
    layer.style.cssText =
      `position:absolute;top:${canvas.offsetTop}px;left:${canvas.offsetLeft}px;` +
      `width:${canvasW}px;height:${canvasH}px;pointer-events:none;`;

    let orderIdx = 0;
    for (const item of pageItems) {
      const rectBounds = bboxToCanvasRect(item.bbox, transform, viewportW, viewportH, canvasW, canvasH);
      if (!rectBounds) continue;
      const { x, y, w, h } = rectBounds;

      if (visible) {
        const fill = TYPE_FILL[item.type] ?? DEFAULT_FILL;
        const border = fill.replace(/[\d.]+\)$/, "0.55)");
        const rect = document.createElement("div");
        rect.className = "bbox-rect";
        rect.dataset.bboxType = item.type;
        const label = item.meta ? `${item.type} · ${item.meta}` : `${item.type} · ${item.content.slice(0, 100)}`;
        attachTooltip(rect, label);
        rect.style.cssText = `
          position:absolute;
          left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;
          width:${w.toFixed(1)}px;height:${h.toFixed(1)}px;
          background:${fill};border:1px solid ${border};
          box-sizing:border-box;pointer-events:auto;cursor:default;
        `;
        layer.appendChild(rect);
      }

      if (orderVisible && TOP_LEVEL_TYPES.has(item.type)) {
        orderIdx++;
        const chip = document.createElement("div");
        chip.className = "order-chip";
        chip.textContent = String(orderIdx);
        chip.title = `#${orderIdx} [${item.type}] ${item.content.slice(0, 80)}`;
        chip.style.cssText = `position:absolute;left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;`;
        layer.appendChild(chip);
      }
    }

    wrapper.appendChild(layer);
  }
}

function clearOverlays(): void {
  document.querySelectorAll(".bbox-layer").forEach((el) => el.remove());
}

// ---------------------------------------------------------------------------
// JSON traversal (recursive)
// ---------------------------------------------------------------------------

function extractItems(elements: RawElement[]): void {
  for (const el of elements) {
    if (el["bounding box"]) {
      items.push({
        type: el.type ?? "unknown",
        pageNumber: el["page number"] ?? 1,
        bbox: el["bounding box"]!,
        content: el.content ?? el.type ?? "",
        meta: buildMeta(el),
      });
    }
    if (el["hidden text"] === true) {
      hiddenItems.push({
        type: el.type ?? "unknown",
        pageNumber: el["page number"] ?? 1,
        content: el.content ?? "",
      });
    }
    if (el.kids) extractItems(el.kids);
    if (el.rows) extractItems(el.rows);
    if (el.cells) extractItems(el.cells);
    if (el["list items"]) extractItems(el["list items"]);
  }
}

function buildMeta(el: RawElement): string | undefined {
  const type = el.type ?? "";
  if (type === "table") {
    const rows = el.rows?.length ?? 0;
    const cols = el.rows?.[0]?.cells?.length ?? 0;
    if (rows > 0) return `${cols} cols × ${rows} rows`;
  }
  if (type === "heading") {
    const level = (el.content?.match(/^(#{1,6})\s/) ?? [])[1]?.length;
    if (level) return `level ${level}`;
  }
  if (type === "list") {
    const count = el["list items"]?.length ?? 0;
    if (count > 0) return `${count} items`;
  }
  return undefined;
}
