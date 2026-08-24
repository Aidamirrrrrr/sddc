import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { z } from "zod";
import { prepareRequestRepositoryContext } from "./request-context";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

test("collects approved code context before specification", async () => {
  root = await mkdtemp(join(tmpdir(), "sddc-request-context-"));
  await Bun.write(join(root, "auth.service.ts"), "setRefreshCookie(token: string): void {}");
  await Bun.write(join(root, "auth.test.ts"), "test('sets refresh cookie', () => {});");
  const responses = [
    {
      files: [{ path: "auth.service.ts", reason: "Contains the requested method" }],
      rationale: "Direct definition",
    },
    {
      files: [{ path: "auth.test.ts", reason: "Covers current behavior" }],
      rationale: "Test coverage",
    },
  ];
  const client = {
    async generateObject<T>(_system: string, _prompt: string, _schema: z.ZodType<T>): Promise<T> {
      return responses.shift() as T;
    },
  };

  const context = await prepareRequestRepositoryContext(
    client,
    "Move setRefreshCookie to cookie.service.ts",
    root,
    async (selection, _index, current) => ({
      files: current?.files ?? selection.files.map((file) => file.path),
      userContext: "Preserve behavior",
    }),
  );

  expect(context.files).toEqual(["auth.service.ts", "auth.test.ts"]);
  expect(context.snapshots.map((item) => item.path)).toEqual(["auth.service.ts", "auth.test.ts"]);
  expect(context.snapshots[0]?.content).toContain("token: string");
});

test("limits automatically proposed context before user review", async () => {
  root = await mkdtemp(join(tmpdir(), "sddc-request-context-limit-"));
  const paths = Array.from({ length: 20 }, (_, index) => `file-${index}.ts`);
  await Promise.all(paths.map((path) => Bun.write(join(root, path), `export const value = 1;`)));
  const responses = [
    {
      files: paths.map((path) => ({ path, reason: "Potentially relevant" })),
      rationale: "Broad initial selection",
    },
    {
      files: paths.slice(12).map((path) => ({ path, reason: "Potential dependency" })),
      rationale: "Broad expansion",
    },
  ];
  const selectionSizes: number[] = [];
  const client = {
    async generateObject<T>(_system: string, _prompt: string, _schema: z.ZodType<T>): Promise<T> {
      return responses.shift() as T;
    },
  };

  await prepareRequestRepositoryContext(client, "Change a service", root, async (selection) => {
    selectionSizes.push(selection.files.length);
    return { files: selection.files.map((file) => file.path), userContext: "" };
  });

  expect(selectionSizes).toEqual([12, 18]);
});

test("does not ask for context approval twice when expansion adds nothing", async () => {
  root = await mkdtemp(join(tmpdir(), "sddc-request-context-no-expansion-"));
  await Bun.write(join(root, "auth.ts"), "export class AuthService {}");
  const responses = [
    { files: [{ path: "auth.ts", reason: "Direct match" }], rationale: "Definition" },
    { files: [], rationale: "Context is sufficient" },
  ];
  let approvals = 0;
  const client = {
    async generateObject<T>(_system: string, _prompt: string, _schema: z.ZodType<T>): Promise<T> {
      return responses.shift() as T;
    },
  };

  const context = await prepareRequestRepositoryContext(
    client,
    "Change AuthService",
    root,
    async (selection) => {
      approvals += 1;
      return { files: selection.files.map((file) => file.path), userContext: "" };
    },
  );

  expect(approvals).toBe(1);
  expect(context.files).toEqual(["auth.ts"]);
});
