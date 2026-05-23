import { getRecentFiles, openPdfFromPath } from "./pdf-viewer";

export function mountFilesPanel(container: HTMLElement): void {
  container.innerHTML = `
    <div class="fp-section">
      <button class="fp-open-btn" id="fp-open-btn">Open PDF… <kbd>⌘O</kbd></button>
    </div>
    <div class="fp-section fp-recent" id="fp-recent"></div>
  `;

  document.getElementById("fp-open-btn")?.addEventListener("click", () => {
    document.getElementById("pdf-open-dialog-btn")?.click();
  });

  renderRecentList(container.querySelector<HTMLElement>("#fp-recent")!);
}

function renderRecentList(el: HTMLElement): void {
  const list = getRecentFiles();
  if (list.length === 0) {
    el.innerHTML = `<p class="fp-empty">최근 열었던 파일이 없습니다.</p>`;
    return;
  }
  el.innerHTML = `<p class="fp-section-label">Recent</p>` +
    list.map((r, i) => `
      <button class="fp-file-item" data-idx="${i}" title="${r.path}">
        <svg class="fp-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span class="fp-name">${r.name}</span>
      </button>
    `).join("");

  el.querySelectorAll<HTMLButtonElement>(".fp-file-item").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = parseInt(btn.dataset.idx ?? "0", 10);
      const file = getRecentFiles()[idx];
      if (!file) return;
      btn.disabled = true;
      try {
        await openPdfFromPath(file.path);
      } catch {
        btn.disabled = false;
        const nameEl = btn.querySelector(".fp-name");
        if (nameEl) nameEl.textContent = `⚠ ${file.name} (파일 없음)`;
      }
    });
  });
}
