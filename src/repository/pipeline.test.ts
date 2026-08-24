import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { z } from "zod";
import type { Spec } from "../spec/schemas";
import { discoverRepository } from "./pipeline";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

test("repository discovery keeps only snapshot-backed evidence", async () => {
  root = await mkdtemp(join(tmpdir(), "spec-agent-discovery-"));
  await Bun.write(join(root, "package.json"), '{"scripts":{"test":"bun test"}}');
  await Bun.write(join(root, "main.ts"), "export function start() {}");
  const responses = [
    { files: ["package.json", "main.ts", "missing.ts"], rationale: "Relevant files." },
    discoveryCandidate(),
    discoveryCandidate(),
  ];
  const client = {
    async generateObject<T>(_system: string, _prompt: string, _schema: z.ZodType<T>): Promise<T> {
      return responses.shift() as T;
    },
  };

  const discovery = await discoverRepository(client, readySpec(), root);

  expect(discovery.technologies).toHaveLength(1);
  expect(discovery.constraints).toEqual([]);
  expect(discovery.relevant_files).toEqual([
    { path: "main.ts", purpose: "Entry point", symbols: ["start"] },
  ]);
});

function discoveryCandidate() {
  return {
    summary: "A Bun project.",
    technologies: [{ name: "Bun", purpose: "Runtime", evidence: ["package.json"] }],
    structure: [],
    relevant_files: [
      { path: "main.ts", purpose: "Entry point", symbols: ["start", "missingSymbol"] },
      { path: "missing.ts", purpose: "Invented", symbols: [] },
    ],
    conventions: [],
    testing: [],
    constraints: [{ statement: "Invented", evidence: ["missing.ts"] }],
    unknowns: [],
  };
}

function readySpec(): Spec {
  return {
    status: "ready",
    feature: "example",
    goal: "Example",
    requirements: [{ id: "R1", statement: "Example" }],
    acceptance: [{ id: "A1", verifies: ["R1"], statement: "Example works" }],
    issues: [],
    questions: [],
    subfeatures: [],
  };
}
