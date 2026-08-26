import { expect, test } from "bun:test";
import type { Task } from "./schemas";
import { assignWaves, resolveAcceptanceOwners } from "./validate";

function task(id: string, dependsOn: string[], acceptance: string[], writes: string[]): Task {
  return {
    id,
    title: id,
    goal: id,
    requirements: ["R1"],
    acceptance,
    depends_on: dependsOn,
    permissions: [],
    files: { read: [], modify: writes, create: [], delete: [] },
    verification: [{ command: { program: "bun", args: ["test"] }, purpose: "check" }],
    done_when: ["done"],
    risks: [],
    wave: 1,
    parallel: false,
  };
}

function owners(tasks: Task[]) {
  return Object.fromEntries(
    resolveAcceptanceOwners(assignWaves(tasks)).map((item) => [item.id, item.acceptance]),
  );
}

test("a criterion claimed by two tasks goes to the one writing its test", () => {
  // Exactly the graph six live runs kept producing: implementation and test both claim everything.
  const result = owners([
    task("T1", [], ["A1", "A2"], ["src/store.ts"]),
    task("T2", ["T1"], ["A1", "A2"], ["src/store.test.ts"]),
  ]);

  expect(result).toEqual({ T1: [], T2: ["A1", "A2"] });
});

test("when no claimant writes a test the latest one keeps it", () => {
  const result = owners([
    task("T1", [], ["A1"], ["src/a.ts"]),
    task("T2", ["T1"], ["A1"], ["src/b.ts"]),
  ]);

  expect(result).toEqual({ T1: [], T2: ["A1"] });
});

test("an uncontested criterion is left where it is", () => {
  const result = owners([
    task("T1", [], ["A1"], ["src/a.test.ts"]),
    task("T2", [], ["A2"], ["src/b.test.ts"]),
  ]);

  expect(result).toEqual({ T1: ["A1"], T2: ["A2"] });
});

test("criteria are distributed rather than all landing on one task", () => {
  const result = owners([
    task("T1", [], ["A1", "A2"], ["src/a.test.ts"]),
    task("T2", [], ["A2"], ["src/b.test.ts"]),
  ]);

  // A1 has one claimant, A2 has two at the same wave; each ends up owned exactly once.
  const all = Object.values(result).flat();
  expect(all.sort()).toEqual(["A1", "A2"]);
});

test("nothing is invented for a task that claimed nothing", () => {
  const result = owners([
    task("T1", [], [], ["src/a.ts"]),
    task("T2", ["T1"], ["A1"], ["src/a.test.ts"]),
  ]);

  expect(result).toEqual({ T1: [], T2: ["A1"] });
});
