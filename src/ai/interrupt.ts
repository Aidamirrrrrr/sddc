/**
 * Stopping a run that is already in flight.
 *
 * A pipeline that only checks for input between phases cannot be stopped during the phase that
 * actually takes the time, which is the one people want to stop. Two mechanisms rather than one,
 * because they cover different moments: the abort signal cuts a request that is already open, and
 * the guard refuses to start the next one. Together they bound how long "stop" takes to a single
 * in-flight response.
 */
export class InterruptedError extends Error {
  constructor() {
    super("Interrupted");
    this.name = "InterruptedError";
  }
}

let controller = new AbortController();

/** Passed to the model call so a request already open is cut rather than waited out. */
export function interruptSignal(): AbortSignal {
  return controller.signal;
}

export function requestInterrupt(): void {
  controller.abort();
}

export function isInterrupted(): boolean {
  return controller.signal.aborted;
}

export function throwIfInterrupted(): void {
  if (controller.signal.aborted) throw new InterruptedError();
}

/** A fresh run is not interrupted because the previous one was. */
export function resetInterrupt(): void {
  controller = new AbortController();
}
