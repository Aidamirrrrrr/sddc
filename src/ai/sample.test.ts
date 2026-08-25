import { expect, test } from "bun:test";
import { sampleUntilValid } from "./sample";

test("the first acceptable candidate is returned without further draws", async () => {
  let draws = 0;

  const value = await sampleUntilValid(
    3,
    async () => {
      draws += 1;
      return "good";
    },
    () => {},
  );

  expect(value).toBe("good");
  expect(draws).toBe(1);
});

test("an unstable generator is resampled until one candidate verifies", async () => {
  const drawn: Array<string | undefined> = [];
  const candidates = ["bad", "bad", "good"];

  const value = await sampleUntilValid(
    3,
    async (rejection) => {
      drawn.push(rejection);
      return candidates.shift() as string;
    },
    (candidate) => {
      if (candidate !== "good") throw new Error(`rejected ${candidate}`);
    },
  );

  expect(value).toBe("good");
  // Each draw after the first is told why the previous one was rejected.
  expect(drawn).toEqual([undefined, "rejected bad", "rejected bad"]);
});

test("exhausting the attempts surfaces the last rejection", async () => {
  let draws = 0;

  const attempt = sampleUntilValid(
    3,
    async () => {
      draws += 1;
      return `candidate ${draws}`;
    },
    (candidate) => {
      throw new Error(`no good: ${candidate}`);
    },
  );

  expect(attempt).rejects.toThrow("no good: candidate 3");
  expect(draws).toBe(3);
});

test("a verifier that passes is never asked to explain itself", async () => {
  const value = await sampleUntilValid(
    1,
    async () => 42,
    () => {},
  );
  expect(value).toBe(42);
});

test("an async verifier is awaited before the candidate is accepted", async () => {
  let checked = false;

  await sampleUntilValid(
    2,
    async () => "value",
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      checked = true;
    },
  );

  expect(checked).toBe(true);
});
