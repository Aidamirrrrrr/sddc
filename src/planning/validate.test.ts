import { expect, test } from "bun:test";
import type { ImplementationPlan } from "./schemas";
import { discovery, readyPlan, readySpec } from "./test-fixtures";
import { normalizePlan, validatePlan } from "./validate";

test("plan normalization renumbers tasks and their dependencies", () => {
  const plan = readyPlan();
  const [first, second] = requireTwoTasks(plan);
  first.id = "setup";
  second.id = "finish";
  second.depends_on = ["setup", "setup"];

  const normalized = normalizePlan(plan, "registration");

  expect(normalized.tasks.map((task) => task.id)).toEqual(["T1", "T2"]);
  expect(normalized.tasks[1]?.depends_on).toEqual(["T1"]);
});

test("plan validation rejects dependency cycles", () => {
  const plan = readyPlan();
  const [first, second] = requireTwoTasks(plan);
  first.depends_on = ["T2"];
  second.depends_on = ["T1"];

  expect(() => validatePlan(plan, readySpec(), discovery())).toThrow(
    "Task dependency cycle includes T1",
  );
});

test("plan validation rejects unapproved and unsafe paths", () => {
  const unapproved = readyPlan();
  const [unapprovedTask] = requireTwoTasks(unapproved);
  unapprovedTask.files.modify = ["src/unknown.ts"];
  expect(() => validatePlan(unapproved, readySpec(), discovery())).toThrow(
    "T1 references unapproved file: src/unknown.ts",
  );

  const unsafe = readyPlan();
  const [unsafeTask] = requireTwoTasks(unsafe);
  unsafeTask.files.create = ["../secret.ts"];
  expect(() => validatePlan(unsafe, readySpec(), discovery())).toThrow(
    "T1 contains unsafe path: ../secret.ts",
  );

  const disguisedExisting = readyPlan();
  const [, createTask] = requireTwoTasks(disguisedExisting);
  createTask.files.create = ["src/existing.ts"];
  expect(() =>
    validatePlan(disguisedExisting, readySpec(), discovery(), ["src/auth.ts", "src/existing.ts"]),
  ).toThrow("T2 lists existing file as create: src/existing.ts");

  const missingVerificationFile = readyPlan();
  const [verificationTask] = requireTwoTasks(missingVerificationFile);
  verificationTask.verification = [
    {
      command: { program: "bun", args: ["test", "src/missing.test.ts"] },
      purpose: "Run a missing test",
    },
  ];
  expect(() => validatePlan(missingVerificationFile, readySpec(), discovery())).toThrow(
    "T1 verification references unavailable file: src/missing.test.ts",
  );
});

function requireTwoTasks(
  plan: ImplementationPlan,
): [ImplementationPlan["tasks"][number], ImplementationPlan["tasks"][number]] {
  const [first, second] = plan.tasks;
  if (!first || !second) throw new Error("Test fixture must contain two tasks");
  return [first, second];
}
