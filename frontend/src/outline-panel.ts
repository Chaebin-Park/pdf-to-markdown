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

  const pane = document.getElementById("md-preview-pane");
  container.querySelectorAll<HTMLButtonElement>(".op-item").forEach((btn, i) => {
    btn.addEventListener("click", () => {
      if (!pane) return;
      const allHeadings = pane.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6");
      const target = allHeadings[i];
      if (!target) return;
      const paneTop = pane.getBoundingClientRect().top;
      const targetTop = target.getBoundingClientRect().top;
      pane.scrollTop += targetTop - paneTop - 16;
    });
  });

  initActiveHighlight(container);
}

function initActiveHighlight(container: HTMLElement): void {
  const pane = document.getElementById("md-preview-pane");
  if (!pane) return;

  const allHeadings = Array.from(pane.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"));
  if (allHeadings.length === 0) return;

  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>(".op-item"));

  const setActive = (idx: number) => {
    buttons.forEach((btn, i) => btn.classList.toggle("op-active", i === idx));
  };

  observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length > 0) {
        const idx = allHeadings.indexOf(visible[0].target as HTMLElement);
        if (idx !== -1) setActive(idx);
      }
    },
    { root: pane, threshold: 0, rootMargin: "0px 0px -80% 0px" },
  );

  allHeadings.forEach((el) => observer!.observe(el));
}

function parseHeadings(md: string): Heading[] {
  const headings: Heading[] = [];
  for (const line of md.split("\n")) {
    const m = line.match(/^(#{1,6})\s+(.+)/);
    if (m) headings.push({ depth: m[1].length, text: m[2].trim(), id: slugify(m[2].trim()) });
  }
  return headings;
}
