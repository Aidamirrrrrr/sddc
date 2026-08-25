import { expect, test } from "bun:test";
import { applyStep, createStore, markCurrentPhase } from "./store";

test("the first step sizes the rail and marks where the run is", () => {
  const store = createStore();

  store.update((state) => applyStep(state, 1, 5, "Source access"));

  const { phases } = store.getSnapshot();
  expect(phases).toHaveLength(5);
  expect(phases[0]).toEqual({ label: "Source access", state: "active" });
  expect(phases[4]).toEqual({ label: "", state: "pending" });
});

test("advancing marks the phases behind it done and keeps their labels", () => {
  const store = createStore();

  store.update((state) => applyStep(state, 1, 3, "Requirements"));
  store.update((state) => applyStep(state, 2, 3, "Plan"));

  const { phases } = store.getSnapshot();
  expect(phases[0]).toEqual({ label: "Requirements", state: "done" });
  expect(phases[1]).toEqual({ label: "Plan", state: "active" });
  expect(phases[2]?.state).toBe("pending");
});

test("a failure marks the phase the run was in, not the whole rail", () => {
  const store = createStore();
  store.update((state) => applyStep(state, 2, 3, "Plan"));

  store.update((state) => markCurrentPhase(state, "failed"));

  const { phases } = store.getSnapshot();
  expect(phases[1]?.state).toBe("failed");
  expect(phases[0]?.state).toBe("done");
  expect(phases[2]?.state).toBe("pending");
});

test("marking a phase when none is active leaves the rail untouched", () => {
  const store = createStore();
  const before = store.getSnapshot();

  store.update((state) => markCurrentPhase(state, "done"));

  expect(store.getSnapshot().phases).toEqual(before.phases);
});

test("a recompile run with fewer phases does not keep the longer rail", () => {
  const store = createStore();
  store.update((state) => applyStep(state, 1, 5, "Full run"));

  store.update((state) => applyStep(state, 1, 2, "Rebuild tasks"));

  expect(store.getSnapshot().phases).toHaveLength(2);
});

test("blocks are appended with stable identities", () => {
  const store = createStore();

  store.push({ kind: "line", tone: "info", text: "first" });
  store.push({ kind: "line", tone: "success", text: "second" });

  const ids = store.getSnapshot().blocks.map((block) => block.id);
  expect(ids).toEqual([1, 2]);
  expect(new Set(ids).size).toBe(2);
});

test("subscribers are notified and can unsubscribe", () => {
  const store = createStore();
  let calls = 0;
  const unsubscribe = store.subscribe(() => {
    calls += 1;
  });

  store.push({ kind: "line", tone: "info", text: "one" });
  unsubscribe();
  store.push({ kind: "line", tone: "info", text: "two" });

  expect(calls).toBe(1);
});

test("each change produces a new snapshot so a reference comparison detects it", () => {
  const store = createStore();
  const before = store.getSnapshot();

  store.push({ kind: "line", tone: "info", text: "changed" });

  // useSyncExternalStore compares by reference; mutating in place would render nothing.
  expect(store.getSnapshot()).not.toBe(before);
});
