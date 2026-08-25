import { expect, test } from "bun:test";
import { discovery, readyPlan, readySpec } from "../planning/test-fixtures";
import { readyTasks } from "../tasks/test-fixtures";
import { discoveryMarkdown, planMarkdown, specMarkdown, taskMarkdown } from "./markdown";

test("a specification renders its requirements and their acceptance together", () => {
  const markdown = specMarkdown(readySpec());

  expect(markdown).toContain("# Requirements · registration");
  expect(markdown).toContain("| R1 | A user can register |");
  expect(markdown).toContain("| A1 | `R1` | Registration succeeds |");
});

test("open decisions appear only when there are any", () => {
  const spec = readySpec();
  expect(specMarkdown(spec)).not.toContain("Open decisions");

  spec.questions.push({
    id: "Q1",
    question: "Email or phone?",
    reason: "Not stated",
    blocking: true,
  });
  expect(specMarkdown(spec)).toContain("**Q1.** Email or phone?");
});

test("a plan step carries the requirements it serves and the files it touches", () => {
  const markdown = planMarkdown(readyPlan());

  expect(markdown).toContain("**S1.** Add the registration operation to the auth module.");
  expect(markdown).toContain("Serves: `R1`");
  expect(markdown).toContain("Files: `src/auth.ts`");
});

test("tasks are grouped by wave and show their verification commands", () => {
  const markdown = taskMarkdown(readyTasks());

  expect(markdown).toContain("## Wave 1");
  expect(markdown).toContain("## Wave 2");
  expect(markdown).toContain("```sh");
  expect(markdown).toContain("- **Covers:**");
});

test("a pipe in the content cannot break the table it sits in", () => {
  const spec = readySpec();
  const first = spec.requirements[0];
  if (!first) throw new Error("Fixture must contain a requirement");
  first.statement = "Accepts a|b as separator";

  const markdown = specMarkdown(spec);
  const row = markdown.split("\n").find((line) => line.startsWith("| R1 "));

  expect(row).toContain("a\\|b");
  // Escaped, the row still has exactly the two columns its header declares.
  expect(row?.split(/(?<!\\)\|/).filter((cell) => cell.trim())).toHaveLength(2);
});

test("an empty section is omitted rather than left as an empty table", () => {
  const markdown = discoveryMarkdown(discovery());

  expect(markdown).toContain("# Project map");
  expect(markdown).toContain("| src/auth.ts |");
  expect(markdown).not.toContain("## Constraints");
  expect(markdown).not.toContain("## Still unknown");
});
