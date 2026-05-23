import { getPdfDoc } from "./pdf-viewer";

interface SearchResult { page: number; snippet: string; matchStart: number; matchEnd: number; }

export function mountSearchPanel(container: HTMLElement): void {
  container.innerHTML = `
    <div class="srp-bar">
      <input class="srp-input" id="srp-input" type="text" placeholder="검색어 입력…" autocomplete="off">
      <span class="srp-count" id="srp-count"></span>
    </div>
    <div class="srp-results" id="srp-results"></div>
  `;

  const input = container.querySelector<HTMLInputElement>("#srp-input")!;
  const results = container.querySelector<HTMLElement>("#srp-results")!;
  const count = container.querySelector<HTMLElement>("#srp-count")!;

  let debounce: ReturnType<typeof setTimeout>;
  input.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => runSearch(input.value.trim(), results, count), 300);
  });
  input.focus();
}

async function runSearch(query: string, results: HTMLElement, count: HTMLElement): Promise<void> {
  results.innerHTML = "";
  count.textContent = "";
  if (query.length < 2) return;

  const doc = getPdfDoc();
  if (!doc) { results.innerHTML = `<p class="sp-empty">PDF를 먼저 열어주세요.</p>`; return; }

  const found: SearchResult[] = [];
  const lower = query.toLowerCase();

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const text = content.items.map((item: any) => item.str).join(" ");
    const textLower = text.toLowerCase();
    let idx = textLower.indexOf(lower);
    while (idx !== -1 && found.length < 200) {
      found.push({ page: p, snippet: text, matchStart: idx, matchEnd: idx + query.length });
      idx = textLower.indexOf(lower, idx + 1);
    }
  }

  count.textContent = found.length ? `${found.length}건` : "결과 없음";
  if (!found.length) return;

  results.innerHTML = found.map((r, i) => {
    const pre = r.snippet.slice(Math.max(0, r.matchStart - 30), r.matchStart);
    const match = r.snippet.slice(r.matchStart, r.matchEnd);
    const post = r.snippet.slice(r.matchEnd, r.matchEnd + 30);
    return `<button class="srp-item" data-idx="${i}" data-page="${r.page}">
      <span class="srp-page">p.${r.page}</span>
      <span class="srp-snippet">…${pre}<mark>${match}</mark>${post}…</span>
    </button>`;
  }).join("");

  results.querySelectorAll<HTMLButtonElement>(".srp-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pageNum = parseInt(btn.dataset.page ?? "1", 10);
      const wrapper = document.querySelector<HTMLElement>(
        `.pdf-page-wrapper[data-page="${pageNum}"]`,
      );
      wrapper?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}
