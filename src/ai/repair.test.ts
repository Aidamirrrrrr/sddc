import { describe, expect, test } from "bun:test";
import { withOneRepair } from "./repair";

describe("withOneRepair", () => {
  test("returns the first valid response without retrying", async () => {
    const prompts: string[] = [];
    const result = await withOneRepair("original", async (prompt) => {
      prompts.push(prompt);
      return "valid";
    });

    expect(result).toBe("valid");
    expect(prompts).toEqual(["original"]);
  });

  test("returns validation feedback on one repair attempt", async () => {
    const prompts: string[] = [];
    const result = await withOneRepair("original", async (prompt) => {
      prompts.push(prompt);
      if (prompts.length === 1) throw new Error("missing field");
      return "corrected";
    });

    expect(result).toBe("corrected");
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("missing field");
    expect(prompts[1]).toContain("original");
  });

  test("retries an empty response with reasoning degraded instead of repair instructions", async () => {
    const attempts: Array<{ prompt: string; degraded: boolean }> = [];
    const result = await withOneRepair("original", async (prompt, { degraded }) => {
      attempts.push({ prompt, degraded });
      if (attempts.length === 1) throw new Error("No output generated.");
      return "recovered";
    });

    expect(result).toBe("recovered");
    expect(attempts).toEqual([
      { prompt: "original", degraded: false },
      { prompt: "original", degraded: true },
    ]);
  });

  test("keeps reasoning enabled when the response merely failed validation", async () => {
    const attempts: boolean[] = [];
    await withOneRepair("original", async (_prompt, { degraded }) => {
      attempts.push(degraded);
      if (attempts.length === 1) throw new Error("missing field");
      return "corrected";
    });

    expect(attempts).toEqual([false, false]);
  });

  test("stops after the repair attempt fails", async () => {
    let attempts = 0;
    const operation = withOneRepair("original", async () => {
      attempts += 1;
      throw new Error(`failure ${attempts}`);
    });

    expect(operation).rejects.toThrow("failure 2");
    expect(attempts).toBe(2);
  });
});
