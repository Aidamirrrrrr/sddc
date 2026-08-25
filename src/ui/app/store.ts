import type { Choice, TextOptions } from "../driver";
import type { PhaseState } from "../theme";

/**
 * The bridge between an imperative pipeline and a declarative surface.
 *
 * Workflows call driver methods and await promises; React cannot be awaited. So the driver writes
 * into this store and parks the promise's `resolve` on the pending request, and the component that
 * renders the request calls it. State is replaced rather than mutated so `useSyncExternalStore` can
 * compare snapshots by reference.
 */
export type Tone = "info" | "success" | "warn" | "danger" | "accent";

export type Block =
  | { id: number; kind: "line"; tone: Tone; text: string }
  | { id: number; kind: "panel"; title: string; body: string }
  | { id: number; kind: "answer"; question: string; answer: string }
  /** Something the user typed at the command line, echoed so the transcript reads as a session. */
  | { id: number; kind: "command"; text: string }
  /**
   * Work that happened, as a one-line summary with its evidence underneath.
   *
   * A task writing three files and running a suite is one event to a reader and four to the log.
   * Summarising it and hanging the detail off it keeps a long run scannable without hiding what it
   * actually did.
   */
  | { id: number; kind: "action"; tone: Tone; title: string; details: string[] }
  /** Said once at the top: which project, which model, which rules are in force. */
  | {
      id: number;
      kind: "banner";
      version: string;
      project: string;
      model: string;
      facts: string[];
    };

/** `Omit` collapses a union into its shared keys, so it has to be distributed by hand. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type NewBlock = DistributiveOmit<Block, "id">;

export type Phase = { label: string; state: PhaseState };

export type Pending =
  | {
      kind: "select";
      message: string;
      choices: Choice<string>[];
      initial?: string;
      resolve: (value: string) => void;
    }
  | {
      kind: "multiselect";
      message: string;
      choices: Choice<string>[];
      initial: string[];
      resolve: (value: string[]) => void;
    }
  | { kind: "confirm"; message: string; initial: boolean; resolve: (value: boolean) => void }
  | {
      kind: "text";
      message: string;
      options: TextOptions;
      resolve: (value: string) => void;
    };

export type AppState = {
  heading: string;
  blocks: Block[];
  phases: Phase[];
  stage?: string;
  /** When the current stage began, so the frame can say how long *this* wait has lasted. */
  stageStartedAt?: number;
  pending?: Pending;
  /**
   * Waiting for the next thing to work on.
   *
   * Set while the session is idle at the prompt: plain prose typed then is a request, and the same
   * prose typed mid-run has nowhere to go. The presence of this resolver is what tells them apart.
   */
  awaitingRequest?: (request: string) => void;
  startedAt: number;
  finished?: string;
};

export type Store = {
  getSnapshot(): AppState;
  subscribe(listener: () => void): () => void;
  update(change: (state: AppState) => AppState): void;
  push(block: NewBlock): void;
};

export function createStore(): Store {
  let state: AppState = { heading: "sddc", blocks: [], phases: [], startedAt: Date.now() };
  const listeners = new Set<() => void>();
  let nextId = 0;

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(change) {
      state = change(state);
      notify();
    },
    push(block) {
      nextId += 1;
      state = { ...state, blocks: [...state.blocks, { ...block, id: nextId } as Block] };
      notify();
    },
  };
}

/**
 * Folds `step(current, total, …)` into the phase rail. The pipeline announces its steps as it goes
 * and never declares the shape of the run up front, so the rail grows to `total` on the first step
 * and fills in labels as each phase is reached.
 */
export function applyStep(
  state: AppState,
  current: number,
  total: number,
  label: string,
): AppState {
  const phases: Phase[] = Array.from({ length: total }, (_, index) => {
    const existing = state.phases[index];
    if (index === current - 1) return { label, state: "active" };
    if (index < current - 1) return { label: existing?.label ?? "", state: "done" };
    return { label: existing?.label ?? "", state: existing?.state ?? "pending" };
  });
  return { ...state, phases };
}

export function markCurrentPhase(state: AppState, phaseState: PhaseState): AppState {
  const index = state.phases.findIndex((phase) => phase.state === "active");
  if (index < 0) return state;
  const phases = [...state.phases];
  const phase = phases[index];
  if (phase) phases[index] = { ...phase, state: phaseState };
  return { ...state, phases };
}
