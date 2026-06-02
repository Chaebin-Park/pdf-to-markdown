import {
  getCurrentPdfPath,
  getRecentFiles,
  openPdfFromPath,
  RECENT_CHANGED_EVENT,
} from "./pdf-viewer";

let recentChangeController: AbortController | null = null;

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

  const recentEl = container.querySelector<HTMLElement>("#fp-recent")!;
  renderRecentList(recentEl);

  recentChangeController?.abort();
  recentChangeController = new AbortController();
  window.addEventListener(
    RECENT_CHANGED_EVENT,
    () => renderRecentList(recentEl),
    { signal: recentChangeController.signal },
  );
}

function renderRecentList(el: HTMLElement): void {
  const list = getRecentFiles();
  const currentPath = getCurrentPdfPath();
  if (list.length === 0) {
    el.innerHTML = `<p class="fp-empty">최근 열었던 파일이 없습니다.</p>`;
    return;
  }
  el.innerHTML = `<p class="fp-section-label">Recent</p>` +
    list.map((r) => {
      const meta: string[] = [];
      if (r.pages) meta.push(`${r.pages}p`);
      if (r.size) meta.push(`${Math.round(r.size / 1024)}KB`);
      return `
        <button class="fp-file-item${r.path === currentPath ? " active" : ""}" data-path="${encodeURIComponent(r.path)}" title="${r.path}">
          <svg class="fp-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span class="fp-name">${r.name}</span>
          ${meta.length ? `<span class="fp-meta">${meta.join(" · ")}</span>` : ""}
        </button>
      `;
    }).join("");

  el.querySelectorAll<HTMLButtonElement>(".fp-file-item").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const path = decodeURIComponent(btn.dataset.path ?? "");
      const file = getRecentFiles().find((candidate) => candidate.path === path);
      if (!file) return;
      btn.disabled = true;
      try {
        await openPdfFromPath(file.path, false);
      } catch {
        const nameEl = btn.querySelector(".fp-name");
        if (nameEl) nameEl.textContent = `⚠ ${file.name} (파일 없음)`;
      } finally {
        // 로드 중 중복 클릭만 막고, 성공한 Recent 항목은 다시 선택할 수 있게 한다.
        btn.disabled = false;
      }
    });
  });
}
