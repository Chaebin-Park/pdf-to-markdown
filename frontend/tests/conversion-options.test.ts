import assert from "node:assert/strict";
import test from "node:test";
import { conversionRequestBody, DEFAULT_QUALITY_OPTIONS } from "../src/conversion-options.ts";

test("serializes every quality option into the conversion request", () => {
  assert.deepEqual(conversionRequestBody("/tmp/a.pdf", "STANDARD", DEFAULT_QUALITY_OPTIONS), {
    filePath: "/tmp/a.pdf",
    mode: "STANDARD",
    readingOrder: "AUTO",
    includeHeaderFooter: false,
    keepLineBreaks: false,
    filterHiddenText: false,
    filterOutOfPage: true,
    filterTinyText: true,
    filterHiddenOcg: true,
  });
});
