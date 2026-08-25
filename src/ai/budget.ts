/**
 * One bound on how much work a single run may ask a model for.
 *
 * Every loop in the pipeline is bounded, and until now that was mistaken for the whole answer. The
 * bounds nest — task attempts around loop turns around proposal draws around schema repairs around
 * transport retries — so they multiply rather than add, and a graph whose every local budget is
 * modest can still issue hundreds of calls before anything says stop. A per-run ceiling is the only
 * place that arithmetic can be seen, because it is the only place that counts calls rather than
 * permissions to make them.
 *
 * Deliberately counted at the request, not at a successful response: the point is to bound work
 * issued, and a run wedged on a provider returning nothing is exactly the case a ceiling is for.
 */
export class BudgetExhaustedError extends Error {
  constructor(
    readonly used: number,
    readonly limit: number,
  ) {
    super(
      `This run reached its budget of ${limit} model calls. Raise budget.max_model_calls in ` +
        ".sddc/policy.yaml, or run with --max-calls, if the work genuinely needs more.",
    );
    this.name = "BudgetExhaustedError";
  }
}

type BudgetState = { used: number; limit: number; warned: boolean };

/** The share of the budget at which the run says so, while there is still room to react. */
const WARN_AT = 0.75;

let state: BudgetState | undefined;
let onWarning: ((used: number, limit: number) => void) | undefined;

export function setBudget(limit: number | undefined): void {
  state = limit === undefined ? undefined : { used: 0, limit, warned: false };
}

/** The UI supplies this; the client layer must not depend on how a warning is shown. */
export function onBudgetWarning(notify: (used: number, limit: number) => void): void {
  onWarning = notify;
}

export function chargeCall(): void {
  if (!state) return;
  if (state.used >= state.limit) throw new BudgetExhaustedError(state.used, state.limit);
  state.used += 1;
  if (!state.warned && state.used >= Math.floor(state.limit * WARN_AT)) {
    state.warned = true;
    onWarning?.(state.used, state.limit);
  }
}

export function budgetState(): { used: number; limit: number } | undefined {
  return state ? { used: state.used, limit: state.limit } : undefined;
}

export function resetBudget(): void {
  state = undefined;
  onWarning = undefined;
}

/**
 * Lets a deliberately forgiving catch stay forgiving without swallowing the ceiling.
 *
 * Several places absorb any failure on purpose — an advisory stage that returns nothing, a prefetch
 * that will be redone inline, a reviewer whose objection is just feedback. Each of them would turn
 * an exhausted budget into a shrug and carry on spending, which is the one thing a budget must not
 * permit. Call this first in any catch that would otherwise continue.
 */
export function rethrowIfExhausted(error: unknown): void {
  if (error instanceof BudgetExhaustedError) throw error;
}
