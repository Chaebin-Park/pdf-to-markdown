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

let jvmPollTimer: ReturnType<typeof setInterval> | null = null;

/** Ktor /metrics 엔드포인트를 주기적으로 조회하여 JVM 힙 사용량을 상태 바에 표시한다. */
export function startJvmPolling(baseUrl: string, intervalMs = 8000): void {
  if (jvmPollTimer !== null) return;
  const update = async () => {
    try {
      const res = await fetch(`${baseUrl}/metrics`);
      if (!res.ok) return;
      const { heapUsed, heapMax } = await res.json() as { heapUsed: number; heapMax: number };
      const el = document.getElementById("sb-jvm");
      if (el) {
        el.style.display = "inline";
        el.textContent = `JVM ${heapUsed}/${heapMax}MB`;
      }
    } catch {
      // 서버 미준비 상태는 조용히 무시
    }
  };
  update();
  jvmPollTimer = setInterval(update, intervalMs);
}

export function setStatusSafety(count: number): void {
  const el = document.getElementById("sb-safety");
  if (!el) return;
  el.style.display = "inline";
  if (count > 0) {
    el.textContent = `⚠ ${count} filtered`;
    el.className = "sb-item sb-safety-warn";
  } else {
    el.textContent = "✓ Safety";
    el.className = "sb-item sb-safety-ok";
  }
}
