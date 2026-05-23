import { getRawMarkdown, slugify } from "./markdown-renderer";

interface Heading { depth: number; text: string; id: string; }

let observer: IntersectionObserver | null = null;

export function mountOutlinePanel(container: HTMLElement): void {
  observer?.disconnect();
  observer = null;

  const headings = parseHeadings(getRawMarkdown());
  if (headings.length === 0) {
    container.innerHTML = `<p class="sp-empty">변환 결과가 없거나 헤딩이 없습니다.</p>`;
    return;
  }

  const minDepth = Math.min(...headings.map((h) => h.depth));
  container.innerHTML = headings.map((h) => {
    const indent = (h.depth - minDepth) * 12;
    return `<button class="op-item" data-id="${h.id}" style="padding-left:${10 + indent}px" title="${h.text}">
      <span class="op-level">H${h.depth}</span>
      <span class="op-text">${h.text}</span>
    </button>`;
  }).join("");

  container.querySelectorAll<HTMLButtonElement>(".op-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = document.getElementById(btn.dataset.id ?? "");
      if (!target) return;
      const pane = document.getElementById("md-preview-pane");
      if (pane) {
        const paneTop = pane.getBoundingClientRect().top;
        const targetTop = target.getBoundingClientRect().top;
        pane.scrollTop += targetTop - paneTop - 16;
      } else {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });

  initActiveHighlight(container, headings);
}

function initActiveHighlight(container: HTMLElement, headings: Heading[]): void {
  const pane = document.getElementById("md-preview-pane");
  if (!pane) return;

  const setActive = (id: string) => {
    container.querySelectorAll<HTMLButtonElement>(".op-item").forEach((btn) => {
      btn.classList.toggle("op-active", btn.dataset.id === id);
    });
  };

  // 현재 뷰포트 상단에 가장 가까운 헤딩을 활성화
  observer = new IntersectionObserver(
    (entries) => {
      // 뷰포트 안에 들어온 헤딩 중 가장 위쪽 항목을 활성
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length > 0) setActive(visible[0].target.id);
    },
    { root: pane, threshold: 0, rootMargin: "0px 0px -80% 0px" },
  );

  headings.forEach((h) => {
    const el = pane.querySelector(`#${CSS.escape(h.id)}`);
    if (el) observer!.observe(el);
  });
}

function parseHeadings(md: string): Heading[] {
  const headings: Heading[] = [];
  for (const line of md.split("\n")) {
    const m = line.match(/^(#{1,6})\s+(.+)/);
    if (m) headings.push({ depth: m[1].length, text: m[2].trim(), id: slugify(m[2].trim()) });
  }
  return headings;
}
