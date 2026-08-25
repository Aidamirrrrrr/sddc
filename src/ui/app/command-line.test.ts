import { afterEach, expect, test } from "bun:test";
import { setLanguage } from "../language";
import { placeholder } from "./CommandLine";

afterEach(() => setLanguage("en"));

test("the line never announces work that has not started", () => {
  // The first frame of a session said "working" because "not ready yet" was folded into "busy".
  expect(placeholder("starting")).not.toContain("working");
  expect(placeholder("working")).toContain("working");
  expect(placeholder("ready")).toContain("what should I build?");
});

test("each state says what it can do in the reader's language", () => {
  setLanguage("ru");

  for (const mode of ["ready", "working", "starting"] as const) {
    expect(placeholder(mode)).toMatch(/[А-Яа-яЁё]/);
  }
});
