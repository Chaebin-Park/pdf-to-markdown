import { getPdfDoc } from "./pdf-viewer";

const THUMB_SCALE = 0.18;
let thumbObserver: IntersectionObserver | null = null;

export function mountPagesPanel(container: HTMLElement): void {
  thumbObserver?.disconnect();
  thumbObserver = null;

  const doc = getPdfDoc();
  if (!doc) {
    container.innerHTML = `<p class="sp-empty">PDF를 먼저 열어주세요.</p>`;
    return;
  }

  container.innerHTML = `<div class="pp-list" id="pp-list"></div>`;
  const list = container.querySelector<HTMLElement>("#pp-list")!;

  renderThumbnails(doc, list);
  initPageHighlight(list);
}

async function renderThumbnails(
  doc: { numPages: number; getPage: (n: number) => Promise<any> },
  list: HTMLElement,
): Promise<void> {
  for (let i = 1; i <= doc.numPages; i++) {
    const item = document.createElement("button");
    item.className = "pp-item";
    item.dataset.page = String(i);
    item.innerHTML = `
      <canvas class="pp-canvas"></canvas>
      <span class="pp-num">${i}</span>
    `;
    item.addEventListener("click", () => scrollToPage(i));
    list.appendChild(item);

    // 썸네일 비동기 렌더링
    renderThumb(doc, i, item.querySelector<HTMLCanvasElement>(".pp-canvas")!);
  }
}

async function renderThumb(
  doc: { getPage: (n: number) => Promise<any> },
  pageNum: number,
  canvas: HTMLCanvasElement,
): Promise<void> {
  try {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: THUMB_SCALE });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
  } catch {
    // 썸네일 렌더 실패는 무시 (페이지 제한 초과 등)
  }
}

function scrollToPage(pageNum: number): void {
  const wrapper = document.querySelector<HTMLElement>(
    `.pdf-page-wrapper[data-page="${pageNum}"]`,
  );
  wrapper?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function initPageHighlight(list: HTMLElement): void {
  const pdfPages = document.getElementById("pdf-pages");
  if (!pdfPages) return;

  const setActive = (pageNum: string) => {
    list.querySelectorAll<HTMLButtonElement>(".pp-item").forEach((btn) => {
      btn.classList.toggle("pp-active", btn.dataset.page === pageNum);
    });
  };

  thumbObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length > 0) {
        const pageNum = (visible[0].target as HTMLElement).dataset.page ?? "";
        setActive(pageNum);
        // 패널 내 해당 썸네일로 스크롤
        const thumb = list.querySelector<HTMLElement>(`.pp-item[data-page="${pageNum}"]`);
        thumb?.scrollIntoView({ block: "nearest" });
      }
    },
    { root: pdfPages, threshold: 0.3 },
  );

  pdfPages.querySelectorAll<HTMLElement>(".pdf-page-wrapper").forEach((w) => {
    thumbObserver!.observe(w);
  });
}
