import { afterEach, expect, test } from "bun:test";
import { discovery, readyPlan, readySpec } from "../planning/test-fixtures";
import { defaultPolicy } from "../policy/load";
import { buildTaskList } from "../tasks/pipeline";
import { taskPrompts } from "../tasks/prompts";
import { readyTasks } from "../tasks/test-fixtures";
import { BudgetExhaustedError, chargeCall, resetBudget, setBudget } from "./budget";
import { sampleUntilValid } from "./sample";

afterEach(resetBudget);

test("sampling stops drawing once the run is out of budget", async () => {
  setBudget(1);
  let draws = 0;

  const run = sampleUntilValid(
    5,
    async () => {
      draws += 1;
      chargeCall();
      return "candidate";
    },
    () => {
      throw new Error("never good enough");
    },
  );

  // Without the guard the loop would keep drawing against a budget that is already gone.
  expect(run).rejects.toThrow(BudgetExhaustedError);
  await run.catch(() => undefined);
  expect(draws).toBe(2);
});

test("an advisory stage forgives its own failure but not an exhausted budget", async () => {
  setBudget(2);
  const client = {
    async generateObject<T>(instruction: string): Promise<T> {
      chargeCall();
      if (instruction === taskPrompts.draft) return readyTasks() as T;
      // The audit is allowed to fail without ending the phase — unless this is why it failed.
      throw new BudgetExhaustedError(2, 2);
    },
  };

  expect(
    buildTaskList(client, readySpec(), readyPlan(), discovery(), "", undefined, defaultPolicy),
  ).rejects.toThrow(BudgetExhaustedError);
});
