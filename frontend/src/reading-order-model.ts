/**
 * Reading-order canonical document model.
 *
 * The parser JSON is never mutated.  Per-page order overrides point at stable
 * source paths, and Markdown is regenerated only when every editable block
 * has a conservative, one-to-one Markdown segment mapping.
 */

export const EDITABLE_BLOCK_TYPES = new Set(["heading", "paragraph", "table", "list", "image", "formula"]);
export type EditableBlockType = "heading" | "paragraph" | "table" | "list" | "image" | "formula";

export interface RawDocumentElement {
  type?: string;
  "page number"?: number;
  "bounding box"?: [number, number, number, number];
  content?: string;
  kids?: RawDocumentElement[];
  rows?: RawDocumentElement[];
  cells?: RawDocumentElement[];
  "list items"?: RawDocumentElement[];
}

export interface CanonicalBlock {
  id: string;
  sourcePath: number[];
  pageNumber: number;
  type: EditableBlockType;
  bbox?: [number, number, number, number];
  content: string;
  children: CanonicalChild[];
  originalIndex: number;
}

export interface CanonicalChild {
  sourcePath: number[];
  type: string;
  content: string;
  children: CanonicalChild[];
}

export interface PageOrder {
  pageNumber: number;
  originalBlockIds: string[];
  currentBlockIds: string[];
  revision: number;
}

export interface ReorderCommand {
  pageNumber: number;
  blockId: string;
  fromIndex: number;
  toIndex: number;
}

export type ReorderFailure = "missing-page" | "missing-block" | "wrong-page" | "duplicate-id" | "invalid-index" | "stale-index";
export type ReorderResult = { ok: true; command: ReorderCommand } | { ok: false; reason: ReorderFailure };

interface UndoEntry { pageNumber: number; previous: string[]; }
interface MarkdownSegment { blockId: string; text: string; }

export interface CanonicalDocument {
  readonly blocks: ReadonlyMap<string, CanonicalBlock>;
  readonly pages: ReadonlyMap<number, PageOrder>;
  readonly editable: boolean;
  readonly editDisabledReason: string | null;
  readonly originalMarkdown: string;
  getPage(pageNumber: number): PageOrder | undefined;
  getCurrentBlocks(pageNumber: number): CanonicalBlock[];
  getAllCurrentBlocks(): CanonicalBlock[];
  isPageChanged(pageNumber: number): boolean;
  move(command: ReorderCommand): ReorderResult;
  undo(): boolean;
  resetPage(pageNumber: number): boolean;
  serializeMarkdown(): string;
}

const CHILD_KEYS = ["kids", "rows", "cells", "list items"] as const;

export function stableBlockId(pageNumber: number, sourcePath: readonly number[]): string {
  return `p${pageNumber}:${sourcePath.join(".")}`;
}

export function createCanonicalDocument(json: string | unknown, markdown: string): CanonicalDocument {
  let root: RawDocumentElement;
  try {
    root = typeof json === "string" ? JSON.parse(json) as RawDocumentElement : json as RawDocumentElement;
  } catch {
    return unavailableDocument(markdown, "문서 위치 정보를 읽을 수 없어 순서 편집을 사용할 수 없습니다.");
  }

  const blocks = new Map<string, CanonicalBlock>();
  const pageIds = new Map<number, string[]>();
  let index = 0;

  const visit = (element: RawDocumentElement, path: number[], parentIsEditable: boolean) => {
    const type = element.type ?? "unknown";
    const isEditable = EDITABLE_BLOCK_TYPES.has(type) && !parentIsEditable;
    if (isEditable) {
      const pageNumber = element["page number"];
      if (!Number.isInteger(pageNumber) || (pageNumber ?? 0) < 1) return;
      const id = stableBlockId(pageNumber!, path);
      if (blocks.has(id)) return;
      const block: CanonicalBlock = {
        id,
        sourcePath: [...path],
        pageNumber: pageNumber!,
        type: type as EditableBlockType,
        bbox: element["bounding box"] ? [...element["bounding box"]] as [number, number, number, number] : undefined,
        content: element.content ?? "",
        children: extractChildren(element, path),
        originalIndex: index++,
      };
      blocks.set(id, Object.freeze(block));
      const ids = pageIds.get(pageNumber!) ?? [];
      ids.push(id);
      pageIds.set(pageNumber!, ids);
    }
    forEachChild(element, path, (child, childPath) => visit(child, childPath, parentIsEditable || isEditable));
  };

  (root.kids ?? []).forEach((element, i) => visit(element, [i], false));
  if (blocks.size === 0) return unavailableDocument(markdown, "이 결과에는 편집할 수 있는 문단 위치 정보가 없습니다.");

  const pages = new Map<number, PageOrder>();
  for (const [pageNumber, ids] of pageIds) {
    pages.set(pageNumber, { pageNumber, originalBlockIds: [...ids], currentBlockIds: [...ids], revision: 0 });
  }

  const mapping = mapMarkdown(blocks, markdown);
  return new MutableCanonicalDocument(blocks, pages, markdown, mapping.segments, mapping.reason);
}

class MutableCanonicalDocument implements CanonicalDocument {
  readonly editable: boolean;
  readonly editDisabledReason: string | null;
  private readonly undoStack: UndoEntry[] = [];
  readonly blocks: ReadonlyMap<string, CanonicalBlock>;
  readonly pages: ReadonlyMap<number, PageOrder>;
  readonly originalMarkdown: string;
  private readonly segments: MarkdownSegment[] | null;

  constructor(
    blocks: ReadonlyMap<string, CanonicalBlock>,
    pages: ReadonlyMap<number, PageOrder>,
    originalMarkdown: string,
    segments: MarkdownSegment[] | null,
    mappingReason: string | null,
  ) {
    this.blocks = blocks;
    this.pages = pages;
    this.originalMarkdown = originalMarkdown;
    this.segments = segments;
    this.editable = Boolean(segments);
    this.editDisabledReason = mappingReason;
  }

  getPage(pageNumber: number): PageOrder | undefined { return this.pages.get(pageNumber); }

  getCurrentBlocks(pageNumber: number): CanonicalBlock[] {
    return (this.pages.get(pageNumber)?.currentBlockIds ?? [])
      .map((id) => this.blocks.get(id))
      .filter((block): block is CanonicalBlock => Boolean(block));
  }

  getAllCurrentBlocks(): CanonicalBlock[] {
    const positions = new Map<number, number>();
    const ordered = [...this.blocks.values()].sort((a, b) => a.originalIndex - b.originalIndex);
    return ordered.map((block) => {
      const page = this.pages.get(block.pageNumber)!;
      const position = positions.get(block.pageNumber) ?? 0;
      positions.set(block.pageNumber, position + 1);
      return this.blocks.get(page.currentBlockIds[position])!;
    });
  }

  isPageChanged(pageNumber: number): boolean {
    const page = this.pages.get(pageNumber);
    return Boolean(page && !sameOrder(page.currentBlockIds, page.originalBlockIds));
  }

  move(command: ReorderCommand): ReorderResult {
    const page = this.pages.get(command.pageNumber);
    if (!page) return { ok: false, reason: "missing-page" };
    if (!this.blocks.has(command.blockId)) return { ok: false, reason: "missing-block" };
    if (this.blocks.get(command.blockId)!.pageNumber !== command.pageNumber) return { ok: false, reason: "wrong-page" };
    if (new Set(page.currentBlockIds).size !== page.currentBlockIds.length) return { ok: false, reason: "duplicate-id" };
    if (!Number.isInteger(command.fromIndex) || !Number.isInteger(command.toIndex) || command.fromIndex < 0 || command.toIndex < 0 || command.fromIndex >= page.currentBlockIds.length || command.toIndex >= page.currentBlockIds.length) {
      return { ok: false, reason: "invalid-index" };
    }
    if (page.currentBlockIds[command.fromIndex] !== command.blockId) return { ok: false, reason: "stale-index" };
    if (command.fromIndex === command.toIndex) return { ok: true, command };
    this.undoStack.push({ pageNumber: command.pageNumber, previous: [...page.currentBlockIds] });
    const next = [...page.currentBlockIds];
    next.splice(command.fromIndex, 1);
    next.splice(command.toIndex, 0, command.blockId);
    updatePage(page, next);
    return { ok: true, command };
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    const page = this.pages.get(entry.pageNumber);
    if (!page || !hasSameIds(page.currentBlockIds, entry.previous)) return false;
    updatePage(page, entry.previous);
    return true;
  }

  resetPage(pageNumber: number): boolean {
    const page = this.pages.get(pageNumber);
    if (!page || !this.isPageChanged(pageNumber)) return false;
    this.undoStack.push({ pageNumber, previous: [...page.currentBlockIds] });
    updatePage(page, [...page.originalBlockIds]);
    return true;
  }

  serializeMarkdown(): string {
    if (!this.segments) return this.originalMarkdown;
    const segmentById = new Map(this.segments.map((segment) => [segment.blockId, segment.text]));
    return this.getAllCurrentBlocks().map((block) => segmentById.get(block.id)!).join("");
  }
}

function unavailableDocument(markdown: string, reason: string): CanonicalDocument {
  return new MutableCanonicalDocument(new Map(), new Map(), markdown, null, reason);
}

function extractChildren(element: RawDocumentElement, path: number[]): CanonicalChild[] {
  const children: CanonicalChild[] = [];
  forEachChild(element, path, (child, childPath) => {
    children.push(Object.freeze({
      sourcePath: [...childPath],
      type: child.type ?? "unknown",
      content: child.content ?? "",
      children: extractChildren(child, childPath),
    }));
  });
  return children;
}

function forEachChild(element: RawDocumentElement, path: number[], callback: (child: RawDocumentElement, path: number[]) => void): void {
  let sourceIndex = 0;
  for (const key of CHILD_KEYS) {
    (element[key] ?? []).forEach((child) => callback(child, [...path, sourceIndex++]));
  }
}

function mapMarkdown(blocks: ReadonlyMap<string, CanonicalBlock>, markdown: string): { segments: MarkdownSegment[] | null; reason: string | null } {
  const chunks = splitMarkdown(markdown);
  const ordered = [...blocks.values()].sort((a, b) => a.originalIndex - b.originalIndex);
  if (chunks.length !== ordered.length) {
    return { segments: null, reason: "Markdown과 문단 위치 정보를 안전하게 연결할 수 없어 순서 편집을 사용할 수 없습니다." };
  }
  const segments: MarkdownSegment[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const blockText = normalizeForMatch(ordered[i].content);
    const markdownText = normalizeForMatch(chunks[i]);
    if (!blockText || !markdownText || (!markdownText.includes(blockText) && !blockText.includes(markdownText))) {
      return { segments: null, reason: "Markdown과 문단 위치 정보를 안전하게 연결할 수 없어 순서 편집을 사용할 수 없습니다." };
    }
    segments.push({ blockId: ordered[i].id, text: chunks[i] });
  }
  return { segments, reason: null };
}

function splitMarkdown(markdown: string): string[] {
  const parts = markdown.match(/[\s\S]*?(?:\r?\n){2,}|[\s\S]+$/g) ?? [];
  return parts.filter((part) => part.trim().length > 0);
}

function normalizeForMatch(value: string): string {
  return value
    .replace(/!?(?:\[[^\]]*\])\([^)]*\)/g, " ")
    .replace(/[|#*_`~>$\[\](){}\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function updatePage(page: PageOrder, currentBlockIds: string[]): void {
  page.currentBlockIds = currentBlockIds;
  page.revision += 1;
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function hasSameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}
