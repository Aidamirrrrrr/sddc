import { afterEach, expect, test } from "bun:test";
import {
  InterruptedError,
  interruptSignal,
  isInterrupted,
  requestInterrupt,
  resetInterrupt,
  throwIfInterrupted,
} from "./interrupt";

afterEach(resetInterrupt);

test("a fresh run is not interrupted", () => {
  expect(isInterrupted()).toBe(false);
  expect(() => throwIfInterrupted()).not.toThrow();
  expect(interruptSignal().aborted).toBe(false);
});

test("an interrupt both cuts the open request and refuses the next one", () => {
  const signal = interruptSignal();

  requestInterrupt();

  // The signal already handed to an in-flight call has to be the one that aborts.
  expect(signal.aborted).toBe(true);
  expect(() => throwIfInterrupted()).toThrow(InterruptedError);
});

test("a new run is not interrupted because the previous one was", () => {
  requestInterrupt();
  resetInterrupt();

  expect(isInterrupted()).toBe(false);
  expect(interruptSignal().aborted).toBe(false);
});
