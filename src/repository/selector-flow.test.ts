import { expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Driver } from "../ui/driver";
import { setDriver } from "../ui/driver";
import { createRepositoryContextSelector } from "./context-selector";

type Recorded = { documents: Array<{ title: string; body: string }> };

/** Drives the selector without a terminal by answering its prompts from a script. */
function scriptedDriver(
  answers: {
    select?: string[];
    multiselect?: string[][];
    text?: string[];
  },
  recorded: Recorded,
): Driver {
  return {
    begin: () => {},
    finish: () => {},
    info: () => {},
    success: () => {},
    warn: () => {},
    step: () => {},
    document: (title, body) => recorded.documents.push({ title, body }),
    action: () => undefined,
    banner: () => undefined,
    stage: async (_labels, operation) => operation(),
    select: async () => (answers.select?.shift() ?? "confirm") as never,
    multiselect: async () => (answers.multiselect?.shift() ?? []) as never,
    confirm: async () => true,
    text: async () => answers.text?.shift() ?? "",
    cancel: () => {
      throw new Error("cancelled");
    },
  };
}

const index = [
  { path: "src/auth.ts", size: 2_000 },
  { path: "src/session.ts", size: 1_000 },
  { path: "src/huge.ts", size: 400_000 },
];

const selection = {
  rationale: "The registration change lives in the auth module.",
  files: [{ path: "src/auth.ts", reason: "Holds the registration entry point" }],
};

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sddc-selector-"));
  await mkdir(join(root, "src"), { recursive: true });
  await Bun.write(join(root, "src/auth.ts"), "export const auth = 1;\n");
  return root;
}

test("confirming immediately returns the recommended files", async () => {
  const recorded: Recorded = { documents: [] };
  setDriver(scriptedDriver({ select: ["confirm"] }, recorded));

  const context = await createRepositoryContextSelector(await workspace())(selection, index);

  expect(context.files).toEqual(["src/auth.ts"]);
  // The estimate is shown before the user is asked to approve anything.
  expect(recorded.documents[0]?.title).toContain("Selected context");
});

test("a file larger than the read limit is dropped from the recommendation", async () => {
  const recorded: Recorded = { documents: [] };
  setDriver(scriptedDriver({ select: ["confirm"] }, recorded));

  const context = await createRepositoryContextSelector(await workspace())(
    {
      ...selection,
      files: [{ path: "src/huge.ts", reason: "Too large to read" }, ...selection.files],
    },
    index,
  );

  expect(context.files).toEqual(["src/auth.ts"]);
});

test("editing the selection replaces the files that get sent", async () => {
  const recorded: Recorded = { documents: [] };
  setDriver(
    scriptedDriver(
      { select: ["edit", "confirm"], multiselect: [["src/auth.ts", "src/session.ts"]] },
      recorded,
    ),
  );

  const context = await createRepositoryContextSelector(await workspace())(selection, index);

  expect(context.files).toEqual(["src/auth.ts", "src/session.ts"]);
});

test("an empty selection is rejected and re-asked rather than accepted", async () => {
  const recorded: Recorded = { documents: [] };
  setDriver(
    scriptedDriver({ select: ["edit", "confirm"], multiselect: [[], ["src/auth.ts"]] }, recorded),
  );

  const context = await createRepositoryContextSelector(await workspace())(selection, index);

  expect(context.files).toEqual(["src/auth.ts"]);
  expect(recorded.documents.some((item) => item.body.includes("Select at least one file"))).toBe(
    true,
  );
});

test("a note for the model is carried through as user context", async () => {
  const recorded: Recorded = { documents: [] };
  setDriver(
    scriptedDriver(
      { select: ["context", "confirm"], text: ["The staging database has no seed data"] },
      recorded,
    ),
  );

  const context = await createRepositoryContextSelector(await workspace())(selection, index);

  expect(context.userContext).toBe("The staging database has no seed data");
});

test("previewing a file shows its contents without changing the selection", async () => {
  const recorded: Recorded = { documents: [] };
  setDriver(scriptedDriver({ select: ["preview", "src/auth.ts", "confirm"] }, recorded));

  const context = await createRepositoryContextSelector(await workspace())(selection, index);

  expect(context.files).toEqual(["src/auth.ts"]);
  expect(recorded.documents.some((item) => item.body.includes("export const auth"))).toBe(true);
});

test("a saved profile can be loaded back into the selection", async () => {
  const root = await workspace();
  const recorded: Recorded = { documents: [] };
  setDriver(
    scriptedDriver(
      {
        select: ["profiles", "save", "confirm"],
        text: ["backend-auth"],
      },
      recorded,
    ),
  );
  await createRepositoryContextSelector(root)(selection, index);

  const reloaded: Recorded = { documents: [] };
  setDriver(scriptedDriver({ select: ["profiles", "load", "backend-auth", "confirm"] }, reloaded));
  const context = await createRepositoryContextSelector(root)(selection, index);

  expect(context.files).toEqual(["src/auth.ts"]);
});
