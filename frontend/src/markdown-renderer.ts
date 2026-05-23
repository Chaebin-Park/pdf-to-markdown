/**
 * markdown-renderer.ts
 *
 * 우측 패널 Markdown 렌더러.
 * - marked + highlight.js 기반 HTML 렌더링
 * - 스트리밍 업데이트 지원 (append / replace 모드)
 * - 변환 중 상태(커서 깜박임) 및 빈 상태 플레이스홀더
 */

import { marked, Renderer } from "marked";
import hljs from "highlight.js";
import renderMathInElement from "katex/contrib/auto-render";
import { saveMarkdownFile } from "./tauri-bridge";
import { currentPdfName } from "./pdf-viewer";

// ---------------------------------------------------------------------------
// marked 설정
// ---------------------------------------------------------------------------

const renderer = new Renderer();

// 코드 블록: highlight.js로 구문 하이라이팅
renderer.code = ({ text, lang }) => {
  const language = lang && hljs.getLanguage(lang) ? lang : "plaintext";
  const highlighted = hljs.highlight(text, { language }).value;
  return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`;
};

// 헤딩: Outline 패널 앵커 링크용 id 추가
renderer.heading = ({ text, depth }) => {
  const id = slugify(text);
  return `<h${depth} id="${id}">${text}</h${depth}>\n`;
};

marked.setOptions({ renderer });

/** 헤딩 텍스트를 DOM id로 변환한다. */
export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-");
}

// ---------------------------------------------------------------------------
// DOM IDs
// ---------------------------------------------------------------------------

const ID = {
  root: "md-renderer",
  toolbar: "md-toolbar",
  copyBtn: "md-copy-btn",
  saveBtn: "md-save-btn",
  content: "md-content",
  previewPane: "md-preview-pane",
  sourcePane: "md-source-pane",
  placeholder: "md-placeholder",
} as const;

type ViewMode = "preview" | "source" | "split";

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let rawMarkdown = "";
let viewMode: ViewMode = "preview";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** 우측 패널에 Markdown 렌더러를 마운트한다. */
export function mountMarkdownRenderer(container: HTMLElement): void {
  container.innerHTML = `
    <div class="md-renderer" id="${ID.root}">
      <div class="md-toolbar" id="${ID.toolbar}" style="display:none">
        <div class="mdt-tabs">
          <button class="mdt-tab active" id="md-tab-preview">Preview</button>
          <button class="mdt-tab" id="md-tab-source">Source</button>
          <button class="mdt-tab" id="md-tab-split">Split</button>
        </div>
        <span class="mdt-spacer"></span>
        <button class="md-btn" id="${ID.copyBtn}" title="클립보드에 복사">Copy <kbd>⌘C</kbd></button>
        <button class="md-btn" id="${ID.saveBtn}" title="마크다운 파일로 저장">Save <kbd>⌘S</kbd></button>
      </div>
      <div class="md-help-bar">
        <button class="md-settings-btn" id="md-settings-btn" title="설정">⚙</button>
        <button class="md-help-btn" id="md-help-btn" title="사용 방법 보기">?</button>
      </div>
      <div class="md-placeholder" id="${ID.placeholder}">
        <p>PDF를 열고 변환하면<br>Markdown이 여기 표시됩니다.</p>
      </div>
      <div class="md-content mode-preview" id="${ID.content}" style="display:none">
        <div class="md-preview-pane" id="${ID.previewPane}"></div>
        <div class="md-source-pane"  id="${ID.sourcePane}"  style="display:none"></div>
      </div>
    </div>
  `;

  document.getElementById(ID.copyBtn)?.addEventListener("click", handleCopy);
  document.getElementById(ID.saveBtn)?.addEventListener("click", handleSave);
  document.getElementById("md-tab-preview")?.addEventListener("click", () => setViewMode("preview"));
  document.getElementById("md-tab-source")?.addEventListener("click", () => setViewMode("source"));
  document.getElementById("md-tab-split")?.addEventListener("click", () => setViewMode("split"));
}

/** 도움말(?) 버튼 클릭 핸들러를 등록한다. main.ts에서 showOnboarding을 연결한다. */
export function setHelpHandler(cb: () => void): void {
  document.getElementById("md-help-btn")?.addEventListener("click", cb);
}

/** 설정(⚙) 버튼 클릭 핸들러를 등록한다. main.ts에서 showSettings를 연결한다. */
export function setSettingsHandler(cb: () => void): void {
  document.getElementById("md-settings-btn")?.addEventListener("click", cb);
}

/** 현재 로드된 raw Markdown 텍스트를 반환한다. */
export function getRawMarkdown(): string { return rawMarkdown; }

/**
 * Markdown 텍스트를 설정하고 렌더링한다.
 * 스트리밍이 완료된 후 최종본을 확정할 때 사용한다.
 */
export function setMarkdown(md: string): void {
  rawMarkdown = md;
  renderContent();
  showPanel();
}

/**
 * Markdown 텍스트를 추가(append)하고 즉시 재렌더링한다.
 * SSE 스트리밍 중 청크 단위로 호출한다.
 */
export function appendMarkdown(chunk: string): void {
  rawMarkdown += chunk;
  renderContent();
  if (rawMarkdown.length > 0) showPanel();
}

/** 렌더러를 초기 빈 상태로 리셋한다. */
export function clearMarkdown(): void {
  rawMarkdown = "";
  viewMode = "preview";
  const content = document.getElementById(ID.content) as HTMLElement | null;
  const previewPane = document.getElementById(ID.previewPane) as HTMLElement | null;
  const sourcePane = document.getElementById(ID.sourcePane) as HTMLElement | null;
  const placeholder = document.getElementById(ID.placeholder) as HTMLElement | null;
  const toolbar = document.getElementById(ID.toolbar) as HTMLElement | null;
  if (content) {
    content.style.display = "none";
    content.className = "md-content mode-preview";
  }
  if (previewPane) previewPane.innerHTML = "";
  if (sourcePane) { sourcePane.innerHTML = ""; sourcePane.style.display = "none"; }
  if (placeholder) placeholder.style.display = "flex";
  if (toolbar) toolbar.style.display = "none";
  updateTabActive();
}

/** 스트리밍 중임을 나타내는 커서를 추가/제거한다. */
export function setStreaming(active: boolean): void {
  const pane = document.getElementById(ID.previewPane);
  if (!pane) return;
  pane.classList.toggle("streaming", active);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function renderContent(): void {
  const previewPane = document.getElementById(ID.previewPane) as HTMLElement | null;
  const sourcePane = document.getElementById(ID.sourcePane) as HTMLElement | null;

  if (viewMode !== "source" && previewPane) {
    previewPane.innerHTML = marked.parse(rawMarkdown) as string;
    renderMathInElement(previewPane, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
      ],
      throwOnError: false,
    });
  }

  if (viewMode !== "preview" && sourcePane) {
    sourcePane.innerHTML = `<pre class="md-raw">${escapeHtml(rawMarkdown)}</pre>`;
  }
}

function showPanel(): void {
  const toolbar = document.getElementById(ID.toolbar) as HTMLElement | null;
  const content = document.getElementById(ID.content) as HTMLElement | null;
  const placeholder = document.getElementById(ID.placeholder) as HTMLElement | null;
  if (toolbar) toolbar.style.display = "flex";
  if (content) {
    content.style.display = "block";
    applyViewMode();
  }
  if (placeholder) placeholder.style.display = "none";
  updateTabActive();
}

function handleCopy(): void {
  if (!rawMarkdown) return;
  navigator.clipboard.writeText(rawMarkdown).then(() => {
    const btn = document.getElementById(ID.copyBtn) as HTMLButtonElement | null;
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = orig;
      btn.disabled = false;
    }, 1500);
  });
}

async function handleSave(): Promise<void> {
  if (!rawMarkdown) return;
  const btn = document.getElementById(ID.saveBtn) as HTMLButtonElement | null;
  if (!btn) return;

  const defaultName = currentPdfName
    ? currentPdfName.replace(/\.pdf$/i, ".md")
    : "output.md";

  btn.disabled = true;
  btn.textContent = "Saving…";

  try {
    const saved = await saveMarkdownFile(rawMarkdown, defaultName);
    if (saved) {
      btn.textContent = "Saved!";
      setTimeout(() => {
        btn.textContent = "Save";
        btn.disabled = false;
      }, 1500);
    } else {
      // 사용자가 다이얼로그를 취소함
      btn.textContent = "Save";
      btn.disabled = false;
    }
  } catch {
    btn.textContent = "Save";
    btn.disabled = false;
  }
}

function setViewMode(mode: ViewMode): void {
  viewMode = mode;
  updateTabActive();
  applyViewMode();
  renderContent();
}

function updateTabActive(): void {
  (["preview", "source", "split"] as ViewMode[]).forEach((m) => {
    document.getElementById(`md-tab-${m}`)?.classList.toggle("active", m === viewMode);
  });
}

function applyViewMode(): void {
  const content = document.getElementById(ID.content) as HTMLElement | null;
  const previewPane = document.getElementById(ID.previewPane) as HTMLElement | null;
  const sourcePane = document.getElementById(ID.sourcePane) as HTMLElement | null;
  if (!content || !previewPane || !sourcePane) return;

  content.className = `md-content mode-${viewMode}`;
  previewPane.style.display = viewMode !== "source" ? "block" : "none";
  sourcePane.style.display  = viewMode !== "preview" ? "block" : "none";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
