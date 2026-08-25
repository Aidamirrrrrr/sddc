import { expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discovery, readyPlan, readySpec } from "../planning/test-fixtures";
import { readyTasks } from "../tasks/test-fixtures";
import { loadCase, recordCase } from "./corpus";

async function feature(overrides: { spec?: unknown; tasks?: unknown } = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sddc-corpus-"));
  const directory = join(root, ".specs", "registration");
  await mkdir(directory, { recursive: true });
  await Bun.write(join(directory, "spec.yaml"), Bun.YAML.stringify(overrides.spec ?? readySpec()));
  await Bun.write(
    join(directory, "tasks.yaml"),
    Bun.YAML.stringify(overrides.tasks ?? readyTasks()),
  );
  await Bun.write(join(directory, "plan.yaml"), Bun.YAML.stringify(readyPlan()));
  await Bun.write(join(directory, "discovery.yaml"), Bun.YAML.stringify(discovery()));
  return root;
}

test("a finished feature is recorded as it stands", async () => {
  const root = await feature();

  await recordCase(root, "registration");
  const recorded = await loadCase(root, "registration");

  expect(recorded?.spec.feature).toBe(readySpec().feature);
  expect(recorded?.tasks?.tasks.length).toBeGreaterThan(0);
});

test("a torn snapshot is refused rather than recorded as a permanent failing case", async () => {
  // A feature directory is written phase by phase, so a run stopped mid-phase — or a second run over
  // the top of the first — leaves a spec from one attempt beside tasks from another.
  const narrowed = { ...readySpec(), acceptance: [] };
  const root = await feature({ spec: narrowed });

  expect(recordCase(root, "registration")).rejects.toThrow("which spec.yaml does not define");
});

test("a feature with nothing stored is refused too", async () => {
  const root = await mkdtemp(join(tmpdir(), "sddc-corpus-empty-"));

  expect(recordCase(root, "registration")).rejects.toThrow("No artifacts to record");
});

test("a policy recorded before the schema grew still loads", async () => {
  const root = await feature();
  await mkdir(join(root, ".specs", "registration"), { recursive: true });
  // Written by an older version that had no budget section at all.
  await Bun.write(
    join(root, ".specs", "registration", "policy.yaml"),
    "version: 1\nchanges:\n  require_test_before_implementation: true\n",
  );

  await recordCase(root, "registration");
  const recorded = await loadCase(root, "registration");

  // The recorded half is honoured and the rest comes from today's defaults, exactly as a project's
  // own partial policy is read.
  expect(recorded?.policy.changes.require_test_before_implementation).toBe(true);
  expect(recorded?.policy.budget.max_model_calls).toBeGreaterThan(0);
});
