import { expect, test } from "bun:test";
import type { Task } from "../tasks/schemas";
import { assignWaves } from "../tasks/validate";
import { groupByWave, prefetchable } from "./concurrency";

type Files = { read?: string[]; modify?: string[]; create?: string[] };

function task(id: string, dependsOn: string[], files: Files): Task {
  return {
    id,
    title: id,
    goal: id,
    requirements: ["R1"],
    acceptance: ["A1"],
    depends_on: dependsOn,
    permissions: [],
    files: {
      read: files.read ?? [],
      modify: files.modify ?? [],
      create: files.create ?? [],
      delete: [],
    },
    verification: [{ command: { program: "bun", args: ["test"] }, purpose: "check" }],
    done_when: ["done"],
    risks: [],
    wave: 1,
    parallel: false,
  };
}

test("independent tasks in a wave are all prefetchable", () => {
  const wave = assignWaves([
    task("T1", [], { modify: ["src/a.ts"] }),
    task("T2", [], { modify: ["src/b.ts"] }),
    task("T3", [], { modify: ["src/c.ts"] }),
  ]);

  expect(prefetchable(wave).map((item) => item.id)).toEqual(["T1", "T2", "T3"]);
});

test("a task reading what a sibling writes is not prefetchable", () => {
  const wave = assignWaves([
    task("T1", [], { modify: ["src/schema.ts"] }),
    task("T2", [], { read: ["src/schema.ts"], modify: ["src/use.ts"] }),
    task("T3", [], { modify: ["src/other.ts"] }),
  ]);

  // T2 would be generated from schema.ts as it exists before T1 rewrites it.
  expect(prefetchable(wave).map((item) => item.id)).toEqual(["T1", "T3"]);
});

test("a task reading a file a sibling creates is not prefetchable", () => {
  const wave = assignWaves([
    task("T1", [], { create: ["src/new.ts"] }),
    task("T2", [], { read: ["src/new.ts"], modify: ["src/use.ts"] }),
  ]);

  expect(prefetchable(wave).map((item) => item.id)).toEqual(["T1"]);
});

test("waves are grouped in dependency order", () => {
  const tasks = assignWaves([
    task("T1", [], { modify: ["src/a.ts"] }),
    task("T2", ["T1"], { modify: ["src/b.ts"] }),
    task("T3", [], { modify: ["src/c.ts"] }),
  ]);

  const waves = groupByWave([...tasks].sort((left, right) => left.wave - right.wave));

  expect(waves.map((group) => group.map((item) => item.id))).toEqual([["T1", "T3"], ["T2"]]);
});
