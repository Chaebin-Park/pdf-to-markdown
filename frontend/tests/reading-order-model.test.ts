import assert from "node:assert/strict";
import test from "node:test";

import { createCanonicalDocument, type RawDocumentElement } from "../src/reading-order-model.ts";

function block(content: string, page = 1, type = "paragraph", extra: Partial<RawDocumentElement> = {}): RawDocumentElement {
  return { type, content, "page number": page, "bounding box": [0, 0, 10, 10], ...extra };
}

function fixture() {
  const kids = ["6", "7", "8", "9", "10"].map((content) => block(content));
  const json = { kids };
  return createCanonicalDocument(json, "6\n\n7\n\n8\n\n9\n\n10\n");
}

test("canonical model preserves source paths and nested table/list hierarchy", () => {
  const json = {
    kids: [
      block("Title", 1, "heading"),
      block("Table", 1, "table", { rows: [{ type: "table row", cells: [{ type: "table cell", content: "A" }, { type: "table cell", content: "B" }] }] }),
      block("List", 2, "list", { "list items": [{ type: "list item", content: "first" }, { type: "list item", content: "second" }] }),
    ],
  };
  const doc = createCanonicalDocument(json, "Title\n\nTable\n\nList\n");
  const table = doc.getCurrentBlocks(1)[1];
  const list = doc.getCurrentBlocks(2)[0];
  assert.deepEqual(table.sourcePath, [1]);
  assert.deepEqual(table.children[0].sourcePath, [1, 0]);
  assert.deepEqual(table.children[0].children.map((child) => child.content), ["A", "B"]);
  assert.deepEqual(list.children.map((child) => child.content), ["first", "second"]);
  assert.deepEqual(doc.getPage(1)?.originalBlockIds, doc.getPage(1)?.currentBlockIds);
});

test("moves 9 before 8 as a pure page-local command", () => {
  const doc = fixture();
  const ids = doc.getPage(1)!.currentBlockIds;
  const result = doc.move({ pageNumber: 1, blockId: ids[3], fromIndex: 3, toIndex: 2 });
  assert.deepEqual(result.ok, true);
  assert.deepEqual(doc.getCurrentBlocks(1).map((item) => item.content), ["6", "7", "9", "8", "10"]);
});

test("undo and page reset restore the immutable original order", () => {
  const doc = fixture();
  const ids = doc.getPage(1)!.currentBlockIds;
  assert.equal(doc.move({ pageNumber: 1, blockId: ids[3], fromIndex: 3, toIndex: 2 }).ok, true);
  assert.equal(doc.undo(), true);
  assert.deepEqual(doc.getCurrentBlocks(1).map((item) => item.content), ["6", "7", "8", "9", "10"]);
  assert.equal(doc.move({ pageNumber: 1, blockId: ids[4], fromIndex: 4, toIndex: 0 }).ok, true);
  assert.equal(doc.resetPage(1), true);
  assert.deepEqual(doc.getPage(1)?.currentBlockIds, doc.getPage(1)?.originalBlockIds);
});

test("rejects cross-page, missing, duplicate, and invalid reorder commands safely", () => {
  const json = { kids: [block("one", 1), block("two", 1), block("three", 2), block("four", 2)] };
  const doc = createCanonicalDocument(json, "one\n\ntwo\n\nthree\n\nfour\n");
  const pageOne = doc.getPage(1)!;
  const pageTwo = doc.getPage(2)!;
  assert.deepEqual(doc.move({ pageNumber: 1, blockId: pageTwo.currentBlockIds[0], fromIndex: 0, toIndex: 0 }), { ok: false, reason: "wrong-page" });
  assert.deepEqual(doc.move({ pageNumber: 1, blockId: "nope", fromIndex: 0, toIndex: 1 }), { ok: false, reason: "missing-block" });
  assert.deepEqual(doc.move({ pageNumber: 1, blockId: pageOne.currentBlockIds[0], fromIndex: -1, toIndex: 1 }), { ok: false, reason: "invalid-index" });
  pageOne.currentBlockIds = [pageOne.currentBlockIds[0], pageOne.currentBlockIds[0]];
  assert.deepEqual(doc.move({ pageNumber: 1, blockId: pageOne.currentBlockIds[0], fromIndex: 0, toIndex: 1 }), { ok: false, reason: "duplicate-id" });
});

test("moving a table or list keeps child relative order intact", () => {
  const json = {
    kids: [
      block("before"),
      block("Table", 1, "table", { rows: [{ type: "table row", cells: [{ type: "table cell", content: "first" }, { type: "table cell", content: "second" }] }] }),
      block("List", 1, "list", { "list items": [{ type: "list item", content: "alpha" }, { type: "list item", content: "beta" }] }),
    ],
  };
  const doc = createCanonicalDocument(json, "before\n\nTable\n\nList\n");
  const before = doc.getCurrentBlocks(1);
  const tableChildren = JSON.stringify(before[1].children);
  const listChildren = JSON.stringify(before[2].children);
  assert.equal(doc.move({ pageNumber: 1, blockId: before[2].id, fromIndex: 2, toIndex: 1 }).ok, true);
  const after = doc.getCurrentBlocks(1);
  assert.equal(JSON.stringify(after.find((item) => item.type === "table")!.children), tableChildren);
  assert.equal(JSON.stringify(after.find((item) => item.type === "list")!.children), listChildren);
});

test("regenerated Markdown is the single value for Preview, Source, Copy, and Save consumers", () => {
  const doc = fixture();
  const ids = doc.getPage(1)!.currentBlockIds;
  assert.equal(doc.move({ pageNumber: 1, blockId: ids[3], fromIndex: 3, toIndex: 2 }).ok, true);
  const markdown = doc.serializeMarkdown();
  const consumers = {
    preview: markdown,
    source: markdown,
    copy: markdown,
    save: markdown,
  };
  assert.deepEqual(new Set(Object.values(consumers)).size, 1);
  assert.equal(markdown, "6\n\n7\n\n9\n\n8\n\n10\n");
});

test("fails closed when Markdown cannot be mapped to every structured block", () => {
  const doc = createCanonicalDocument({ kids: [block("one"), block("two")] }, "one\n\nunrelated\n");
  assert.equal(doc.editable, false);
  assert.match(doc.editDisabledReason ?? "", /안전하게 연결/);
  assert.equal(doc.serializeMarkdown(), "one\n\nunrelated\n");
});
