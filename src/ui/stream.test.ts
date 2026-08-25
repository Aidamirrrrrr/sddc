import { afterEach, expect, test } from "bun:test";
import { createStreamDriver } from "./stream";

const original = console.log;
let lines: string[] = [];

function capture(): void {
  lines = [];
  console.log = (...parts: unknown[]) => {
    lines.push(parts.join(" "));
  };
}

afterEach(() => {
  console.log = original;
});

test("plain mode writes stable lines a human can read in a log", async () => {
  capture();
  const driver = createStreamDriver("plain");

  driver.begin("sddc");
  driver.step(2, 5, "Agree on requirements");
  driver.success("Requirements saved");
  await driver.stage(
    { progress: "Working", complete: "Done", failed: "Failed" },
    async () => "result",
  );

  expect(lines).toEqual([
    "sddc",
    "[2/5] Agree on requirements",
    "Requirements saved",
    "Working",
    "Done",
  ]);
});

test("json mode writes one parseable event per line", async () => {
  capture();
  const driver = createStreamDriver("json");

  driver.step(1, 3, "Mapping");
  driver.document("Requirements", "R1 A user can register");

  const events = lines.map((line) => JSON.parse(line));
  expect(events[0]).toEqual({ type: "step", current: 1, total: 3, message: "Mapping" });
  expect(events[1]).toEqual({
    type: "document",
    title: "Requirements",
    content: "R1 A user can register",
  });
});

test("a stage returns its result and reports both ends of it", async () => {
  capture();
  const driver = createStreamDriver("plain");

  const result = await driver.stage(
    { progress: "Building", complete: "Built", failed: "Broke" },
    async () => 42,
  );

  expect(result).toBe(42);
  expect(lines).toEqual(["Building", "Built"]);
});

test("a failing stage propagates rather than reporting completion", async () => {
  capture();
  const driver = createStreamDriver("plain");

  const attempt = driver.stage({ progress: "Building", complete: "Built", failed: "Broke" }, () =>
    Promise.reject(new Error("boom")),
  );

  expect(attempt).rejects.toThrow("boom");
});

test("every prompt refuses with an explanation instead of hanging", () => {
  capture();
  const driver = createStreamDriver("plain");
  const expected = "requires an interactive terminal";

  expect(() => driver.select("Pick one", [])).toThrow(expected);
  expect(() => driver.multiselect("Pick some", [], [])).toThrow(expected);
  expect(() => driver.confirm("Sure?", false)).toThrow(expected);
  expect(() => driver.text("Your answer")).toThrow(expected);
});
