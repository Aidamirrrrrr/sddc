import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { z } from "zod";
import type { Spec } from "../spec/schemas";
import { discoverRepository, reviseRepositoryDiscovery } from "./pipeline";
import type { RepositoryDiscovery } from "./schemas";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

test("repository discovery keeps only snapshot-backed evidence", async () => {
  root = await mkdtemp(join(tmpdir(), "spec-agent-discovery-"));
  await Bun.write(join(root, "package.json"), '{"scripts":{"test":"bun test"}}');
  await Bun.write(join(root, "main.ts"), "export function start() {}");
  const responses = [
    {
      files: [
        { path: "package.json", reason: "Manifest" },
        { path: "main.ts", reason: "Entry point" },
        { path: "missing.ts", reason: "Missing" },
      ],
      rationale: "Relevant files.",
    },
    emptySelection(),
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

test("repository discovery uses user-approved files and context", async () => {
  root = await mkdtemp(join(tmpdir(), "spec-agent-context-"));
  await Bun.write(join(root, "model-choice.ts"), "export const ignored = true");
  await Bun.write(join(root, "user-choice.ts"), "export const approved = true");
  const prompts: string[] = [];
  const responses = [
    {
      files: [{ path: "model-choice.ts", reason: "Model choice" }],
      rationale: "Initial selection",
    },
    emptySelection(),
    discoveryCandidateFor("user-choice.ts"),
    discoveryCandidateFor("user-choice.ts"),
  ];
  const client = {
    async generateObject<T>(_system: string, prompt: string, _schema: z.ZodType<T>): Promise<T> {
      prompts.push(prompt);
      return responses.shift() as T;
    },
  };

  const discovery = await discoverRepository(client, readySpec(), root, async () => ({
    files: ["user-choice.ts"],
    userContext: "The old module will be removed.",
  }));

  expect(discovery.relevant_files[0]?.path).toBe("user-choice.ts");
  expect(discovery.context).toEqual({
    files: ["user-choice.ts"],
    user_context: "The old module will be removed.",
  });
  expect(prompts[1]).toContain("The old module will be removed.");
  expect(prompts[1]).toContain("user-choice.ts");
  expect(prompts[1]).not.toContain("export const ignored");
});

test("repository discovery adds a model-requested file after approval", async () => {
  root = await mkdtemp(join(tmpdir(), "spec-agent-expansion-"));
  await Bun.write(join(root, "entry.ts"), "export const entry = true");
  await Bun.write(join(root, "related.ts"), "export const related = true");
  const responses = [
    { files: [{ path: "entry.ts", reason: "Entry" }], rationale: "Initial" },
    { files: [{ path: "related.ts", reason: "Imported module" }], rationale: "Expand" },
    discoveryCandidateFor("related.ts"),
    discoveryCandidateFor("related.ts"),
  ];
  const client = {
    async generateObject<T>(_system: string, _prompt: string, _schema: z.ZodType<T>): Promise<T> {
      return responses.shift() as T;
    },
  };

  const discovery = await discoverRepository(client, readySpec(), root);

  expect(discovery.context.files).toEqual(["entry.ts", "related.ts"]);
});

test("repository discovery revision stays within approved evidence", async () => {
  root = await mkdtemp(join(tmpdir(), "spec-agent-revision-"));
  await Bun.write(join(root, "main.ts"), "export const start = true");
  const client = {
    async generateObject<T>(_system: string, prompt: string, _schema: z.ZodType<T>): Promise<T> {
      expect(prompt).toContain("Correct the summary");
      return discoveryCandidate() as T;
    },
  };
  const current = discoveryCandidate() as RepositoryDiscovery;
  current.context = { files: ["main.ts"], user_context: "Keep the CLI" };

  const revised = await reviseRepositoryDiscovery(
    client,
    readySpec(),
    current,
    "Correct the summary",
    root,
  );

  expect(revised.context).toEqual({ files: ["main.ts"], user_context: "Keep the CLI" });
  expect(revised.technologies).toEqual([]);
});

function discoveryCandidate() {
  return {
    context: { files: [], user_context: "" },
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

function discoveryCandidateFor(path: string) {
  return {
    context: { files: [], user_context: "" },
    summary: "Approved context.",
    technologies: [],
    structure: [],
    relevant_files: [{ path, purpose: "Approved file", symbols: ["approved"] }],
    conventions: [],
    testing: [],
    constraints: [],
    unknowns: [],
  };
}

function emptySelection() {
  return { files: [], rationale: "Current context is sufficient" };
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
