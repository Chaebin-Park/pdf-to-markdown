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

marked.setOptions({ renderer });

// ---------------------------------------------------------------------------
// DOM IDs
// ---------------------------------------------------------------------------

const ID = {
  root: "md-renderer",
  toolbar: "md-toolbar",
  copyBtn: "md-copy-btn",
  rawBtn: "md-raw-btn",
  content: "md-content",
  placeholder: "md-placeholder",
} as const;

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let rawMarkdown = "";
let showRaw = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** 우측 패널에 Markdown 렌더러를 마운트한다. */
export function mountMarkdownRenderer(container: HTMLElement): void {
  container.innerHTML = `
    <div class="md-renderer" id="${ID.root}">
      <div class="md-toolbar" id="${ID.toolbar}" style="display:none">
        <button class="md-btn" id="${ID.rawBtn}" title="원문 보기">Raw</button>
        <button class="md-btn" id="${ID.copyBtn}" title="클립보드에 복사">Copy</button>
      </div>
      <div class="md-help-bar">
        <button class="md-settings-btn" id="md-settings-btn" title="설정">⚙</button>
        <button class="md-help-btn" id="md-help-btn" title="사용 방법 보기">?</button>
      </div>
      <div class="md-placeholder" id="${ID.placeholder}">
        <p>PDF를 열고 변환하면<br>Markdown이 여기 표시됩니다.</p>
      </div>
      <div class="md-content" id="${ID.content}" style="display:none"></div>
    </div>
  `;

  document.getElementById(ID.copyBtn)?.addEventListener("click", handleCopy);
  document.getElementById(ID.rawBtn)?.addEventListener("click", handleToggleRaw);
}

/** 도움말(?) 버튼 클릭 핸들러를 등록한다. main.ts에서 showOnboarding을 연결한다. */
export function setHelpHandler(cb: () => void): void {
  document.getElementById("md-help-btn")?.addEventListener("click", cb);
}

/** 설정(⚙) 버튼 클릭 핸들러를 등록한다. main.ts에서 showSettings를 연결한다. */
export function setSettingsHandler(cb: () => void): void {
  document.getElementById("md-settings-btn")?.addEventListener("click", cb);
}

/**
 * Markdown 텍스트를 설정하고 렌더링한다.
 * 스트리밍이 완료된 후 최종본을 확정할 때 사용한다.
 */
export function setMarkdown(md: string): void {
  rawMarkdown = md;
  showRaw = false;
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
  showRaw = false;
  const content = document.getElementById(ID.content) as HTMLElement | null;
  const placeholder = document.getElementById(ID.placeholder) as HTMLElement | null;
  const toolbar = document.getElementById(ID.toolbar) as HTMLElement | null;
  if (content) { content.innerHTML = ""; content.style.display = "none"; }
  if (placeholder) placeholder.style.display = "flex";
  if (toolbar) toolbar.style.display = "none";
}

/** 스트리밍 중임을 나타내는 커서를 추가/제거한다. */
export function setStreaming(active: boolean): void {
  const content = document.getElementById(ID.content);
  if (!content) return;
  if (active) {
    content.classList.add("streaming");
  } else {
    content.classList.remove("streaming");
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function renderContent(): void {
  const content = document.getElementById(ID.content) as HTMLElement | null;
  if (!content) return;

  if (showRaw) {
    content.innerHTML = `<pre class="md-raw">${escapeHtml(rawMarkdown)}</pre>`;
  } else {
    content.innerHTML = marked.parse(rawMarkdown) as string;
  }
}

function showPanel(): void {
  const toolbar = document.getElementById(ID.toolbar) as HTMLElement | null;
  const content = document.getElementById(ID.content) as HTMLElement | null;
  const placeholder = document.getElementById(ID.placeholder) as HTMLElement | null;
  if (toolbar) toolbar.style.display = "flex";
  if (content) content.style.display = "block";
  if (placeholder) placeholder.style.display = "none";
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

function handleToggleRaw(): void {
  showRaw = !showRaw;
  const btn = document.getElementById(ID.rawBtn) as HTMLButtonElement | null;
  if (btn) btn.classList.toggle("active", showRaw);
  renderContent();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
