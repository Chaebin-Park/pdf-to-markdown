/**
 * status-bar.ts
 *
 * 앱 하단 상태 바 — 변환 모드, 진행 상황, 평균 처리 시간, 포트 표시.
 */

const MODE_LABELS: Record<string, string> = {
  STANDARD:    "Standard",
  HYBRID:      "Hybrid AI",
  HYBRID_FULL: "Table Quality",
  OCR:         "OCR",
  FORMULA:     "Formula",
};

export function initStatusBar(port: number): void {
  const portEl = document.getElementById("sb-port");
  if (portEl) portEl.textContent = `:${port}`;
}

export function setStatusMode(mode: string): void {
  const el = document.getElementById("sb-mode");
  if (el) el.textContent = `● ${MODE_LABELS[mode] ?? mode}`;
}

export function setStatusProgress(converted: number, total: number): void {
  const el = document.getElementById("sb-progress");
  if (!el) return;
  el.style.display = "inline";
  el.textContent = `${converted} / ${total} pages`;
}

export function setStatusDone(total: number, elapsedMs: number): void {
  const progress = document.getElementById("sb-progress");
  const avgtime  = document.getElementById("sb-avgtime");
  if (progress) {
    progress.style.display = "inline";
    progress.textContent = `✓ ${total} pages`;
  }
  if (avgtime && total > 0) {
    const avg = (elapsedMs / 1000 / total).toFixed(2);
    avgtime.style.display = "inline";
    avgtime.textContent = `avg ${avg}s/page`;
  }
}

export function setStatusIdle(): void {
  const progress = document.getElementById("sb-progress");
  const avgtime  = document.getElementById("sb-avgtime");
  if (progress) progress.style.display = "none";
  if (avgtime)  avgtime.style.display  = "none";
}
