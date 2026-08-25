import { expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discovery, readyPlan, readySpec } from "../planning/test-fixtures";
import { defaultPolicy } from "../policy/load";
import { readyTasks } from "../tasks/test-fixtures";
import { loadCorpus, recordCase } from "./corpus";

async function storedFeature(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sddc-corpus-"));
  const directory = join(root, ".specs", "registration");
  await mkdir(directory, { recursive: true });
  const write = async (name: string, value: unknown) =>
    Bun.write(join(directory, name), Bun.YAML.stringify(value, null, 2));
  await write("spec.yaml", readySpec());
  await write("discovery.yaml", discovery());
  await write("plan.yaml", readyPlan());
  await write("tasks.yaml", readyTasks());
  await write("policy.yaml", defaultPolicy);
  return root;
}

test("a stored feature becomes a case without transformation", async () => {
  const root = await storedFeature();

  await recordCase(root, "registration");
  const corpus = await loadCorpus(root);

  expect(corpus).toHaveLength(1);
  const item = corpus[0];
  if (!item) throw new Error("Expected a recorded case");
  expect(item.name).toBe("registration");
  expect(item.spec.feature).toBe("registration");
  expect(item.plan?.approach).toHaveLength(1);
  expect(item.tasks?.tasks).toHaveLength(2);
});

test("recording a feature with no artifacts is an error, not an empty case", async () => {
  const root = await mkdtemp(join(tmpdir(), "sddc-corpus-"));

  expect(recordCase(root, "missing")).rejects.toThrow(
    'No artifacts to record for feature "missing"',
  );
});

test("an empty corpus loads as no cases rather than failing", async () => {
  const root = await mkdtemp(join(tmpdir(), "sddc-corpus-"));

  expect(await loadCorpus(root)).toEqual([]);
});

test("a case without a specification is skipped rather than half-loaded", async () => {
  const root = await storedFeature();
  await recordCase(root, "registration");
  await mkdir(join(root, "evals", "partial"), { recursive: true });
  await Bun.write(join(root, "evals", "partial", "plan.yaml"), Bun.YAML.stringify(readyPlan()));

  const corpus = await loadCorpus(root);

  expect(corpus.map((item) => item.name)).toEqual(["registration"]);
});
