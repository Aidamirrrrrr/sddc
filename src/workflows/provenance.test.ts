import { expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeFeature } from "./analyze";
import {
  recordExecutionProvenance,
  recordPlanProvenance,
  recordTaskProvenance,
} from "./provenance";

/**
 * Stored artifacts are inputs, not history: a user edits spec.yaml and reruns. Nothing else in the
 * pipeline notices when a downstream artifact still answers the previous version, and nothing at
 * all used to notice when the *code* did.
 */
async function feature(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sddc-prov-"));
  const directory = join(root, ".specs", "registration");
  await mkdir(directory, { recursive: true });
  await Bun.write(
    join(directory, "spec.yaml"),
    Bun.YAML.stringify({
      status: "ready",
      feature: "registration",
      goal: "Register users",
      requirements: [{ id: "R1", statement: "A user can register" }],
      acceptance: [{ id: "A1", verifies: ["R1"], statement: "Registration succeeds" }],
      issues: [],
      questions: [],
      subfeatures: [],
    }),
  );
  await Bun.write(
    join(directory, "plan.yaml"),
    Bun.YAML.stringify({
      status: "ready",
      feature: "registration",
      summary: "One step",
      decisions: [],
      approach: [{ id: "S1", statement: "Add it", requirements: ["R1"], touches: ["src/auth.ts"] }],
      contracts: [],
      data_model: [],
      questions: [],
    }),
  );
  await Bun.write(
    join(directory, "tasks.yaml"),
    Bun.YAML.stringify({
      status: "ready",
      feature: "registration",
      summary: "One task",
      tasks: [
        {
          id: "T1",
          title: "Implement",
          goal: "Add it",
          requirements: ["R1"],
          acceptance: ["A1"],
          depends_on: [],
          permissions: [],
          files: { read: [], modify: ["src/auth.ts"], create: [], delete: [] },
          verification: [{ command: { program: "bun", args: ["test"] }, purpose: "Suite" }],
          done_when: ["done"],
          risks: [],
          wave: 1,
          parallel: false,
        },
      ],
      questions: [],
    }),
  );
  await Bun.write(join(directory, "execution.yaml"), "status: completed\n");
  return root;
}

test("code built from the current task graph reports nothing", async () => {
  const root = await feature();
  await recordPlanProvenance(root, "registration");
  await recordTaskProvenance(root, "registration");
  await recordExecutionProvenance(root, "registration");

  const findings = await analyzeFeature(root, "registration");

  expect(findings.filter((finding) => finding.severity === "stale")).toEqual([]);
});

test("code built from an older task graph is reported as stale", async () => {
  const root = await feature();
  await recordExecutionProvenance(root, "registration");
  const tasks = join(root, ".specs", "registration", "tasks.yaml");
  await Bun.write(tasks, `${await Bun.file(tasks).text()}\n# a later edit\n`);

  const findings = await analyzeFeature(root, "registration");

  // The failure this catches has no other symptom until the source contradicts the requirements,
  // which is usually a week later and in someone else's review.
  expect(findings.some((finding) => finding.statement.includes("older tasks.yaml"))).toBe(true);
});

test("a feature that was never implemented is not stale", async () => {
  const root = await feature();
  await Bun.file(join(root, ".specs", "registration", "execution.yaml")).delete();

  const findings = await analyzeFeature(root, "registration");

  expect(findings.some((finding) => finding.statement.includes("older tasks.yaml"))).toBe(false);
});
