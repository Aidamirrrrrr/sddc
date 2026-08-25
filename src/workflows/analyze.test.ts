import { expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readyPlan, readySpec } from "../planning/test-fixtures";
import type { Spec } from "../spec/schemas";
import { readyTasks } from "../tasks/test-fixtures";
import { analyzeFeature } from "./analyze";
import { recordPlanProvenance, recordTaskProvenance } from "./provenance";

async function feature(spec: Spec = readySpec()): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sddc-analyze-"));
  const directory = join(root, ".specs", "registration");
  await mkdir(directory, { recursive: true });
  await Bun.write(join(directory, "spec.yaml"), Bun.YAML.stringify(spec, null, 2));
  await Bun.write(join(directory, "plan.yaml"), Bun.YAML.stringify(readyPlan(), null, 2));
  await Bun.write(join(directory, "tasks.yaml"), Bun.YAML.stringify(readyTasks(), null, 2));
  await recordPlanProvenance(root, "registration");
  await recordTaskProvenance(root, "registration");
  return root;
}

test("consistent artifacts report nothing", async () => {
  expect(await analyzeFeature(await feature(), "registration")).toEqual([]);
});

test("editing the specification marks the derived artifacts stale", async () => {
  const root = await feature();
  const edited = readySpec();
  edited.requirements.push({ id: "R2", statement: "A user can verify their email" });
  await Bun.write(
    join(root, ".specs", "registration", "spec.yaml"),
    Bun.YAML.stringify(edited, null, 2),
  );

  const findings = await analyzeFeature(root, "registration");
  const statements = findings.map((finding) => finding.statement);

  expect(findings.some((finding) => finding.severity === "stale")).toBe(true);
  expect(statements.some((statement) => statement.includes("older spec.yaml"))).toBe(true);
  // The new requirement reaches neither the plan nor the tasks.
  expect(statements.some((statement) => statement.startsWith("R2 is not served"))).toBe(true);
  expect(statements.some((statement) => statement.startsWith("R2 is not covered"))).toBe(true);
});

test("an acceptance criterion no task verifies is reported as a gap", async () => {
  const spec = readySpec();
  spec.acceptance.push({ id: "A2", verifies: ["R1"], statement: "A duplicate email is rejected" });
  const root = await feature(spec);

  const findings = await analyzeFeature(root, "registration");

  expect(findings.some((finding) => finding.statement.startsWith("A2 is never verified"))).toBe(
    true,
  );
});
