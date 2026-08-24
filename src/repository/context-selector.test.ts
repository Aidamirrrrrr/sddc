import { expect, test } from "bun:test";
import { estimateContext, validateSelection } from "./context-selector";

test("context selection enforces file count and total size", () => {
  const sizes = new Map(Array.from({ length: 25 }, (_, index) => [`file-${index}.ts`, 10_000]));
  const validate = validateSelection(sizes);

  expect(validate([])).toBe("Select at least one file");
  expect(validate(Array.from(sizes.keys()))).toBe("Select no more than 24 files");
  expect(validate(Array.from(sizes.keys()).slice(0, 21))).toContain("limit is 200 KiB");
  expect(validate(["file-0.ts"])).toBeUndefined();
});

test("context estimate reports approximate tokens and configured price", () => {
  expect(estimateContext(4_000)).toEqual({ tokens: 1_000, costUsd: undefined });
  expect(estimateContext(4_000, { inputUsdPerMillion: 2 })).toEqual({
    tokens: 1_000,
    costUsd: 0.002,
  });
});
