import { afterEach, expect, test } from "bun:test";
import {
  BudgetExhaustedError,
  budgetState,
  chargeCall,
  onBudgetWarning,
  resetBudget,
  rethrowIfFatal,
  setBudget,
} from "./budget";
import { InterruptedError } from "./interrupt";

afterEach(resetBudget);

test("a run without a budget is never charged", () => {
  setBudget(undefined);

  for (let call = 0; call < 1000; call += 1) chargeCall();
  expect(budgetState()).toBeUndefined();
});

test("calls are counted and the ceiling stops the run", () => {
  setBudget(3);

  chargeCall();
  chargeCall();
  chargeCall();
  expect(budgetState()).toEqual({ used: 3, limit: 3 });
  expect(() => chargeCall()).toThrow(BudgetExhaustedError);
  // And it keeps refusing rather than letting the next caller through.
  expect(() => chargeCall()).toThrow("reached its budget of 3 model calls");
});

test("the run says so before the ceiling, once", () => {
  const warnings: Array<[number, number]> = [];
  setBudget(4);
  onBudgetWarning((used, limit) => warnings.push([used, limit]));

  chargeCall();
  chargeCall();
  chargeCall();
  chargeCall();

  // Three of four is the first call at or past three quarters; the fourth must not repeat it.
  expect(warnings).toEqual([[3, 4]]);
});

test("a forgiving catch stays forgiving except for the reasons to stop", () => {
  expect(() => rethrowIfFatal(new Error("audit returned nothing"))).not.toThrow();
  expect(() => rethrowIfFatal(new BudgetExhaustedError(400, 400))).toThrow(BudgetExhaustedError);
  expect(() => rethrowIfFatal(new InterruptedError())).toThrow(InterruptedError);
});
