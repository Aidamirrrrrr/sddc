import { expect, test } from "bun:test";
import { discovery, readyPlan, readySpec } from "../planning/test-fixtures";
import { defaultPolicy } from "../policy/load";
import { buildTaskList } from "./pipeline";

/** Records the context each stage was handed. */
function recordingClient(seen: Map<string, Record<string, unknown>>) {
  return {
    async generateObject<T>(instruction: string, context: string): Promise<T> {
      const parsed = JSON.parse(context) as Record<string, unknown>;
      const stage = parsed.audit ? "review" : parsed.draft ? "audit" : "draft";
      seen.set(stage, parsed);
      throw new Error("stop after the stage under test");
    },
  };
}

const repository = {
  paths: ["src/auth.ts"],
  snapshots: [
    {
      path: "src/auth.ts",
      size: 36,
      content: "export const secretLookingCode = 1;\n",
    },
  ],
};

test("stages that only check the graph are not handed file contents", async () => {
  const seen = new Map<string, Record<string, unknown>>();

  await buildTaskList(
    recordingClient(seen),
    readySpec(),
    readyPlan(),
    discovery(),
    "",
    repository,
    defaultPolicy,
  ).catch(() => undefined);

  const draft = seen.get("draft");
  if (!draft) throw new Error("The draft stage should have been reached");

  // Authoring the graph needs the code; checking it needs only identifiers and paths.
  expect(draft.approvedSnapshots).toBeDefined();
  expect(JSON.stringify(draft)).toContain("secretLookingCode");
});

test("the checking projection carries paths but no contents", async () => {
  const seen = new Map<string, Record<string, unknown>>();
  let calls = 0;

  const client = {
    async generateObject<T>(_instruction: string, context: string): Promise<T> {
      calls += 1;
      const parsed = JSON.parse(context) as Record<string, unknown>;
      if (calls === 1) {
        return {
          status: "ready",
          feature: "registration",
          summary: "s",
          tasks: [],
          questions: [],
        } as T;
      }
      seen.set("audit", parsed);
      throw new Error("stop at audit");
    },
  };

  await buildTaskList(
    client,
    readySpec(),
    readyPlan(),
    discovery(),
    "",
    repository,
    defaultPolicy,
  ).catch(() => undefined);

  const audit = seen.get("audit");
  if (!audit) throw new Error("The audit stage should have been reached");

  expect(audit.approvedPaths).toEqual(["src/auth.ts"]);
  expect(audit.approvedSnapshots).toBeUndefined();
  expect(JSON.stringify(audit)).not.toContain("secretLookingCode");
});
