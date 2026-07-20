import type { CanonicalBlock, CanonicalDocument } from "./reading-order-model";

export interface ReadingOrderEditorOptions {
  onOrderChanged: (document: CanonicalDocument) => void;
  onOrderVisibilityChanged: (visible: boolean) => void;
}

let documentModel: CanonicalDocument | null = null;
let options: ReadingOrderEditorOptions | null = null;
let visible = false;
let editing = false;
let selectedId: string | null = null;
let currentPage = 1;

export function mountReadingOrderEditor(container: HTMLElement, nextOptions: ReadingOrderEditorOptions): void {
  options = nextOptions;
  const panel = document.createElement("section");
  panel.id = "reading-order-editor";
  panel.className = "reading-order-editor";
  panel.hidden = true;
  panel.setAttribute("aria-label", "읽기 순서 편집");
  container.appendChild(panel);
  window.addEventListener("pdf-page-changed", ((event: CustomEvent<number>) => {
    currentPage = event.detail;
    render();
  }) as EventListener);
}

export function setReadingOrderDocument(model: CanonicalDocument | null): void {
  documentModel = model;
  selectedId = null;
  visible = false;
  editing = false;
  render();
}

/** Order 보기와 함께 보조 편집 표면을 열거나 닫는다. */
export function toggleReadingOrderPanel(): boolean {
  if (!documentModel) return false;
  visible = !visible;
  if (!visible) editing = false;
  render();
  return visible;
}

export function toggleReadingOrderEditor(): boolean {
  if (!documentModel) return false;
  visible = true;
  editing = !editing;
  selectedId = null;
  options?.onOrderVisibilityChanged(true);
  render();
  return editing;
}

export function isReadingOrderEditing(): boolean { return editing; }

function render(): void {
  const panel = document.getElementById("reading-order-editor") as HTMLElement | null;
  if (!panel) return;
  if (!documentModel || !visible) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const blocks = documentModel.getCurrentBlocks(currentPage);
  const changed = documentModel.isPageChanged(currentPage);
  const disabled = !documentModel.editable || blocks.length < 2;
  const reason = documentModel.editDisabledReason ?? (blocks.length < 2 ? "이 페이지에는 이동할 블록이 충분하지 않습니다." : "");
  panel.innerHTML = `
    <div class="reading-order-header">
      <div><strong>읽기 순서</strong><span class="reading-order-page">p.${currentPage}</span>${changed ? '<span class="reading-order-changed">수정됨</span>' : ""}</div>
      <button class="reading-order-toggle" type="button" aria-expanded="${editing}">${editing ? "편집 닫기" : "순서 편집"}</button>
    </div>
    ${editing ? `
      <p class="reading-order-help">선택한 블록만 이 페이지 안에서 이동합니다. 미리보기와 저장 파일에 바로 반영됩니다.</p>
      ${disabled ? `<p class="reading-order-disabled" role="status">${escapeHtml(reason)}</p>` : `
        <div class="reading-order-actions">
          <button type="button" data-order-action="undo">실행 취소</button>
          <button type="button" data-order-action="reset" ${changed ? "" : "disabled"}>이 페이지 원래 순서로</button>
        </div>
        <ol class="reading-order-list" aria-label="페이지 ${currentPage} 읽기 순서">
          ${blocks.map((block, index) => renderBlock(block, index, blocks.length)).join("")}
        </ol>
      `}
    ` : ""}
    <div class="reading-order-live" aria-live="polite" aria-atomic="true"></div>
  `;
  panel.querySelector<HTMLButtonElement>(".reading-order-toggle")?.addEventListener("click", () => toggleReadingOrderEditor());
  if (!editing || disabled) return;
  bindActions(panel, blocks);
}

function renderBlock(block: CanonicalBlock, index: number, total: number): string {
  const selected = selectedId === block.id;
  return `<li class="reading-order-item${selected ? " selected" : ""}" data-block-id="${block.id}" data-index="${index}" draggable="true">
    <button type="button" class="reading-order-select" aria-pressed="${selected}" aria-label="${escapeHtml(block.type)} ${index + 1}번째, ${total}개 중. 선택하여 이동">
      <span class="reading-order-number">${index + 1}</span><span class="reading-order-type">${escapeHtml(block.type)}</span><span class="reading-order-excerpt">${escapeHtml(excerpt(block.content))}</span>
    </button>
    <span class="reading-order-drag" aria-hidden="true">⠿</span>
    <div class="reading-order-moves" aria-label="${index + 1}번째 블록 이동">
      <button type="button" data-move="start" title="맨 앞으로 이동" ${index === 0 ? "disabled" : ""}>맨앞</button>
      <button type="button" data-move="up" title="앞으로 이동" ${index === 0 ? "disabled" : ""}>앞</button>
      <button type="button" data-move="down" title="뒤로 이동" ${index === total - 1 ? "disabled" : ""}>뒤</button>
      <button type="button" data-move="end" title="맨 뒤로 이동" ${index === total - 1 ? "disabled" : ""}>맨뒤</button>
    </div>
  </li>`;
}

function bindActions(panel: HTMLElement, blocks: CanonicalBlock[]): void {
  panel.querySelectorAll<HTMLElement>(".reading-order-item").forEach((item) => {
    const blockId = item.dataset.blockId!;
    item.querySelector<HTMLButtonElement>(".reading-order-select")?.addEventListener("click", () => {
      selectedId = selectedId === blockId ? null : blockId;
      render();
      if (selectedId) announce(`블록을 선택했습니다. Alt+위쪽 또는 아래쪽 화살표로 이동할 수 있습니다.`);
    });
    item.addEventListener("keydown", (event) => handleKeyboardMove(event, blockId));
    item.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/plain", blockId);
      event.dataTransfer?.setDragImage(item, 12, 12);
      item.classList.add("dragging");
    });
    item.addEventListener("dragend", () => item.classList.remove("dragging"));
    item.addEventListener("dragover", (event) => { event.preventDefault(); item.classList.add("drop-target"); });
    item.addEventListener("dragleave", () => item.classList.remove("drop-target"));
    item.addEventListener("drop", (event) => {
      event.preventDefault();
      item.classList.remove("drop-target");
      const sourceId = event.dataTransfer?.getData("text/plain");
      const targetIndex = Number(item.dataset.index);
      if (sourceId) moveById(sourceId, targetIndex, true);
    });
    item.querySelectorAll<HTMLButtonElement>("[data-move]").forEach((button) => {
      button.addEventListener("click", () => {
        const from = blocks.findIndex((block) => block.id === blockId);
        const move = button.dataset.move;
        const to = move === "start" ? 0 : move === "end" ? blocks.length - 1 : move === "up" ? from - 1 : from + 1;
        moveById(blockId, to, false);
      });
    });
  });
  panel.querySelector<HTMLButtonElement>("[data-order-action=undo]")?.addEventListener("click", () => {
    if (documentModel?.undo()) {
      notifyChange("마지막 순서 변경을 실행 취소했습니다.");
    } else announce("실행 취소할 변경이 없습니다.");
  });
  panel.querySelector<HTMLButtonElement>("[data-order-action=reset]")?.addEventListener("click", () => {
    if (documentModel?.resetPage(currentPage)) notifyChange("이 페이지를 원래 순서로 되돌렸습니다.");
  });
}

function handleKeyboardMove(event: KeyboardEvent, blockId: string): void {
  if (!event.altKey) return;
  const blocks = documentModel?.getCurrentBlocks(currentPage) ?? [];
  const index = blocks.findIndex((block) => block.id === blockId);
  let to: number | null = null;
  if (event.key === "ArrowUp") to = index - 1;
  if (event.key === "ArrowDown") to = index + 1;
  if (event.key === "Home") to = 0;
  if (event.key === "End") to = blocks.length - 1;
  if (to === null) return;
  event.preventDefault();
  moveById(blockId, to, false);
}

function moveById(blockId: string, toIndex: number, insertingBefore: boolean): void {
  if (!documentModel) return;
  const blocks = documentModel.getCurrentBlocks(currentPage);
  const fromIndex = blocks.findIndex((block) => block.id === blockId);
  if (fromIndex < 0 || toIndex < 0 || toIndex >= blocks.length) return;
  // A drag target means "put before this item". Removing the source shifts a later target left.
  const destination = insertingBefore && fromIndex < toIndex ? toIndex - 1 : toIndex;
  const result = documentModel.move({ pageNumber: currentPage, blockId, fromIndex, toIndex: destination });
  if (!result.ok) {
    announce("이동할 수 없습니다.");
    return;
  }
  selectedId = blockId;
  notifyChange(`${destination + 1}번째 위치로 이동했습니다.`);
  requestAnimationFrame(() => panelForBlock(blockId)?.focus());
}

function notifyChange(message: string): void {
  options?.onOrderChanged(documentModel!);
  render();
  announce(message);
}

function announce(message: string): void {
  const live = document.querySelector<HTMLElement>(".reading-order-live");
  if (live) live.textContent = message;
}

function panelForBlock(id: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`.reading-order-item[data-block-id="${CSS.escape(id)}"] .reading-order-select`);
}

function excerpt(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 72 ? `${text.slice(0, 69)}…` : text || "내용 미리보기 없음";
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
